import re

# ═══════════════════════════════════════════════════════════════
# إصلاح شامل لصوت الإشعارات — V2
# يستبدل نظام Web Audio API بنظام Audio Element + Base64 مدمج
# ═══════════════════════════════════════════════════════════════

INPUT_FILE  = '/sessions/clever-busy-einstein/mnt/outputs/index.html'
OUTPUT_FILE = '/sessions/clever-busy-einstein/mnt/outputs/index.html'

# قراءة ملف الصوت كـ base64
with open('/sessions/clever-busy-einstein/mnt/outputs/notification_sound_b64.txt', 'r') as f:
    sound_b64 = f.read().strip()

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    code = f.read()

print(f"Original size: {len(code)} bytes")

# ══════════════════════════════════════════════════════════════
# FIX 1: استبدال نظام الصوت القديم بالكامل
# حذف Web Audio API واستبداله بـ Audio Element + base64
# ══════════════════════════════════════════════════════════════

old_sound_system = """var fcmMessaging = null;

// ══════════════════════════════════════════════════════════════
// نظام صوت الإشعارات — Web Audio API (بدون ملف خارجي)
// ══════════════════════════════════════════════════════════════
var _fcmAudioCtx = null;
var _fcmAudioUnlocked = false;

// تفعيل AudioContext عند أول تفاعل (يتخطى حظر Autoplay)
function _unlockFCMAudio() {
  if (_fcmAudioUnlocked) return;
  try {
    _fcmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // تشغيل صوت صامت لفتح القفل
    var buf = _fcmAudioCtx.createBuffer(1, 1, 22050);
    var src = _fcmAudioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(_fcmAudioCtx.destination);
    src.start(0);
    _fcmAudioUnlocked = true;
    console.log('[FCM Sound] Audio unlocked');
  } catch(e) { console.warn('[FCM Sound] Unlock failed:', e); }
}

// ربط فتح القفل بأول نقرة/لمسة من المستخدم
document.addEventListener('click', _unlockFCMAudio, { once: false });
document.addEventListener('touchstart', _unlockFCMAudio, { once: false });

// تشغيل صوت تنبيه (نغمة مولّدة — لا تحتاج ملف)
function playFCMNotificationSound() {
  try {
    if (!_fcmAudioCtx) {
      _fcmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_fcmAudioCtx.state === 'suspended') _fcmAudioCtx.resume();

    var ctx = _fcmAudioCtx;

    // ── النغمة الأولى (عالية) ──
    var osc1 = ctx.createOscillator();
    var gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 880;       // نغمة A5
    gain1.gain.value = 1.0;           // أقصى صوت
    gain1.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    // ── النغمة الثانية (أعلى) بعد فاصل قصير ──
    var osc2 = ctx.createOscillator();
    var gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 1175;      // نغمة D6
    gain2.gain.value = 1.0;
    gain2.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.35);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.18);
    osc2.stop(ctx.currentTime + 0.35);

    // ── النغمة الثالثة (الأعلى) ──
    var osc3 = ctx.createOscillator();
    var gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.value = 1397;      // نغمة F6
    gain3.gain.value = 1.0;
    gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
    osc3.connect(gain3);
    gain3.connect(ctx.destination);
    osc3.start(ctx.currentTime + 0.38);
    osc3.stop(ctx.currentTime + 0.7);

    console.log('[FCM Sound] Playing notification sound');
  } catch(e) {
    console.warn('[FCM Sound] Play failed:', e);
  }
}"""

