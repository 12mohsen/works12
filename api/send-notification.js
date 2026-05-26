/**
 * ══════════════════════════════════════════════════════════════
 *  api/send-notification.js  —  Netlify Function (HTTP endpoint)
 *
 *  📍 المسار بعد النشر:
 *      POST  https://YOUR-SITE.netlify.app/.netlify/functions/send-notification
 *      أو عبر redirect:  POST  https://YOUR-SITE.netlify.app/api/send-notification
 *
 *  🔐 يقرأ بيانات Firebase Admin من متغيرات بيئة Netlify فقط
 *      (لا يحتوي على أي مفتاح سري داخل الكود — آمن للرفع على
 *      GitHub العام دون أن يفعّل GitHub Push Protection).
 *
 *  📋 المتغيرات المطلوبة في لوحة تحكم Netlify
 *      (Site settings → Environment variables):
 *
 *      ✅ FIREBASE_SERVICE_ACCOUNT
 *           الـ JSON كاملاً لملف service-account (سطر واحد).
 *           هذا هو الخيار الموصى به والمستخدم لديك حالياً.
 *
 *      ✅ FIREBASE_PROJECT_ID            مثال: works12
 *
 *      ✅ SUPABASE_URL                   مثال: https://xxx.supabase.co
 *      ✅ SUPABASE_KEY                   (service_role أو anon)
 *
 *      🟡 NOTIFY_SECRET (اختياري)         سر للمصادقة عبر هيدر x-secret
 *
 *      🟡 المتغيرات المنفصلة (Fallback اختياري إن لم يوجد FIREBASE_SERVICE_ACCOUNT):
 *           FIREBASE_CLIENT_EMAIL
 *           FIREBASE_PRIVATE_KEY     (مع \n حرفية أو حقيقية)
 *           FIREBASE_PRIVATE_KEY_ID  (اختياري)
 *           FIREBASE_CLIENT_ID       (اختياري)
 *
 *  📦 التبعيات (package.json):
 *      "dependencies": { "firebase-admin": "^12.0.0" }
 *      (Node 18+ في Netlify يأتي بـ fetch مدمجة — لا حاجة لـ node-fetch).
 *
 *  📨 شكل الطلب (Request Body — JSON):
 *      {
 *        "target": "all" | "role" | "email" | "vendor",
 *        "value":  "vendor"        // مطلوب لكل target عدا "all"
 *        "title":  "عنوان الإشعار",
 *        "body":   "نص الإشعار",
 *        "data":   { "url": "/orders/123", ... }   // اختياري
 *      }
 *
 *  🪪 المصادقة:
 *      أرسل هيدر:  x-secret: <NOTIFY_SECRET>
 * ══════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

/* ───────────────────────────────────────────────
   تهيئة Firebase Admin مرة واحدة فقط لكل Lambda
   (Netlify Functions تعيد استخدام الـ container)
   ─────────────────────────────────────────────── */
let _initialized = false;

function initAdmin() {
  if (_initialized || admin.apps.length) { _initialized = true; return; }

  let credential;
  let projectId = process.env.FIREBASE_PROJECT_ID || undefined;

  // ── الخيار 1 (الموصى به): JSON كامل في FIREBASE_SERVICE_ACCOUNT ──
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    let svc;
    try {
      svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT ليس JSON صالحاً. ' +
        'تأكد من نسخ المحتوى كاملاً بين علامات اقتباس مفردة في Netlify. السبب: ' + e.message
      );
    }

    // أحياناً تُحفظ الـ \n على شكل \\n عند اللصق → نُصلحها
    if (svc.private_key && svc.private_key.indexOf('\\n') !== -1) {
      svc.private_key = svc.private_key.replace(/\\n/g, '\n');
    }

    credential = admin.credential.cert(svc);
    if (!projectId) projectId = svc.project_id;
  }
  // ── الخيار 2 (Fallback): متغيرات منفصلة ──
  else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    credential = admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
  }
  // ── الخيار 3 (Fallback): مسار ملف JSON خارجي ──
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    credential = admin.credential.applicationDefault();
  }
  else {
    throw new Error(
      'لا توجد بيانات اعتماد لـ Firebase Admin. ' +
      'أضف FIREBASE_SERVICE_ACCOUNT في Netlify → Environment variables.'
    );
  }

  admin.initializeApp({ credential, projectId });
  _initialized = true;
}

/* ───────────────────────────────────────────────
   جلب التوكنات من Supabase وفق فلتر
   ─────────────────────────────────────────────── */
