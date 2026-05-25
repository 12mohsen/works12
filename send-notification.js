// ══════════════════════════════════════════════════════════════
// send-notification.js — دالة سيرفر لإرسال إشعارات FCM
// ──────────────────────────────────────────────────────────────
// مكان الملف:
//   Vercel  → /api/send-notification.js
//   Netlify → /netlify/functions/send-notification.js
//
// متغير البيئة المطلوب:
//   FIREBASE_SERVICE_ACCOUNT = محتوى ملف JSON كاملاً (نص)
//
// تثبيت المكتبة:
//   npm install firebase-admin
// ══════════════════════════════════════════════════════════════

const admin = require('firebase-admin');

// ── تهيئة Firebase Admin مرة واحدة ──
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[FCM Server] Initialized');
  } catch (err) {
    console.error('[FCM Server] Init failed:', err.message);
  }
}

module.exports = async function handler(req, res) {

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'استخدم POST فقط' });
  }

  const { tokens, title, body, data } = req.body;

  // ── التحقق ──
  if (!tokens || !Array.isArray(tokens) || !tokens.length) {
    return res.status(400).json({ success: false, error: 'tokens مطلوب (مصفوفة)' });
  }
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title و body مطلوبان' });
  }

  try {
    // ── بناء الإشعار ──
    // مهم: نرسل data-only (بدون حقل notification)
    // هذا يُجبر Service Worker على الاشتغال في الخلفية
    // لأن المتصفح يتجاهل SW عند وجود حقل notification
    const message = {
      // كل البيانات في data فقط — لا notification هنا
      data: Object.assign({
        title: title,
        body: body,
        sound: 'true',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        timestamp: Date.now().toString()
      }, data || {}),

      // Android — أولوية عالية لإيقاظ الجهاز
      android: {
        priority: 'high',
        ttl: 86400000
      },

      // iOS (APNS) — أولوية فورية
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'background'
        },
        payload: {
          aps: {
            'content-available': 1,
            sound: 'default'
          }
        }
      },

      // Web Push — أولوية عالية + TTL طويل
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400'
        }
      }
    };

    // ── إرسال لكل Token ──
    const results = [];
    const invalidTokens = [];

    for (const token of tokens) {
      try {
        const msgId = await admin.messaging().send({ ...message, token });
        results.push({ token: token.substring(0, 12) + '...', success: true, messageId: msgId });
      } catch (err) {
        const isInvalid = [
          'messaging/invalid-registration-token',
          'messaging/registration-token-not-registered'
        ].includes(err.code);

        results.push({ token: token.substring(0, 12) + '...', success: false, error: err.code });
        if (isInvalid) invalidTokens.push(token);
      }
    }

    const sent = results.filter(r => r.success).length;

    return res.status(200).json({
      success: true,
      summary: { total: tokens.length, sent, failed: tokens.length - sent },
      invalidTokens,
      details: results
    });

  } catch (err) {
    console.error('[FCM Server] Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
