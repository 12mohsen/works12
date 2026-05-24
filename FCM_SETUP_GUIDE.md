# دليل إعداد إشعارات Firebase Cloud Messaging (FCM)

---

## هيكل الملفات

```
مشروعك/
├── index.html                    ← (الموجود) أضف سكربتات Firebase فيه
├── firebase-messaging-sw.js      ← ملف جديد — في الجذر (root) بجوار index.html
├── fcm-client.js                 ← ملف جديد — كود الواجهة (أو انسخه داخل index.html)
├── api/
│   └── send-notification.js      ← دالة السيرفر (Vercel / Netlify / Cloud Functions)
└── fcm_tokens_table.sql          ← شغّله في SQL Editor في Supabase (مرة واحدة)
```

---

## الخطوات بالترتيب

### الخطوة 1: إنشاء جدول التوكنات في Supabase

افتح **SQL Editor** في لوحة تحكم Supabase والصق محتوى `fcm_tokens_table.sql` وشغّله.

---

### الخطوة 2: ملء بيانات Firebase في الملفات

تحتاج بيانات مشروعك من **Firebase Console → Project Settings → General → Your apps**:

**في ملفين** (`firebase-messaging-sw.js` + `fcm-client.js`) استبدل:
- `YOUR_API_KEY` → مفتاح API
- `YOUR_PROJECT.firebaseapp.com` → Auth Domain
- `YOUR_PROJECT_ID` → Project ID
- `YOUR_PROJECT.appspot.com` → Storage Bucket
- `YOUR_SENDER_ID` → Messaging Sender ID
- `YOUR_APP_ID` → App ID

**في `fcm-client.js` فقط** استبدل:
- `YOUR_VAPID_KEY_HERE` → مفتاح VAPID من Cloud Messaging → Web Push certificates

---

### الخطوة 3: وضع Service Worker في الجذر

انسخ `firebase-messaging-sw.js` إلى **جذر موقعك** (نفس مكان index.html).

**مهم**: يجب أن يكون الرابط `https://yoursite.com/firebase-messaging-sw.js` يعمل مباشرة.

---

### الخطوة 4: إضافة السكربتات في index.html

أضف هذه الأسطر **قبل تاغ `</body>`** في index.html:

```html
<!-- Firebase SDK -->
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js"></script>

<!-- كود الإشعارات -->
<script src="fcm-client.js"></script>
```

---

### الخطوة 5: استدعاء التسجيل بعد تسجيل الدخول

في كود تسجيل الدخول الموجود (بعد أن يتم تعيين `currentUser`)، أضف:

```javascript
// بعد تسجيل الدخول بنجاح مباشرة
setupFCMNotifications();
```

هذا يطلب الإذن ويحفظ التوكن تلقائياً مع دور المستخدم.

---

### الخطوة 6: نشر دالة السيرفر

#### على Vercel:
1. ضع `send-notification.js` في مجلد `/api/`
2. في إعدادات المشروع على Vercel، أضف متغير بيئة:
   - **Name**: `FIREBASE_SERVICE_ACCOUNT`
   - **Value**: محتوى ملف JSON كاملاً (انسخ والصق كل النص)
3. ثبّت المكتبة:
   ```bash
   npm install firebase-admin
   ```

#### على Netlify Functions:
1. ضعه في `/netlify/functions/send-notification.js`
2. أضف متغير البيئة في Site Settings → Environment Variables
3. ثبّت المكتبة كما في Vercel

#### على Firebase Cloud Functions:
1. استخدم `firebase init functions`
2. ضع الكود داخل `functions/index.js`
3. متغير البيئة:
   ```bash
   firebase functions:config:set fcm.service_account="$(cat your-key.json)"
   ```

---

### الخطوة 7: تحديث رابط السيرفر

في `fcm-client.js`، غيّر `FCM_SEND_URL` ليشير لرابط دالتك:

```javascript
var FCM_SEND_URL = "https://your-project.vercel.app/api/send-notification";
```

---

## أمثلة الاستخدام

### إرسال إشعار لكل العملاء:
```javascript
sendNotificationToRole('customer', 'عرض جديد!', 'خصم 20% على جميع المنتجات');
```

### إرسال إشعار لكل الشركاء:
```javascript
sendNotificationToRole('vendor', 'طلب جديد', 'لديك طلب جديد في انتظار الموافقة');
```

### إرسال إشعار لمستخدم محدد:
```javascript
sendNotificationToUser('user@email.com', 'تحديث طلبك', 'تم شحن طلبك بنجاح');
```

### إرسال لجميع المستخدمين:
```javascript
sendNotificationToRole('all', 'إعلان مهم', 'تم تحديث سياسة المنصة');
```

---

## ملاحظات أمنية

1. **ملف JSON السري**: لا ترفعه أبداً على GitHub أو أي مكان عام. فقط ضعه كمتغير بيئة.
2. **VAPID Key**: هذا مفتاح عام ويمكن وضعه في الكود بأمان.
3. **Supabase Anon Key**: موجود بالفعل في مشروعك ولا مشكلة في استخدامه من الواجهة.
4. **التوكنات المنتهية**: الكود يحذفها تلقائياً عند فشل الإرسال.
