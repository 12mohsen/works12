// ══════════════════════════════════════════════════════════════
// send-notification.js — دالة سيرفر لإرسال إشعارات FCM
// ──────────────────────────────────────────────────────────────
// مكان الملف:  /api/send-notification.js  (Vercel)
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
    // ══════════════════════════════════════════════════════════
    // رسالة هجينة: notification + data + webpush.notification
    // ──────────────────────────────────────────────────────────
    // notification → المتصفح يعرض الإشعار تلقائياً في الخلفية
    // data        → بيانات إضافية للـ foreground handler و SW
    // webpush.notification → تخصيص شكل الإشعار (اهتزاز، أيقونة، اتجاه)
    // ══════════════════════════════════════════════════════════
    const msgTag = 'fcm-' + Date.now();

    const message = {
      // الإشعار الأساسي — يظهر تلقائياً في الخلفية
      notification: {
        title: title,
        body: body
      },

      // بيانات إضافية — تصل للـ foreground handler و SW
      data: Object.assign({
        title: title,
        body: body,
        sound: 'true',
        timestamp: Date.now().toString()
      }, data || {}),

      // ── تخصيص Web Push (المتصفحات) ──
      webpush: {
        notification: {
          title: title,
          body: body,
          icon: 'https://works12.vercel.app/icon-192.png',
          badge: 'https://works12.vercel.app/badge-72.png',
          dir: 'rtl',
          lang: 'ar',
          tag: msgTag,
          renotify: true,
          requireInteraction: true,
          vibrate: [300, 100, 300, 100, 300],
          actions: [
            { action: 'open', title: 'فتح' },
            { action: 'dismiss', title: 'إغلاق' }
          ]
        },
        headers: {
          Urgency: 'high',
          TTL: '86400'
        },
        fcmOptions: {
          link: 'https://works12.vercel.app'
        }
      },

      // ── Android — أولوية عالية ──
      android: {
        priority: 'high',
        ttl: 86400000,
        notification: {
          title: title,
          body: body,
          icon: 'icon_192',
          color: '#1a73e8',
          sound: 'default',
          defaultVibrateTimings: true,
          defaultSound: true,
          channelId: 'fcm_default_channel'
        }
      },

      // ── iOS (APNS) ──
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert'
        },
        payload: {
          aps: {
            alert: { title: title, body: body },
            sound: 'default',
            badge: 1
          }
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
