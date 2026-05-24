import re

# ═══════════════════════════════════════════════════════════════
# إضافة صوت إشعار FCM مع تخطي حظر Autoplay
# ═══════════════════════════════════════════════════════════════

INPUT_FILE  = '/sessions/clever-busy-einstein/mnt/outputs/index.html'
OUTPUT_FILE = '/sessions/clever-busy-einstein/mnt/outputs/index.html'

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    code = f.read()

print(f"Original size: {len(code)} bytes")

# ══════════════════════════════════════════════════════════════
# FIX 1: إضافة نظام الصوت + تفعيله عند أول تفاعل مستخدم
# نضيفه قبل initFCM مباشرة
# ══════════════════════════════════════════════════════════════

old_init = "var fcmMessaging = null;"

new_init = """var fcmMessaging = null;

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

if old_init in code:
    code = code.replace(old_init, new_init, 1)
    print("FIX 1: Sound system added (Web Audio API)")
else:
    print("FIX 1 FAILED: Could not find insertion point")

# ══════════════════════════════════════════════════════════════
# FIX 2: تشغيل الصوت عند استقبال إشعار Foreground
# ══════════════════════════════════════════════════════════════

old_foreground = """    fcmMessaging.onMessage(function(payload) {
      console.log('[FCM] Foreground:', payload);
      var t = payload.notification?.title || '';
      var b = payload.notification?.body || '';
      if (typeof toast === 'function') toast(t + ': ' + b, 'ok');
      if (document.hidden && Notification.permission === 'granted') {
        new Notification(t, { body: b, icon: '/icon-192.png', dir: 'rtl' });
      }
    });"""

new_foreground = """    fcmMessaging.onMessage(function(payload) {
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

if old_foreground in code:
    code = code.replace(old_foreground, new_foreground, 1)
    print("FIX 2: Sound added to foreground notifications")
else:
    print("FIX 2 FAILED: Could not find foreground handler")

# ══════════════════════════════════════════════════════════════
# FIX 3: تشغيل الصوت عند الضغط على إشعار الخلفية (عودة للتطبيق)
# نضيف listener لرسائل الـ Service Worker
# ══════════════════════════════════════════════════════════════

old_setup_end = """function setupFCMNotifications() {
  registerFCMAndGetToken()
    .then(function(t) { return saveFCMTokenToSupabase(t); })
    .then(function() { console.log('[FCM] Ready!'); })
    .catch(function(e) { console.warn('[FCM] Skipped:', e.message); });
}"""

new_setup_end = """function setupFCMNotifications() {
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

if old_setup_end in code:
    code = code.replace(old_setup_end, new_setup_end, 1)
    print("FIX 3: SW message listener added for background sound")
else:
    print("FIX 3 FAILED: Could not find setupFCMNotifications")

# ══════════════════════════════════════════════════════════════
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(code)

print(f"\nFinal size: {len(code)} bytes")
print("Done!")
