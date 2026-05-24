import re

# ═══════════════════════════════════════════════════════════════
# سكربت دمج إشعارات FCM في index.html
# يقوم بـ 3 أشياء:
#   1) إضافة سكربتات Firebase SDK + كود fcm-client قبل </body>
#   2) إضافة setupFCMNotifications() في saveSession()
#   3) إضافة setupFCMNotifications() في restoreSession()
# ═══════════════════════════════════════════════════════════════

INPUT_FILE  = '/sessions/clever-busy-einstein/mnt/uploads/5368d9a4-7f00-4af9-8d9a-cedee2b1c66f-1779634356715_index.html'
OUTPUT_FILE = '/sessions/clever-busy-einstein/mnt/outputs/index.html'

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    code = f.read()

print(f"Original size: {len(code)} bytes")

# ══════════════════════════════════════════════════════════════
# FIX 1: إضافة Firebase SDK + كود FCM Client قبل </body>
# ══════════════════════════════════════════════════════════════

fcm_block = '''
<!-- ══════════ Firebase Cloud Messaging ══════════ -->
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js"></script>
<script>
// ══════════════════════════════════════════════════════════════
// FCM Client — طلب إذن + جلب Token + حفظ في Supabase + إرسال
// ══════════════════════════════════════════════════════════════

var FCM_CONFIG = {
  apiKey: "AIzaSyAleLvowSo5FDhkQesi_yYOEMXW-pPQMnY",
  authDomain: "works12.firebaseapp.com",
  projectId: "works12",
  storageBucket: "works12.firebasestorage.app",
  messagingSenderId: "522854999112",
  appId: "1:522854999112:web:e3282c6906f6d23384247d"
};

var FCM_VAPID_KEY = "BKQ5xwggV0mkAIMjHuqJYb0--GmHkcUORFKNvHT2Gs4a_6kmrpM44Bu2mWLCSnaFTEoq142ufWNnzHMuJaW_bXc";
var FCM_SEND_URL = "https://works12.vercel.app/api/send-notification";

var fcmMessaging = null;

function initFCM() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(FCM_CONFIG);
    fcmMessaging = firebase.messaging();
    console.log('[FCM] initialized');
    fcmMessaging.onMessage(function(payload) {
      console.log('[FCM] Foreground:', payload);
      var t = payload.notification?.title || '';
      var b = payload.notification?.body || '';
      if (typeof toast === 'function') toast(t + ': ' + b, 'ok');
      if (document.hidden && Notification.permission === 'granted') {
        new Notification(t, { body: b, icon: '/icon-192.png', dir: 'rtl' });
      }
    });
    return true;
  } catch (e) { console.error('[FCM] Init error:', e); return false; }
}

function registerFCMAndGetToken() {
  return new Promise(function(resolve, reject) {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      reject(new Error('no support')); return;
    }
    if (!fcmMessaging && !initFCM()) { reject(new Error('init fail')); return; }

    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then(function(reg) {
        return Notification.requestPermission().then(function(perm) {
          if (perm !== 'granted') throw new Error('denied');
          return fcmMessaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
        });
      })
      .then(function(token) {
        if (!token) throw new Error('no token');
        console.log('[FCM] Token:', token.substring(0, 20) + '...');
        resolve(token);
      })
      .catch(reject);
  });
}

function saveFCMTokenToSupabase(token) {
  if (!currentUser) return Promise.reject(new Error('no user'));
  return supaFetch('fcm_tokens', 'POST', {
    user_id: currentUser.id || currentUser.email,
    user_email: currentUser.email || '',
    user_name: currentUser.name || '',
    user_role: currentUser.role || 'customer',
    fcm_token: token,
    device_info: navigator.userAgent.substring(0, 200),
    is_active: true,
    updated_at: new Date().toISOString()
  }, '?on_conflict=fcm_token').then(function(r) {
    console.log('[FCM] Token saved:', currentUser.role, currentUser.email);
    return r;
  });
}

function setupFCMNotifications() {
  registerFCMAndGetToken()
    .then(function(t) { return saveFCMTokenToSupabase(t); })
    .then(function() { console.log('[FCM] Ready!'); })
    .catch(function(e) { console.warn('[FCM] Skipped:', e.message); });
}

// ── دوال الإرسال (للأدمن) ──
function getFCMTokensByRole(role) {
  var q = '?select=fcm_token&is_active=eq.true';
  if (role && role !== 'all') q += '&user_role=eq.' + role;
  return supaFetch('fcm_tokens', 'GET', null, q).then(function(rows) {
    return (rows || []).map(function(r) { return r.fcm_token; });
  });
}

function sendNotificationToRole(role, title, body) {
  return getFCMTokensByRole(role).then(function(tokens) {
    if (!tokens.length) {
      if (typeof toast === 'function') toast('لا يوجد مسجلون لهذا الدور', 'wa');
      return { success: false };
    }
    return fetch(FCM_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: tokens, title: title, body: body })
    }).then(function(r) { return r.json(); })
      .then(function(result) {
        if (result.success && typeof toast === 'function')
          toast('تم الإرسال (' + result.summary.sent + '/' + result.summary.total + ')', 'ok');
        if (result.invalidTokens && result.invalidTokens.length)
          result.invalidTokens.forEach(function(t) {
            supaFetch('fcm_tokens', 'DELETE', null, '?fcm_token=eq.' + encodeURIComponent(t));
          });
        return result;
      });
  });
}

function sendNotificationToUser(email, title, body) {
  return supaFetch('fcm_tokens', 'GET', null,
    '?select=fcm_token&is_active=eq.true&user_email=eq.' + encodeURIComponent(email)
  ).then(function(rows) {
    var tokens = (rows || []).map(function(r) { return r.fcm_token; });
    if (!tokens.length) {
      if (typeof toast === 'function') toast('المستخدم غير مسجل للإشعارات', 'wa');
      return { success: false };
    }
    return fetch(FCM_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: tokens, title: title, body: body })
    }).then(function(r) { return r.json(); });
  });
}
</script>
'''

