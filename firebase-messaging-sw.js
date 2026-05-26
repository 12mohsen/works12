/* ════════════════════════════════════════════════════════════════
   firebase-messaging-sw.js
   Service Worker لاستقبال إشعارات FCM في الخلفية
   ⚠️ يجب رفعه إلى **جذر النطاق** بالضبط بهذا الاسم:
       https://yourdomain.com/firebase-messaging-sw.js

   🎯 يعتمد كلياً على onBackgroundMessage مع رسالة data-only من السيرفر
       (لا push listener يدوي — تجنّباً لتكرار الإشعار).

   🔐 القيم أدناه Placeholders آمنة للرفع على GitHub العام.
       استبدلها بمفاتيح مشروعك من:
       Firebase Console → Project Settings → General → Your apps.
       (مفاتيح Firebase Web client آمنة في الواجهة — ليست أسراراً).
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
   أو في تبويب غير مرئي. لأن السيرفر يرسل data-only فالمتصفح لا
   يعرض شيئاً تلقائياً — Service Worker مسؤول عن كل الإعدادات.

   ✅ المعالجة هنا تَفرِض على المتصفح:
        • silent: false              → تشغيل الصوت الافتراضي للنظام
        • renotify: true             → إعادة التنبيه حتى لو نفس الـ tag
        • requireInteraction: true   → الإشعار لا يختفي حتى يضغط الآدمن
        • vibrate: نمط ثابت          → اهتزاز على الجوال
        • tag فريد لكل رسالة          → ضمان عدم اندماج الرسائل
   ──────────────────────────────────────────────────────────────── */
messaging.onBackgroundMessage(function(payload){
  console.log('[FCM SW] background payload:', payload);

  const d = payload.data || {};

  // تمييز رسائل الآدمن (يأتي من السيرفر بـ priority=high)
  const isAdmin = d.priority === 'high' ||
                  d.requireInteraction === 'true' ||
                  d.requireInteraction === true;

  // 🔁 tag فريد لكل رسالة جديدة كي يُعاد التنبيه (لا يندمج صامتاً)
  const uniqueTag = d.tag || ('msg-' + Date.now());

  const title = d.title || 'سوق الأعمال المرخّص';
  const options = {
    body:               d.body || '',
    icon:               d.icon  || '/icon-192.png',
    badge:              d.badge || '/icon-192.png',
    image:              d.image || undefined,
    tag:                uniqueTag,

    // ⚡ الإعدادات المهمة لحل مشكلة "الإشعار يصل بدون صوت":
    silent:             false,                          // ⭐ تشغيل صوت النظام الافتراضي
    renotify:           true,                           // ⭐ إعادة التنبيه مع كل رسالة
    requireInteraction: true,                           // ⭐ يبقى الإشعار حتى يضغط الآدمن
    vibrate:            [300, 150, 300, 150, 300, 150, 300], // اهتزاز طويل ومميز
    timestamp:          Date.now(),
    dir:                'rtl',
    lang:               'ar',

    data: {
      url:    d.url || '/',
      tag:    uniqueTag,
      isAdmin: isAdmin,
      ...d
    },
    actions: [
      { action: 'open',  title: '📂 فتح' },
      { action: 'close', title: '✖ إغلاق' }
    ]
  };

  // إخبار كل التابات المفتوحة (لو وُجد بعضها) لتشغيل صوت داخلي إضافي
  // — مفيد إذا كان الآدمن لديه تاب مفتوح خفي على جهاز ثانٍ.
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function(clients){
      clients.forEach(function(c){
        try {
          c.postMessage({
            type: 'fcm-background-message',
            payload: { title: title, body: d.body || '', data: d, isAdmin: isAdmin }
          });
        } catch(e) {}
      });
    });

  return self.registration.showNotification(title, options);
});

/* ────────────────────────────────────────────────────────────────
   عند نقر المستخدم على الإشعار:
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
          try {
            client.postMessage({
              type: 'fcm-notification-click',
              url:  targetUrl,
              data: data
            });
          } catch(e) {}
          if ('focus' in client) return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

/* ⚠️ لا نضيف self.addEventListener('push', ...) — Firebase Messaging
   compat يلتقطه داخلياً ويحوّله إلى onBackgroundMessage.
   إضافة push listener يدوي تسبّب تكرار الإشعار. */

// تثبيت فوري + السيطرة على جميع التابات بدون إعادة تحميل
self.addEventListener('install',  ()      => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
