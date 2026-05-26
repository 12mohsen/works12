# 🔧 حل خطأ 404 على firebase-messaging-sw.js

## التشخيص

عندما يطلب المتصفح `/firebase-messaging-sw.js` ويرجع 404، السبب أن الملف **غير موجود في جذر الموقع المنشور**. هذا أمر حرج لأن Firebase Cloud Messaging **يشترط** أن يكون الـ Service Worker في الجذر بالضبط.

اختبار سريع: افتح في المتصفح:
```
https://works12.netlify.app/firebase-messaging-sw.js
```
- إذا ظهر كود الملف → الموضع صحيح، المشكلة في مكان آخر.
- إذا ظهر "Page not found" → الملف ليس في جذر المستودع المنشور.

## الحل خطوة بخطوة

### 1️⃣ بنية المجلدات الصحيحة في مستودع GitHub

```
works12/                          ← جذر المستودع
├── index.html                    ← الفرونت إند
├── firebase-messaging-sw.js      ⭐ ← يجب أن يكون هنا في الجذر بالضبط
├── manifest.json
├── icon-192.png                  ← أيقونة الإشعار (192×192)
├── icon-512.png                  ← أيقونة التطبيق  (512×512)
├── netlify.toml                  ⭐ ← الجديد لإعدادات النشر
├── package.json                  ⭐ ← الجديد لتعريف firebase-admin
├── .gitignore
├── .env.example
└── api/
    └── send-notification.js      ← Netlify Function
```

### 2️⃣ تحقق من Netlify Dashboard

في لوحة Netlify:
1. **Site settings → Build & deploy → Build settings**
   - تأكد أن **Publish directory** فارغ أو `/` أو `.` (وليس `public` أو `dist`)
2. **Deploys → Last deploy → Deploy file browser**
   - ابحث عن `firebase-messaging-sw.js` — يجب أن يكون في القائمة العليا (الجذر)

### 3️⃣ ارفع الملفات الجديدة على GitHub

أضف هذه الملفات إلى الجذر:
- `netlify.toml` (يحدد `publish="."` و `functions="api"`)
- `package.json` (يعرّف `firebase-admin` لوظيفة السيرفر)
- `firebase-messaging-sw.js` (إذا لم يكن موجوداً، انسخه من هذا المجلد)

### 4️⃣ متغيرات البيئة في Netlify

تذكّر أن تكون موجودة في **Site settings → Environment variables**:
- `FIREBASE_SERVICE_ACCOUNT` ← JSON كامل
- `FIREBASE_PROJECT_ID` ← `works12`
- `SUPABASE_URL`
- `SUPABASE_KEY` ← يفضّل service_role لجلب التوكنات
- `NOTIFY_SECRET` (اختياري)

### 5️⃣ بعد الـ Push

Netlify ستعيد النشر تلقائياً. انتظر اكتمال البناء (دقيقتين تقريباً)، ثم اختبر:

```
https://works12.netlify.app/firebase-messaging-sw.js
→ يجب أن ترى كود الملف وليس 404

https://works12.netlify.app/api/send-notification
→ يجب أن يرد بـ "استخدم POST فقط" (لأنك فتحته بـ GET) — هذا دليل عمل الوظيفة

https://works12.netlify.app/notify-debug.html
→ صفحة التشخيص — املأ القيم واضغط "ابدأ كل الفحوصات"
```

## الأسباب الأخرى الأقل شيوعاً لـ 404 على SW

1. **اسم الملف خاطئ**: تأكد أنه `firebase-messaging-sw.js` بالضبط (لا شرطات إضافية، لا حروف كبيرة).
2. **مجلد فرعي**: إذا الملف في `/public/firebase-messaging-sw.js`، اضبط `publish = "public"` في `netlify.toml`.
3. **ملف لم يُرفع لـ Git**: تحقق `git status` و `git ls-files | grep firebase-messaging-sw`.
4. **`.gitignore` يستبعده**: ابحث في `.gitignore` عن أي قاعدة تستبعد `*.js` أو `firebase-*`.
5. **Netlify Build Plugins تحذفه**: إذا كانت لديك plugins، عطّلها مؤقتاً.

## نصيحة أخيرة

بعد كل تعديل على Service Worker، يحتاج المتصفح **إلغاء تسجيل الـ SW القديم** ليأخذ التحديث:

في DevTools (F12):
```
Application → Service Workers → "Unregister"
ثم Hard Reload (Ctrl+Shift+R أو ⌘+Shift+R)
```

أو من الكود (مرة واحدة):
```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
```
