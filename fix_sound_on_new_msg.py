
INPUT_FILE  = '/sessions/clever-busy-einstein/mnt/outputs/index.html'
OUTPUT_FILE = '/sessions/clever-busy-einstein/mnt/outputs/index.html'

with open(INPUT_FILE, 'r', encoding='utf-8') as f:
    code = f.read()

print(f"Original size: {len(code)} bytes")
fixes = 0

# ══════════════════════════════════════════════════════════════
# FIX 1: إضافة دالة إشعار صوتي محلي موحّدة
# ══════════════════════════════════════════════════════════════

old_marker = "// ══════════════════════════════════════════════════════════════\n// زر اختبار الصوت والإشعار المحلي (بدون سيرفر)"

new_marker = """// ══════════════════════════════════════════════════════════════
// إشعار صوتي محلي عند وصول رسالة/طلب جديد
// ══════════════════════════════════════════════════════════════
function _fcmLocalAlert(title, body) {
  // 1) صوت
  try { playFCMNotificationSound(); } catch(e) {}
  // 2) اهتزاز
  if (navigator.vibrate) try { navigator.vibrate([200, 100, 200]); } catch(e) {}
  // 3) إشعار نظام
  if (Notification.permission === 'granted') {
    try {
      var n = new Notification(title, {
        body: body, icon: '/icon-192.png', dir: 'rtl', lang: 'ar',
        tag: 'local-' + Date.now(), silent: true, requireInteraction: false
      });
      n.onclick = function() { window.focus(); n.close(); };
      setTimeout(function() { n.close(); }, 8000);
    } catch(e) {}
  }
  // 4) Toast
  if (typeof toast === 'function') toast(title + ': ' + body, 'ok');
}

// ══════════════════════════════════════════════════════════════
// زر اختبار الصوت والإشعار المحلي (بدون سيرفر)"""

if old_marker in code:
    code = code.replace(old_marker, new_marker, 1)
    fixes += 1
    print("FIX 1: _fcmLocalAlert() function added")
else:
    print("FIX 1 FAILED")

# ══════════════════════════════════════════════════════════════
# FIX 2: تتبع الرسائل الجديدة في AutoSync
# عند اكتشاف رسالة جديدة غير مقروءة موجهة للمستخدم الحالي
# ══════════════════════════════════════════════════════════════

old_msg_sync = """      var lm=localM.find(function(m){return String(m.id)===mid});
      if(!lm){
        localM.push({id:mid,from:cm.sender_type||'',fromId:cm.sender_id||'',fromName:cm.sender_name||'',fromEmail:cm.sender_email||'',text:cm.message_text||'',reply:cm.reply_text||'',read:cm.is_read||false,toRole:cm.to_role||null,toId:cm.to_id||null,toName:cm.to_name||null,toEmail:cm.to_email||null,image:cm.image_url||'',date:cm.created_at?(cm.created_at+'').slice(0,10):new Date().toISOString().slice(0,10),_cloud:true});
        changed=true;
      } else {"""

new_msg_sync = """      var lm=localM.find(function(m){return String(m.id)===mid});
      if(!lm){
        var _newMsg={id:mid,from:cm.sender_type||'',fromId:cm.sender_id||'',fromName:cm.sender_name||'',fromEmail:cm.sender_email||'',text:cm.message_text||'',reply:cm.reply_text||'',read:cm.is_read||false,toRole:cm.to_role||null,toId:cm.to_id||null,toName:cm.to_name||null,toEmail:cm.to_email||null,image:cm.image_url||'',date:cm.created_at?(cm.created_at+'').slice(0,10):new Date().toISOString().slice(0,10),_cloud:true};
        localM.push(_newMsg);
        changed=true;
        // إشعار صوتي للرسائل الجديدة الموجهة للمستخدم الحالي
        if(!_newMsg.read && currentUser) {
          var _isForMe = false;
          var _myRole = currentUser.role;
          var _myEmail = currentUser.email;
          // رسالة موجهة لدوري
          if(_newMsg.toRole === _myRole) _isForMe = true;
          // رسالة موجهة لي شخصياً
          if(_newMsg.toEmail === _myEmail) _isForMe = true;
          // أنا أدمن وهذه رسالة من شريك/عميل للإدارة
          if(_myRole === 'admin' && (!_newMsg.toRole || _newMsg.toRole === 'admin')) _isForMe = true;
          // أنا شريك/عميل وهذه رد من الأدمن لي
          if(_newMsg.from === 'admin' && _newMsg.toEmail === _myEmail) _isForMe = true;
          // رسالة فيها رد جديد موجه لي
          if(_newMsg.reply && _newMsg.fromEmail === _myEmail) _isForMe = true;
          if(_isForMe) {
            _fcmLocalAlert('📩 رسالة جديدة', (_newMsg.fromName||_newMsg.from||'مستخدم') + ': ' + (_newMsg.text||'').substring(0,60));
          }
        }
      } else {"""