new_sound_system = """var fcmMessaging = null;

// ══════════════════════════════════════════════════════════════
// نظام صوت الإشعارات — Audio Element + Base64 مدمج
// يعمل على جميع الأجهزة والمتصفحات
// ══════════════════════════════════════════════════════════════
var _fcmSoundDataURI = "data:audio/wav;base64,""" + sound_b64 + """";
var _fcmAudioElement = null;
var _fcmAudioReady = false;

// تجهيز عنصر الصوت
function _prepareFCMAudio() {
  if (_fcmAudioElement) return;
  _fcmAudioElement = new Audio(_fcmSoundDataURI);
  _fcmAudioElement.volume = 1.0;
  _fcmAudioElement.preload = 'auto';
  _fcmAudioElement.addEventListener('canplaythrough', function() {
    _fcmAudioReady = true;
    console.log('[FCM Sound] Audio ready');
  });
  // محاولة تحميل مبكر
  _fcmAudioElement.load();
}

// فتح قفل الصوت عند أول تفاعل من المستخدم
function _unlockFCMAudio() {
  _prepareFCMAudio();
  if (_fcmAudioElement && !_fcmAudioReady) {
    // تشغيل صامت لفتح القفل
    _fcmAudioElement.volume = 0.01;
    var p = _fcmAudioElement.play();
    if (p && p.then) {
      p.then(function() {
        _fcmAudioElement.pause();
        _fcmAudioElement.currentTime = 0;
        _fcmAudioElement.volume = 1.0;
        _fcmAudioReady = true;
        console.log('[FCM Sound] Audio unlocked via interaction');
      }).catch(function() {});
    }
  }
}

// ربط فتح القفل بتفاعل المستخدم
['click', 'touchstart', 'touchend', 'keydown'].forEach(function(evt) {
  document.addEventListener(evt, _unlockFCMAudio, { once: true, passive: true });
});

// تشغيل صوت الإشعار
function playFCMNotificationSound() {
  console.log('[FCM Sound] Attempting to play...');
  _prepareFCMAudio();

  // الطريقة 1: Audio Element (الأكثر توافقاً)
  try {
    if (_fcmAudioElement) {
      _fcmAudioElement.currentTime = 0;
      _fcmAudioElement.volume = 1.0;
      var playPromise = _fcmAudioElement.play();
      if (playPromise && playPromise.then) {
        playPromise.then(function() {
          console.log('[FCM Sound] Playing via Audio Element');
        }).catch(function(e) {
          console.warn('[FCM Sound] Audio Element blocked:', e.message);
          // الطريقة 2: إنشاء عنصر صوت جديد (بديل)
          _playFCMSoundFallback();
        });
      }
      return;
    }
  } catch(e) {}

  // الطريقة 2: بديل
  _playFCMSoundFallback();
}

// طريقة بديلة — عنصر صوت جديد
function _playFCMSoundFallback() {
  try {
    var tempAudio = new Audio(_fcmSoundDataURI);
    tempAudio.volume = 1.0;
    tempAudio.play().then(function() {
      console.log('[FCM Sound] Playing via fallback');
    }).catch(function(e) {
      console.warn('[FCM Sound] Fallback also blocked:', e.message);
      // الطريقة 3: Web Audio API كملاذ أخير
      _playFCMSoundWebAudio();
    });
  } catch(e) {
    _playFCMSoundWebAudio();
  }
}

// طريقة أخيرة — Web Audio API
function _playFCMSoundWebAudio() {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    var freqs = [880, 1175, 1397];
    freqs.forEach(function(freq, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 1.0;
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18*(i+1) + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + 0.18*i);
      osc.stop(ctx.currentTime + 0.18*(i+1) + 0.15);
    });
    console.log('[FCM Sound] Playing via Web Audio API');
  } catch(e) {
    console.warn('[FCM Sound] All methods failed:', e);
  }
}"""

if old_sound_system in code:
    code = code.replace(old_sound_system, new_sound_system, 1)
    print("FIX 1: Sound system replaced with Audio Element + Base64 + 3 fallbacks")
else:
    print("FIX 1 FAILED: Could not find old sound system")

# ══════════════════════════════════════════════════════════════
# FIX 2: تحديث الـ Foreground handler ليعرض Notification مع إرسال الصوت دائماً
# ══════════════════════════════════════════════════════════════

