/**
 * ══════════════════════════════════════════════════════════════
 *  api/send-notification.js  —  Netlify Function (HTTP endpoint)
 *
 *  ✅ يقرأ بيانات Firebase Admin حصراً من process.env.FIREBASE_SERVICE_ACCOUNT
 *      عبر JSON.parse تلقائياً (مع fallback لمتغيرات منفصلة).
 *  ✅ Payload عبارة عن DATA-ONLY بالكامل — لا يحتوي على حقل
 *      notification جذري، حتى يمر الإشعار خلال Service Worker
 *      عند الآدمن وتُطبَّق إعدادات الصوت/الاهتزاز/requireInteraction.
 *  ✅ عند الإرسال للآدمن: الأولوية القصوى + صوت default +
 *      requireInteraction = true + Urgency=high + TTL طويل.
 *
 *  📋 المتغيرات المطلوبة في Netlify (Site → Environment variables):
 *      ✅ FIREBASE_SERVICE_ACCOUNT  ← الـ JSON كاملاً (سطر واحد)
 *      ✅ FIREBASE_PROJECT_ID        ← works12
 *      ✅ SUPABASE_URL
 *      ✅ SUPABASE_KEY               (service_role مفضّل لجلب التوكنات)
 *      🟡 NOTIFY_SECRET (اختياري)   ← سر يُمرر في هيدر x-secret
 *
 *  📨 الطلب (POST JSON):
 *      {
 *        "target": "all" | "role" | "email" | "vendor",
 *        "value":  "admin",          // لازم لكل target عدا "all"
 *        "title":  "رسالة من شريك",
 *        "body":   "وصلك سؤال جديد",
 *        "data":   { "url": "/admin/messages", ... }   // اختياري
 *      }
 *
 *  المسار النهائي بعد النشر:
 *      POST  /.netlify/functions/send-notification
 *      أو عبر redirect:  POST /api/send-notification
 * ══════════════════════════════════════════════════════════════ */

const admin = require('firebase-admin');

/* ─────────────────────────────────────────────
   تهيئة Firebase Admin مرة واحدة لكل Lambda
   ───────────────────────────────────────────── */
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
        'انسخ المحتوى كاملاً (بين {} ) إلى Netlify. السبب: ' + e.message
      );
    }
    // إصلاح \\n في private_key لو حدث عند اللصق
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
  // ── الخيار 3 (Fallback): مسار JSON خارجي ──
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

/* ─────────────────────────────────────────────
   جلب التوكنات من Supabase وفق فلتر
   ───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   تنظيف التوكنات الميتة من Supabase
   ───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   بناء الـ payload (data-only) مع تمييز الآدمن
   ─────────────────────────────────────────────
   - data-only يضمن عبور الإشعار عبر Service Worker
     حتى تطبَّق إعدادات الصوت/الاهتزاز/requireInteraction
     من ملف firebase-messaging-sw.js على جهاز الآدمن.
   - إذا كان المستلم آدمن، نزيد الإلحاح:
       requireInteraction = "true"  (الإشعار يبقى حتى يضغط)
       sound              = "default"
       priority           = "high"
   ───────────────────────────────────────────── */
function buildMessage(title, body, data = {}, opts = {}) {
  const isAdmin = !!opts.isAdmin;

  // كل قيم data في FCM يجب أن تكون نصية
  const fullData = {
    title,
    body,
    url:                data.url   || '/',
    icon:               data.icon  || '/icon-192.png',
    badge:              data.badge || '/icon-192.png',
    tag:                data.tag   || (isAdmin ? 'admin-msg-' + Date.now() : 'general'),
    // ⚡ مفاتيح يقرأها firebase-messaging-sw.js و foreground handler:
    requireInteraction: isAdmin ? 'true'    : (data.requireInteraction || 'false'),
    sound:              isAdmin ? 'default' : (data.sound              || 'default'),
    priority:           isAdmin ? 'high'    : (data.priority           || 'normal'),
    renotify:           'true',
    ...data
  };

  return {
    // ⚠️ بدون حقل notification جذري حتى يمر الإشعار خلال SW
    data: Object.fromEntries(
      Object.entries(fullData).map(([k, v]) => [k, String(v)])
    ),

    // ── Android ──
    android: {
      priority: 'high',
      ttl: 60 * 60 * 24 * 1000, // 24 ساعة
      // ملاحظة: لا نضع notification هنا أيضاً (data-only)
    },

    // ── iOS (APNS) — صوت + شارة + رفع مستوى ──
    apns: {
      headers: {
        'apns-priority':       '10',
        'apns-push-type':      'alert',
        'apns-expiration':     '0'
      },
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          badge: 1,
          'mutable-content': 1,
          'content-available': 1
        }
      }
    },

    // ── Web Push (هذا الذي يخص الآدمن في المتصفح) ──
    webpush: {
      headers: {
        Urgency: 'high',
        TTL:     '86400'
      }
      // لا نضع webpush.notification هنا — Service Worker
      // (firebase-messaging-sw.js) هو من سيعرض الإشعار
      // بكامل إعداداته (silent:false, renotify, vibrate, requireInteraction).
    }
  };
}

/* ─────────────────────────────────────────────
   الإرسال الأساسي عبر FCM Admin
   ───────────────────────────────────────────── */
async function sendPush(tokens, title, body, data = {}, opts = {}) {
  if (!tokens || !tokens.length) {
    return { successCount: 0, failureCount: 0, message: 'لا توجد توكنات للإرسال' };
  }

  const message = buildMessage(title, body, data, opts);

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

/* ─────────────────────────────────────────────
   Netlify Function — HTTP handler
   ───────────────────────────────────────────── */
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

    // بناء الفلتر بحسب نوع الجمهور
    let filter = '';
    let isAdmin = false;
    if (target === 'role' && value) {
      filter = `role=eq.${encodeURIComponent(value)}`;
      if (String(value).toLowerCase() === 'admin') isAdmin = true;
    } else if (target === 'email' && value) {
      filter = `user_email=eq.${encodeURIComponent(value)}`;
    } else if (target === 'vendor' && value) {
      filter = `vendor_id=eq.${encodeURIComponent(value)}`;
    }
    // target === 'all' → بدون فلتر

    // علم خارجي يطلب إجبار وضع الآدمن
    if (data && (data.forceAdmin === true || data.forceAdmin === 'true')) {
      isAdmin = true;
    }

    const tokens = await fetchTokens(filter);
    const result = await sendPush(tokens, title, body, data, { isAdmin });

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, target, isAdmin, count: tokens.length, ...result })
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

/* ─────────────────────────────────────────────
   تصدير دوال مساعدة (للاستخدام البرمجي)
   ───────────────────────────────────────────── */
module.exports.initAdmin     = initAdmin;
module.exports.fetchTokens   = fetchTokens;
module.exports.sendPush      = sendPush;
module.exports.cleanupTokens = cleanupTokens;
module.exports.buildMessage  = buildMessage;
