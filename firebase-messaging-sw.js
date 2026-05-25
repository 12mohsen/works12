// ══════════════════════════════════════════════════════════════
// firebase-messaging-sw.js — Service Worker لإشعارات FCM
// يعمل في الخلفية حتى لو التطبيق والمتصفح مغلقين تماماً
// ──────────────────────────────────────────────────────────────
// مكان الملف: جذر الموقع بجوار index.html
// ══════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAleLvowSo5FDhkQesi_yYOEMXW-pPQMnY",
  authDomain: "works12.firebaseapp.com",
  projectId: "works12",
  storageBucket: "works12.firebasestorage.app",
  messagingSenderId: "522854999112",
  appId: "1:522854999112:web:e3282c6906f6d23384247d"
});

var messaging = firebase.messaging();

// ══════════════════════════════════════════════════════════════
// الطريقة 1: onBackgroundMessage — تعمل مع رسائل FCM data-only
// ══════════════════════════════════════════════════════════════
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] onBackgroundMessage:', payload);

  var title = (payload.data && payload.data.title) || 'إشعار جديد';
  var body = (payload.data && payload.data.body) || '';
  var icon = (payload.data && payload.data.icon) || '/icon-192.png';

  var options = {
    body: body,
    icon: icon,
    badge: '/badge-72.png',
    dir: 'rtl',
    lang: 'ar',
    tag: 'fcm-' + Date.now(),
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    renotify: true,
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'فتح' },
      { action: 'dismiss', title: 'إغلاق' }
    ]
  };

  // إبلاغ الصفحة المفتوحة لتشغيل الصوت
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
    cls.forEach(function(c) {
      c.postMessage({ type: 'FCM_NOTIFICATION', title: title, body: body });
    });
  });

  return self.registration.showNotification(title, options);
});

// ══════════════════════════════════════════════════════════════
// الطريقة 2: push event مباشر — شبكة أمان إضافية
// يلتقط أي رسالة push لم تُعالج بالطريقة الأولى
// ══════════════════════════════════════════════════════════════
self.addEventListener('push', function(event) {
  // إذا Firebase عالجتها بالفعل — لا نكرر
  if (event.__handled) return;

  console.log('[SW] push event:', event);

  var data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch(e) {
    try { data = { data: { title: event.data.text(), body: '' } }; } catch(e2) {}
  }

  // استخراج البيانات من أي هيكل
  var title = (data.data && data.data.title) ||
              (data.notification && data.notification.title) ||
              'إشعار جديد';
  var body  = (data.data && data.data.body) ||
              (data.notification && data.notification.body) ||
              '';

  // التحقق: هل showNotification سيتم من onBackgroundMessage؟
  // ننتظر قليلاً — إذا لم يظهر إشعار، نعرضه نحن
  event.waitUntil(
    self.registration.getNotifications({ tag: 'fcm-' }).then(function(existing) {
      // إذا لم يكن هناك إشعار حديث (خلال ثانية)
      var recent = existing.filter(function(n) {
        return (Date.now() - (n.timestamp || 0)) < 3000;
      });

      if (recent.length === 0 && title) {
        return self.registration.showNotification(title, {
          body: body,
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          dir: 'rtl',
          lang: 'ar',
          tag: 'push-' + Date.now(),
          requireInteraction: true,
          vibrate: [300, 100, 300, 100, 300],
          renotify: true,
          data: data.data || {}
        });
      }
    })
  );
});

// ══════════════════════════════════════════════════════════════
// الضغط على الإشعار — فتح التطبيق
// ══════════════════════════════════════════════════════════════
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
      // التركيز على نافذة مفتوحة
      for (var i = 0; i < cls.length; i++) {
        if ('focus' in cls[i]) {
          cls[i].postMessage({ type: 'FCM_NOTIFICATION', title: '', body: '' });
          return cls[i].focus();
        }
      }
      // فتح نافذة جديدة
      return self.clients.openWindow(event.notification.data && event.notification.data.url || '/');
    })
  );
});

// ══════════════════════════════════════════════════════════════
// تفعيل فوري
// ══════════════════════════════════════════════════════════════
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) { event.waitUntil(self.clients.claim()); });