async function fetchTokens(filter = '') {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL أو SUPABASE_KEY غير معرّفة في المتغيرات.');
  }

  const url = `${SUPABASE_URL}/rest/v1/fcm_tokens?select=token,user_email,role` +
              (filter ? '&' + filter : '');

  const res = await fetch(url, {
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!res.ok) throw new Error('Supabase fetch failed: ' + res.status + ' ' + await res.text());
  const rows = await res.json();
  return rows.map(r => r.token).filter(Boolean);
}

/* ───────────────────────────────────────────────
   تنظيف التوكنات الميتة من Supabase
   ─────────────────────────────────────────────── */
async function cleanupTokens(tokens) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  for (const t of tokens) {
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/fcm_tokens?token=eq.${encodeURIComponent(t)}`,
        {
          method: 'DELETE',
          headers: {
            apikey:        SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );
    } catch (e) {
      console.error('[cleanupTokens] فشل حذف توكن:', e.message);
    }
  }
}

/* ───────────────────────────────────────────────
   الإرسال الأساسي عبر FCM Admin
   ─────────────────────────────────────────────── */
async function sendPush(tokens, title, body, data = {}) {
  if (!tokens || !tokens.length) {
    return { successCount: 0, failureCount: 0, message: 'لا توجد توكنات للإرسال' };
  }

  // 🎯 data-only payload — تظهر الإشعارات عبر Service Worker
  //    لذلك لا نضع notification الجذري لتجنّب التكرار
  const message = {
    data: Object.fromEntries(
      Object.entries({
        title,
        body,
        url:   data.url   || '/',
        icon:  data.icon  || '/icon-192.png',
        badge: data.badge || '/icon-192.png',
        tag:   data.tag   || 'general',
        ...data
      }).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: 'high',
      ttl: 60 * 60 * 24 * 1000 // 24 ساعة
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default', badge: 1, 'mutable-content': 1 } }
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' }
    }
  };

  // FCM Admin يدعم 500 توكن لكل طلب
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  let totalSuccess = 0;
  let totalFail    = 0;
  const invalidTokens = [];

  for (const chunk of chunks) {
    const resp = await admin.messaging().sendEachForMulticast({ ...message, tokens: chunk });
    totalSuccess += resp.successCount;
    totalFail    += resp.failureCount;

    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalidTokens.push(chunk[i]);
        }
        console.error('[FCM] فشل:', (chunk[i] || '').slice(0, 20) + '...', code);
      }
    });
  }

  if (invalidTokens.length) await cleanupTokens(invalidTokens);

  return {
    successCount: totalSuccess,
    failureCount: totalFail,
    cleaned:      invalidTokens.length
  };
}

/* ───────────────────────────────────────────────
   Netlify Function — HTTP handler
   ─────────────────────────────────────────────── */
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type':                 'application/json; charset=utf-8'
};

exports.handler = async (event) => {
  // ── Preflight ──
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'استخدم POST فقط' })
    };
  }

  // ── مصادقة عبر سر اختياري ──
  if (process.env.NOTIFY_SECRET) {
    const provided =
      (event.headers && (event.headers['x-secret'] || event.headers['X-Secret'])) || '';
    if (provided !== process.env.NOTIFY_SECRET) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'غير مصرّح — هيدر x-secret غير صحيح' })
      };
    }
  }

  try {
    initAdmin();

    const payload = JSON.parse(event.body || '{}');
    const {
      target = 'all',
      value  = '',
      title  = '',
      body   = '',
      data   = {}
    } = payload;

    if (!title || !body) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'الحقلان title و body مطلوبان' })
      };
    }

    // بناء فلتر Supabase وفق نوع الجمهور
    let filter = '';
    if (target === 'role'   && value) filter = `role=eq.${encodeURIComponent(value)}`;
    else if (target === 'email'  && value) filter = `user_email=eq.${encodeURIComponent(value)}`;
    else if (target === 'vendor' && value) filter = `vendor_id=eq.${encodeURIComponent(value)}`;
    // target === 'all' → بدون فلتر

    const tokens = await fetchTokens(filter);
    const result = await sendPush(tokens, title, body, data);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, target, count: tokens.length, ...result })
    };
  } catch (e) {
    console.error('[send-notification] خطأ:', e);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};

/* ───────────────────────────────────────────────
   تصدير دوال مساعدة لو رغبت في الاستخدام البرمجي
   ─────────────────────────────────────────────── */
module.exports.initAdmin    = initAdmin;
module.exports.fetchTokens  = fetchTokens;
module.exports.sendPush     = sendPush;
module.exports.cleanupTokens = cleanupTokens;
