/* ════════════════════════════════════════════════════════════════
   api/send-notification.js  —  works12
   Netlify Function لإرسال إشعارات FCM (Firebase Cloud Messaging)

   📌 المسار: ضع هذا الملف في:  api/send-notification.js
              (نفس المجلد المحدد في netlify.toml تحت functions = "api")

   📌 يُستدعى من:
        POST /.netlify/functions/send-notification
        POST /api/send-notification    (عبر redirect في netlify.toml)

   📌 يستقبل JSON:
        {
          target: 'email' | 'role' | 'vendor' | 'all',
          value:  'someone@x.com' | 'admin' | 'vendor-123' | '',
          title:  'عنوان الإشعار',
          body:   'نص الإشعار',
          data:   { url:'/', ...  أي بيانات إضافية }
        }

   📌 متغيرات البيئة المطلوبة في Netlify
       (Site settings → Environment variables):

       SUPABASE_URL            =  https://xxxxxx.supabase.co
       SUPABASE_SERVICE_KEY    =  eyJhbGciOi...  (service_role key — سرّي!)
       FIREBASE_SERVICE_ACCOUNT = {"type":"service_account",...}
                                  (المحتوى الكامل لـ service-account.json
                                   كسلسلة JSON واحدة)

   ⚠️ ملاحظة أمنية:
      service-account.json يجب أن يبقى في متغيرات Netlify فقط،
      ولا يُرفع أبداً إلى GitHub.
   ══════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

// ── تهيئة Firebase Admin مرة واحدة (cold start) ────────────────
let firebaseReady = false;
function initFirebase(){
  if(firebaseReady) return;
  try{
    if(!admin.apps.length){
      const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT;
      if(!svcJson) throw new Error('FIREBASE_SERVICE_ACCOUNT env var غير موجود');
      const svc = JSON.parse(svcJson);
      admin.initializeApp({
        credential: admin.credential.cert(svc)
      });
      console.log('[notify] Firebase Admin initialized OK');
    }
    firebaseReady = true;
  }catch(e){
    console.error('[notify] Firebase init failed:', e.message);
    throw e;
  }
}

// ── جلب توكنات FCM من Supabase حسب الهدف ────────────────────────
async function fetchTokens(target, value){
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key){
    throw new Error('SUPABASE_URL أو SUPABASE_SERVICE_KEY غير موجودة');
  }

  let query = '?select=token,user_email,role';
  if(target === 'email' && value){
    query += '&user_email=eq.' + encodeURIComponent(value);
  } else if(target === 'role' && value){
    query += '&role=eq.' + encodeURIComponent(value);
  } else if(target === 'vendor' && value){
    query += '&vendor_id=eq.' + encodeURIComponent(value);
  }
  // إذا target === 'all' → بدون فلتر

  const res = await fetch(url + '/rest/v1/fcm_tokens' + query, {
    method: 'GET',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Accept': 'application/json'
    }
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error('Supabase fetch failed: ' + res.status + ' ' + t);
  }
  const rows = await res.json();
  return (rows || []).map(r => r.token).filter(Boolean);
}

// ── حذف التوكنات غير الصالحة من قاعدة البيانات ──────────────────
async function deleteInvalidTokens(tokens){
  if(!tokens.length) return;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key) return;
  try{
    for(const tk of tokens){
      await fetch(url + '/rest/v1/fcm_tokens?token=eq.' + encodeURIComponent(tk), {
        method: 'DELETE',
        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
      });
    }
    console.log('[notify] cleaned', tokens.length, 'invalid tokens');
  }catch(e){
    console.warn('[notify] cleanup failed:', e.message);
  }
}

// ── إرسال data-only message عبر FCM ─────────────────────────────
async function sendToTokens(tokens, payload){
  if(!tokens.length){
    return { successCount: 0, failureCount: 0, invalid: [] };
  }

  // FCM يدعم 500 توكن كحد أقصى لكل sendEachForMulticast
  const CHUNK = 500;
  let successCount = 0, failureCount = 0;
  const invalid = [];

  for(let i = 0; i < tokens.length; i += CHUNK){
    const chunk = tokens.slice(i, i + CHUNK);

    // data-only message — Service Worker سيُنشئ الإشعار بنفسه
    const message = {
      tokens: chunk,
      data: {
        title: String(payload.title || ''),
        body:  String(payload.body  || ''),
        ...Object.fromEntries(
          Object.entries(payload.data || {}).map(([k,v]) => [k, String(v)])
        )
      },
      // لـ Android بدون UI افتراضي
      android: {
        priority: 'high'
      },
      // لـ iOS — content-available لإيقاظ التطبيق
      apns: {
        headers: { 'apns-priority': '5' },
        payload: { aps: { 'content-available': 1 } }
      },
      // لـ Web Push
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '300'
        }
      }
    };

    try{
      const resp = await admin.messaging().sendEachForMulticast(message);
      successCount += resp.successCount;
      failureCount += resp.failureCount;

      // اجمع التوكنات الفاشلة بسبب unregistered
      resp.responses.forEach((r, idx) => {
        if(!r.success){
          const code = r.error && r.error.code;
          if(code === 'messaging/registration-token-not-registered' ||
             code === 'messaging/invalid-registration-token'){
            invalid.push(chunk[idx]);
          }
        }
      });
    }catch(e){
      console.error('[notify] sendEachForMulticast error:', e.message);
      failureCount += chunk.length;
    }
  }

  // نظّف التوكنات غير الصالحة (لا تنتظر النتيجة)
  if(invalid.length){
    deleteInvalidTokens(invalid).catch(() => {});
  }

  return { successCount, failureCount, invalid: invalid.length };
}

// ════════════════════════════════════════════════════════════════
// Netlify Function handler
// ════════════════════════════════════════════════════════════════
exports.handler = async function(event){
  // CORS preflight
  if(event.httpMethod === 'OPTIONS'){
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type, x-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if(event.httpMethod !== 'POST'){
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok:false, error:'Method not allowed' })
    };
  }

  try{
    initFirebase();

    const body = JSON.parse(event.body || '{}');
    const target = body.target || 'role';
    const value  = body.value  || 'admin';
    const title  = body.title  || 'إشعار جديد';
    const text   = (body.body  || '').slice(0, 500);
    const data   = body.data   || {};

    console.log('[notify] →', target, '=', value, '|', title);

    const tokens = await fetchTokens(target, value);
    console.log('[notify] tokens found:', tokens.length);

    if(!tokens.length){
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' },
        body: JSON.stringify({ ok:true, sent:0, reason:'no tokens for target' })
      };
    }

    const result = await sendToTokens(tokens, {
      title, body: text, data
    });

    console.log('[notify] ✅ sent:', result.successCount,
                'failed:', result.failureCount,
                'cleaned:', result.invalid);

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' },
      body: JSON.stringify({
        ok: true,
        sent: result.successCount,
        failed: result.failureCount,
        invalidCleaned: result.invalid
      })
    };

  }catch(e){
    console.error('[notify] FATAL:', e);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin':'*', 'Content-Type':'application/json' },
      body: JSON.stringify({ ok:false, error: e.message || String(e) })
    };
  }
};
