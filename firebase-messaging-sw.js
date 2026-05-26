/* ════════════════════════════════════════════════════════════════
   firebase-messaging-sw.js
   Service Worker لاستقبال إشعارات FCM في الخلفية
   ⚠️ يجب رفعه إلى **جذر النطاق** بالضبط بهذا الاسم:
       https://yourdomain.com/firebase-messaging-sw.js

   🎯 يعتمد كلياً على onBackgroundMessage مع رسالة data-only
       (لا push listener يدوي — تجنّباً لتكرار الإشعار).

   🔐 هذه القيم Placeholders آمنة للرفع على GitHub العام.
       استبدلها يدوياً بمفاتيح Firebase الخاصة بمشروعك
       (Firebase Console → Project Settings → General → Your apps).
       جميع هذه القيم خاصة بالـ Frontend وآمنة كشفها — لا تحتوي
       على أي مفتاح خادم سري.
   ════════════════════════════════════════════════════════════════ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_FIREBASE_APP_ID"
});

const messaging = firebase.messaging();

/* ────────────────────────────────────────────────────────────────
   onBackgroundMessage — يُستدعى حصراً عندما يكون التطبيق مغلقاً
   أو في تبويب غير مرئي. لأن السيرفر يرسل data-only
   (بدون payload.notification الجذري) فالمتصفح لا يعرض شيئاً
   تلقائياً — Service Worker مسؤول عن عرض الإشعار بنفسه.
   ──────────────────────────────────────────────────────────────── */
messaging.onBackgroundMessage(function(payload){
  console.log('[FCM SW] background payload:', payload);

  const d = payload.data || {};

  const title = d.title || 'سوق الأعمال المرخّص';
  const options = {
    body:               d.body || '',
    icon:               d.icon  || '/icon-192.png',
    badge:              d.badge || '/icon-192.png',
    image:              d.image || undefined,
    tag:                d.tag   || 'general',
    renotify:           true,
    requireInteraction: d.requireInteraction === 'true' || d.requireInteraction === true,
    silent:             false,                              // اعتمد صوت الجوال الافتراضي
    vibrate:            [200, 100, 200, 100, 200],          // اهتزاز ثابت لكل الإشعارات
    timestamp:          Date.now(),
    dir:                'rtl',
    lang:               'ar',
    data: {
      url:  d.url || '/',
      tag:  d.tag || 'general',
      ...d
    },
    actions: [
      { action: 'open',  title: '📂 فتح' },
      { action: 'close', title: '✖ إغلاق' }
    ]
  };

  return self.registration.showNotification(title, options);
});

/* ────────────────────────────────────────────────────────────────
   عند نقر المستخدم على الإشعار في ستارة الجوال:
   - إذا التطبيق مفتوح في تاب → ركّز عليه
   - إذا التطبيق مغلق → افتحه على الـ URL المخصّص
   ──────────────────────────────────────────────────────────────── */
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  if (event.action === 'close') return;

  const data = event.notification.data || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.indexOf(self.location.origin) !== -1) {
          try { client.postMessage({ type: 'fcm-notification-click', url: targetUrl, data: data }); } catch(e) {}
          if ('focus' in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

/* ⚠️ لا نضيف self.addEventListener('push', ...) — Firebase Messaging
   compat يلتقطه داخلياً ويحوّله إلى onBackgroundMessage. إضافة push
   listener يدوي تسبّب تكرار الإشعار. */

// تثبيت فوري + السيطرة على جميع التابات بدون إعادة تحميل
self.addEventListener('install',  ()      => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