# إدراج قبل </body>
if '</body>' in code:
    code = code.replace('</body>', fcm_block + '</body>')
    print("FIX 1: Firebase SDK + FCM Client code injected before </body>")
else:
    print("FIX 1 FAILED: </body> not found")

# ══════════════════════════════════════════════════════════════
# FIX 2: إضافة setupFCMNotifications() في saveSession()
# ══════════════════════════════════════════════════════════════

old_save = "function saveSession(){if(currentUser){ss('mkt_session',currentUser);startAutoSync()}}"
new_save = "function saveSession(){if(currentUser){ss('mkt_session',currentUser);startAutoSync();try{setupFCMNotifications()}catch(e){}}}"

if old_save in code:
    code = code.replace(old_save, new_save)
    print("FIX 2: setupFCMNotifications() added to saveSession()")
else:
    print("FIX 2 FAILED: saveSession() pattern not found")

# ══════════════════════════════════════════════════════════════
# FIX 3: إضافة setupFCMNotifications() في restoreSession()
# عند استعادة الجلسة (المستخدم يعود للتطبيق)
# ══════════════════════════════════════════════════════════════

old_restore = "console.log('[Session] تم استعادة جلسة:',s.email);\n  return true;"
new_restore = "console.log('[Session] تم استعادة جلسة:',s.email);\n  try{setupFCMNotifications()}catch(e){}\n  return true;"

if old_restore in code:
    code = code.replace(old_restore, new_restore)
    print("FIX 3: setupFCMNotifications() added to restoreSession()")
else:
    print("FIX 3 FAILED: restoreSession() pattern not found")

# ══════════════════════════════════════════════════════════════
# حفظ الملف
# ══════════════════════════════════════════════════════════════
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(code)

print(f"\nFinal size: {len(code)} bytes")
print("Done! Output saved to:", OUTPUT_FILE)