old_fg = """    fcmMessaging.onMessage(function(payload) {
      console.log('[FCM] Foreground:', payload);
      var t = payload.notification?.title || '';
      var b = payload.notification?.body || '';

      // تشغيل صوت التنبيه فوراً
      playFCMNotificationSound();

      // عرض Toast داخل التطبيق
      if (typeof toast === 'function') toast(t + ': ' + b, 'ok');

      // إشعار نظام (مع صوت النظام الافتراضي)
      if (Notification.permission === 'granted') {
        var n = new Notification(t, { body: b, icon: '/icon-192.png', dir: 'rtl', silent: false });
        // إعادة تشغيل الصوت عند الضغط على الإشعار
        n.onclick = function() { window.focus(); };
      }
    });"""

new_fg = """    fcmMessaging.onMessage(function(payload) {
      console.log('[FCM] Foreground message received:', payload);
      var t = payload.notification?.title || payload.data?.title || 'إشعار جديد';
      var b = payload.notification?.body || payload.data?.body || '';

      // 1) تشغيل صوت التنبيه فوراً (3 طرق بديلة)
      playFCMNotificationSound();

      // 2) عرض Toast داخل التطبيق
      if (typeof toast === 'function') toast(t + ': ' + b, 'ok');

      // 3) إشعار نظام (silent:true لتجنب صوت مزدوج — صوتنا يكفي)
      if (Notification.permission === 'granted') {
        try {
          var n = new Notification(t, {
            body: b, icon: '/icon-192.png', dir: 'rtl', lang: 'ar',
            tag: 'fcm-fg-' + Date.now(), silent: true,
            requireInteraction: false
          });
          n.onclick = function() { window.focus(); n.close(); };
          setTimeout(function() { n.close(); }, 8000);
        } catch(e) {}
      }

      // 4) اهتزاز الجهاز (موبايل)
      if (navigator.vibrate) {
        try { navigator.vibrate([200, 100, 200]); } catch(e) {}
      }
    });"""

if old_fg in code:
    code = code.replace(old_fg, new_fg, 1)
    print("FIX 2: Foreground handler updated with robust sound + vibration")
else:
    print("FIX 2 FAILED")

# ══════════════════════════════════════════════════════════════
# FIX 3: تجهيز الصوت مبكراً عند تسجيل الدخول
# ══════════════════════════════════════════════════════════════

old_setup = """function setupFCMNotifications() {
  registerFCMAndGetToken()
    .then(function(t) { return saveFCMTokenToSupabase(t); })
    .then(function() {
      console.log('[FCM] Ready!');
      // استقبال رسائل من Service Worker عند عودة المستخدم
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', function(event) {
          if (event.data && event.data.type === 'FCM_NOTIFICATION') {
            playFCMNotificationSound();
          }
        });
      }
    })
    .catch(function(e) { console.warn('[FCM] Skipped:', e.message); });
}"""

new_setup = """function setupFCMNotifications() {
  // تجهيز عنصر الصوت مبكراً
  _prepareFCMAudio();

  registerFCMAndGetToken()
    .then(function(t) { return saveFCMTokenToSupabase(t); })
    .then(function() {
      console.log('[FCM] Ready!');
      // استقبال رسائل من Service Worker لتشغيل الصوت
      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', function(event) {
          if (event.data && (event.data.type === 'FCM_NOTIFICATION' || event.data.playSound)) {
            console.log('[FCM] SW message — playing sound');
            playFCMNotificationSound();
          }
        });
      }
    })
    .catch(function(e) { console.warn('[FCM] Skipped:', e.message); });
}"""

if old_setup in code:
    code = code.replace(old_setup, new_setup, 1)
    print("FIX 3: setupFCMNotifications updated with early audio prep")
else:
    print("FIX 3 FAILED")

# ══════════════════════════════════════════════════════════════
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(code)

print(f"\nFinal size: {len(code)} bytes")
print("Done!")
