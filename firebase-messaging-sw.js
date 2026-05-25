// ══════════════════════════════════════════════════════════════
// firebase-messaging-sw.js — Service Worker لإشعارات FCM
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
// onBackgroundMessage — الرسائل الهجينة (notification+data)
// ──────────────────────────────────────────────────────────────
// عند وجود حقل notification، المتصفح يعرض الإشعار تلقائياً.
// هذا الـ handler يُستخدم لإبلاغ الصفحة المفتوحة فقط.
// ══════════════════════════════════════════════════════════════
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] onBackgroundMessage:', payload);

  // إبلاغ أي صفحة مفتوحة لتشغيل الصوت عند العودة
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
    cls.forEach(function(c) {
      c.postMessage({
        type: 'FCM_NOTIFICATION',
        playSound: true,
        title: (payload.data && payload.data.title) || '',
        body: (payload.data && payload.data.body) || ''
      });
    });
  });

  // ملاحظة: لا نحتاج showNotification هنا
  // لأن حقل notification في الرسالة يجعل المتصفح يعرض الإشعار تلقائياً
  // لكن نضيفه كشبكة أمان في حالة لم يعرضه المتصفح
});

// ══════════════════════════════════════════════════════════════
// الضغط على الإشعار — فتح التطبيق
// ══════════════════════════════════════════════════════════════
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] notificationclick:', event.action);
  event.notification.close();

  if (event.action === 'dismiss') return;

  var urlToOpen = 'https://works12.vercel.app/';

  // محاولة استخراج URL من بيانات الإشعار
  if (event.notification.data) {
    if (event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.data && event.notification.data.FCM_MSG.data.url) {
      urlToOpen = event.notification.data.FCM_MSG.data.url;
    } else if (event.notification.data.url) {
      urlToOpen = event.notification.data.url;
    }
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(cls) {
      // التركيز على نافذة مفتوحة
      for (var i = 0; i < cls.length; i++) {
        if ('focus' in cls[i]) {
          cls[i].postMessage({ type: 'FCM_NOTIFICATION', playSound: true });
          return cls[i].focus();
        }
      }
      // فتح نافذة جديدة
      return self.clients.openWindow(urlToOpen);
    })
  );
});

// ══════════════════════════════════════════════════════════════
// تفعيل فوري — بدون انتظار
// ══════════════════════════════════════════════════════════════
self.addEventListener('install', function() {
  console.log('[SW] Install — skipWaiting');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activate — claim clients');
  event.waitUntil(self.clients.claim());
});
