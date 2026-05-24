// ══════════════════════════════════════════════════════════════
// fcm-client.js
// كود الواجهة — طلب إذن الإشعارات + جلب Token + حفظه في Supabase
// ──────────────────────────────────────────────────────────────
// طريقة الاستخدام:
//   أضف في index.html قبل </body>:
//     <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
//     <script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js"></script>
//     <script src="fcm-client.js"></script>
//
//   ثم استدعِ setupFCMNotifications() بعد تسجيل الدخول مباشرة
// ══════════════════════════════════════════════════════════════

// ── إعدادات مشروعك ──
var FCM_CONFIG = {
  apiKey: "AIzaSyAleLvowSo5FDhkQesi_yYOEMXW-pPQMnY",
  authDomain: "works12.firebaseapp.com",
  projectId: "works12",
  storageBucket: "works12.firebasestorage.app",
  messagingSenderId: "522854999112",
  appId: "1:522854999112:web:e3282c6906f6d23384247d"
};

// ── مفتاح VAPID ──
var FCM_VAPID_KEY = "BKQ5xwggV0mkAIMjHuqJYb0--GmHkcUORFKNvHT2Gs4a_6kmrpM44Bu2mWLCSnaFTEoq142ufWNnzHMuJaW_bXc";

// ── رابط دالة السيرفر (غيّره بعد النشر) ──
var FCM_SEND_URL = "https://works12.vercel.app/api/send-notification";

// ══════════════════════════════════════════════════════════════
var fcmMessaging = null;

function initFCM() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FCM_CONFIG);
    }
    fcmMessaging = firebase.messaging();
    console.log('[FCM] Firebase initialized');

    // استقبال الإشعارات أثناء فتح التطبيق (Foreground)
    fcmMessaging.onMessage(function(payload) {
      console.log('[FCM] Foreground:', payload);
      showForegroundNotification(payload);
    });

    return true;
  } catch (err) {
    console.error('[FCM] Init error:', err);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// عرض الإشعار داخل التطبيق (أثناء الفتح)
// ══════════════════════════════════════════════════════════════
function showForegroundNotification(payload) {
  var title = payload.notification?.title || 'إشعار جديد';
  var body = payload.notification?.body || '';

  // Toast داخل التطبيق
  if (typeof toast === 'function') {
    toast(title + ': ' + body, 'ok');
  }

  // إشعار نظام إذا الصفحة في الخلفية
  if (document.hidden && Notification.permission === 'granted') {
    new Notification(title, { body: body, icon: '/icon-192.png', dir: 'rtl' });
  }
}

// ══════════════════════════════════════════════════════════════
// تسجيل Service Worker + طلب إذن + جلب Token
// ══════════════════════════════════════════════════════════════
function registerFCMAndGetToken() {
  return new Promise(function(resolve, reject) {

    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      reject(new Error('المتصفح لا يدعم الإشعارات'));
      return;
    }

    if (!fcmMessaging && !initFCM()) {
      reject(new Error('فشل تهيئة Firebase'));
      return;
    }

    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(function(registration) {
        console.log('[FCM] SW registered');

        return Notification.requestPermission().then(function(permission) {
          if (permission !== 'granted') {
            throw new Error('المستخدم رفض إذن الإشعارات');
          }
          console.log('[FCM] Permission granted');

          return fcmMessaging.getToken({
            vapidKey: FCM_VAPID_KEY,
            serviceWorkerRegistration: registration
          });
        });
      })
      .then(function(token) {
        if (!token) throw new Error('لم يتم الحصول على Token');
        console.log('[FCM] Token:', token.substring(0, 20) + '...');
        resolve(token);
      })
      .catch(function(err) {
        console.error('[FCM] Error:', err);
        reject(err);
      });
  });
}

// ══════════════════════════════════════════════════════════════
// حفظ Token في Supabase مع دور المستخدم
// ══════════════════════════════════════════════════════════════
function saveFCMTokenToSupabase(token) {
  if (!currentUser) {
    console.warn('[FCM] No user logged in');
    return Promise.reject(new Error('لا يوجد مستخدم'));
  }

  var payload = {
    user_id: currentUser.id || currentUser.email,
    user_email: currentUser.email || '',
    user_name: currentUser.name || '',
    user_role: currentUser.role || 'customer',
    fcm_token: token,
    device_info: navigator.userAgent.substring(0, 200),
    is_active: true,
    updated_at: new Date().toISOString()
  };

  // Upsert — إذا التوكن موجود حدّثه، وإلا أدخله
  return supaFetch('fcm_tokens', 'POST', payload, '?on_conflict=fcm_token')
    .then(function(res) {
      console.log('[FCM] Token saved for', currentUser.role, ':', currentUser.email);
      return res;
    })
    .catch(function(err) {
      console.error('[FCM] Save error:', err);
      throw err;
    });
}

// ══════════════════════════════════════════════════════════════
// الدالة الرئيسية — استدعِها بعد تسجيل الدخول
// setupFCMNotifications();
// ══════════════════════════════════════════════════════════════
function setupFCMNotifications() {
  registerFCMAndGetToken()
    .then(function(token) {
      return saveFCMTokenToSupabase(token);
    })
    .then(function() {
      console.log('[FCM] Setup complete!');
    })
    .catch(function(err) {
      console.warn('[FCM] Setup skipped:', err.message);
    });
}

// ══════════════════════════════════════════════════════════════
// دوال الإرسال — للأدمن
// ══════════════════════════════════════════════════════════════

// جلب التوكنات حسب الدور
function getFCMTokensByRole(role) {
  var query = '?select=fcm_token&is_active=eq.true';
  if (role && role !== 'all') {
    query += '&user_role=eq.' + role;
  }
  return supaFetch('fcm_tokens', 'GET', null, query).then(function(rows) {
    return (rows || []).map(function(r) { return r.fcm_token; });
  });
}

// إرسال إشعار حسب الدور (admin / vendor / customer / all)
function sendNotificationToRole(role, title, body) {
  return getFCMTokensByRole(role).then(function(tokens) {
    if (!tokens.length) {
      if (typeof toast === 'function') toast('لا يوجد مستخدمون مسجلون لهذا الدور', 'wa');
      return { success: false, error: 'no_tokens' };
    }

    return fetch(FCM_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: tokens, title: title, body: body })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.success && typeof toast === 'function') {
        toast('تم الإرسال (' + result.summary.sent + '/' + result.summary.total + ')', 'ok');
      }
      // تنظيف التوكنات المنتهية
      if (result.invalidTokens && result.invalidTokens.length) {
        result.invalidTokens.forEach(function(t) {
          supaFetch('fcm_tokens', 'DELETE', null, '?fcm_token=eq.' + encodeURIComponent(t));
        });
      }
      return result;
    });
  });
}

// إرسال إشعار لمستخدم محدد بالإيميل
function sendNotificationToUser(email, title, body) {
  return supaFetch('fcm_tokens', 'GET', null,
    '?select=fcm_token&is_active=eq.true&user_email=eq.' + encodeURIComponent(email)
  ).then(function(rows) {
    var tokens = (rows || []).map(function(r) { return r.fcm_token; });
    if (!tokens.length) {
      if (typeof toast === 'function') toast('المستخدم غير مسجل للإشعارات', 'wa');
      return { success: false, error: 'no_tokens' };
    }
    return fetch(FCM_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: tokens, title: title, body: body })
    }).then(function(r) { return r.json(); });
  });
}
