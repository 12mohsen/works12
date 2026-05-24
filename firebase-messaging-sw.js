// ══════════════════════════════════════════════════════════════
// firebase-messaging-sw.js
// Service Worker لاستقبال إشعارات FCM في الخلفية
// ──────────────────────────────────────────────────────────────
// مكان الملف: الجذر (root) لموقعك — بجوار index.html مباشرة
//   يجب أن يكون الرابط: https://yoursite.com/firebase-messaging-sw.js
// ══════════════════════════════════════════════════════════════

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ── إعدادات مشروعك على Firebase ──
firebase.initializeApp({
  apiKey: "AIzaSyAleLvowSo5FDhkQesi_yYOEMXW-pPQMnY",
  authDomain: "works12.firebaseapp.com",
  projectId: "works12",
  storageBucket: "works12.firebasestorage.app",
  messagingSenderId: "522854999112",
  appId: "1:522854999112:web:e3282c6906f6d23384247d"
});

const messaging = firebase.messaging();

// ══════════════════════════════════════════════════════════════
// استقبال الإشعارات في الخلفية (التطبيق/المتصفح مغلق أو في الخلفية)
// ══════════════════════════════════════════════════════════════
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] إشعار خلفية:', payload);

  var notificationTitle = payload.notification?.title || 'إشعار جديد';
  var notificationOptions = {
    body: payload.notification?.body || '',
    icon: payload.data?.icon || '/icon-192.png',
    badge: '/badge-72.png',
    dir: 'rtl',
    lang: 'ar',
    tag: 'notif-' + Date.now(),
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'فتح التطبيق' },
      { action: 'close', title: 'إغلاق' }
    ]
  };

  // إبلاغ الصفحة المفتوحة (إن وجدت) لتشغيل الصوت
  clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
    cls.forEach(function(client) {
      client.postMessage({ type: 'FCM_NOTIFICATION', title: notificationTitle, body: notificationOptions.body });
    });
  });

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// ══════════════════════════════════════════════════════════════
// الضغط على الإشعار — فتح التطبيق أو التركيز عليه
// ══════════════════════════════════════════════════════════════
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if ('focus' in windowClients[i]) return windowClients[i].focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(event.notification.data?.url || '/');
      }
    })
  );
});

// ── تفعيل فوري ──
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) { event.waitUntil(clients.claim()); });