if old_msg_sync in code:
    code = code.replace(old_msg_sync, new_msg_sync, 1)
    fixes += 1
    print("FIX 2: Sound alert on new messages in AutoSync")
else:
    print("FIX 2 FAILED")

# ══════════════════════════════════════════════════════════════
# FIX 3: إشعار صوتي عند رد جديد على رسالة (الرد من الأدمن)
# ══════════════════════════════════════════════════════════════

old_reply_sync = "        if(cm.reply_text&&!lm.reply){lm.reply=cm.reply_text;lm.read=true;changed=true}"

new_reply_sync = """        if(cm.reply_text&&!lm.reply){lm.reply=cm.reply_text;lm.read=true;changed=true;
          // إشعار صوتي عند وصول رد جديد
          if(currentUser && lm.fromEmail === currentUser.email) {
            _fcmLocalAlert('💬 رد جديد على رسالتك', (cm.reply_text||'').substring(0,60));
          }
        }"""

if old_reply_sync in code:
    code = code.replace(old_reply_sync, new_reply_sync, 1)
    fixes += 1
    print("FIX 3: Sound alert on new reply")
else:
    print("FIX 3 FAILED")

# ══════════════════════════════════════════════════════════════
# FIX 4: إشعار صوتي عند طلب جديد (للشريك والأدمن)
# نتتبع عدد الطلبات قبل وبعد المزامنة
# ══════════════════════════════════════════════════════════════

old_order_sync = "  // 3) مزامنة الطلبات — السحابة هي المصدر الوحيد (بدون تكرار)\n  supaFetch('orders','GET',null,'?select=*&order=order_date.desc').then(function(rows){"

new_order_sync = """  // 3) مزامنة الطلبات — السحابة هي المصدر الوحيد (بدون تكرار)
  var _orderCountBefore = getOrders().length;
  supaFetch('orders','GET',null,'?select=*&order=order_date.desc').then(function(rows){"""

if old_order_sync in code:
    code = code.replace(old_order_sync, new_order_sync, 1)
    fixes += 1
    print("FIX 4a: Track order count before sync")
else:
    print("FIX 4a FAILED")

old_order_save = "    saveOrders(cleanOrders);\n    anyChange=true;"

new_order_save = """    saveOrders(cleanOrders);
    anyChange=true;
    // إشعار صوتي عند طلب جديد
    if(cleanOrders.length > _orderCountBefore && currentUser) {
      var _newCount = cleanOrders.length - _orderCountBefore;
      if(currentUser.role === 'admin' || currentUser.role === 'vendor') {
        _fcmLocalAlert('🛒 طلب جديد!', 'وصلك ' + _newCount + ' طلب جديد');
      }
    }"""

if old_order_save in code:
    code = code.replace(old_order_save, new_order_save, 1)
    fixes += 1
    print("FIX 4b: Sound alert on new orders")
else:
    print("FIX 4b FAILED")

# ══════════════════════════════════════════════════════════════
# FIX 5: إشعار صوتي عند إرسال رسالة من CloudSync أيضاً
# ══════════════════════════════════════════════════════════════

old_cloud_merge = "    if(merged){saveMessages(localMsgs);console.log('[CloudSync] تم دمج الرسائل');_postSyncRefresh()}"

new_cloud_merge = """    if(merged){saveMessages(localMsgs);console.log('[CloudSync] تم دمج الرسائل');_postSyncRefresh();
      // إشعار صوتي
      if(currentUser) _fcmLocalAlert('📩 رسائل جديدة', 'تم استلام رسائل جديدة');
    }"""

if old_cloud_merge in code:
    code = code.replace(old_cloud_merge, new_cloud_merge, 1)
    fixes += 1
    print("FIX 5: Sound alert on CloudSync message merge")
else:
    print("FIX 5 FAILED")

# ══════════════════════════════════════════════════════════════
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    f.write(code)

print(f"\nTotal fixes applied: {fixes}/6")
print(f"Final size: {len(code)} bytes")
print("Done!")
