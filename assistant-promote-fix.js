/* ════════════════════════════════════════════════════════════════
   assistant-promote-fix.js   —   works12   (v3 — مزامنة الصلاحيات)
   إصلاح: ترقية مساعد أدمن + مزامنة صلاحيات الشركاء + بين المتصفحات
   ──────────────────────────────────────────────────────────────
   📌 طريقة الاستخدام:
       1) ضع هذا الملف بجانب index.html في جذر المشروع
       2) أضف قبل </body> في index.html:
            <script src="assistant-promote-fix.js?v=3"></script>
       3) شغّل ملف SQL (assistants_schema.sql) في Supabase مرة واحدة
       4) ادفع إلى Netlify
   ──────────────────────────────────────────────────────────────
   🩺 سبب المشكلة (مهم جداً):

   حلقة المزامنة الدورية الأصلية _autoSyncCheck() في index.html
   تقرأ من جدول users كل 3 ثوانٍ، **لكنها لا تقرأ عمود permissions
   إطلاقاً**. تقرأ فقط: phone, max_products, plan_type, region ...

   لهذا السبب:
   ✅ تعديل "زيادة عدد المنتجات" يصل لكل المتصفحات (max_products
      في حلقة المزامنة).
   ❌ تعديل "الصلاحيات" لا يصل (permissions غير موجود في الحلقة).

   ──────────────────────────────────────────────────────────────
   🩹 طبقات الإصلاح (7 طبقات):

   (A) saveAssistant       → يكتب المساعد إلى Supabase + ينشئ Auth
   (B) deleteAssistant     → ينزّل الدور في السحابة عند الحذف
   (C) doLogin             → يستعلم Supabase ويُنشئ جلسة المساعد
   (D) refreshSession      → كل 30 ثانية يفحص دور المستخدم الحالي
   (E) selfHeal            → يدفع المساعدين المحليين القدامى للسحابة
   (F) ⭐ permsAutoSync   → كل 3 ثوانٍ يقرأ permissions من السحابة
                            ويُحدّث mkt_permissions و mkt_assistants
                            في كل المتصفحات (هذا هو الإصلاح الأهم)
   (G) diagnostics         → سجلات Console واضحة + Toast
   ══════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  var TAG = '[assistant-fix]';
  var MAIN_ADMIN = 'abdmohsen94@gmail.com';
  var PERMS_SYNC_INTERVAL = 4000; // كل 4 ثوانٍ — متماشي مع _autoSyncCheck

  function log(){ try{ console.log.apply(console,[TAG].concat([].slice.call(arguments))) }catch(e){} }
  function warn(){ try{ console.warn.apply(console,[TAG].concat([].slice.call(arguments))) }catch(e){} }
  function err(){ try{ console.error.apply(console,[TAG].concat([].slice.call(arguments))) }catch(e){} }

  function waitForApp(cb){
    if(typeof saveAssistant==='function' &&
       typeof getAssistants==='function' &&
       typeof ADMIN_PERMS==='object'    &&
       typeof doLogin==='function'      &&
       typeof BACKEND_CONFIG==='object'){
      cb();
    } else {
      setTimeout(function(){ waitForApp(cb); }, 200);
    }
  }

  /* ───────── helpers ───────── */
  function parsePerms(r){
    if(!r || !r.permissions) return {};
    if(typeof r.permissions === 'string'){
      try{ return JSON.parse(r.permissions); }catch(e){ return {}; }
    }
    return r.permissions;
  }

  function rawSupaGet(query){
    if(typeof isCloudMode !== 'function' || !isCloudMode()) return Promise.resolve(null);
    var cfg = BACKEND_CONFIG.supabase;
    return fetch(cfg.url + '/rest/v1/' + query, {
      method:'GET',
      headers:{
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Accept': 'application/json'
      }
    }).then(function(r){
      if(!r.ok) return r.text().then(function(t){ warn('rawSupaGet error', r.status, t); return null; });
      return r.json();
    }).catch(function(e){ warn('rawSupaGet fetch failed', e); return null; });
  }

  function cloudLookupUser(email){
    if(!email) return Promise.resolve(null);
    return rawSupaGet('users?email=eq.' + encodeURIComponent(email) + '&select=*&limit=1')
      .then(function(rows){ return (rows && rows.length) ? rows[0] : null; });
  }

  function upsertLocalAssistant(r, password){
    if(!r || !r.email) return null;
    var perms = parsePerms(r);
    var asts  = getAssistants();
    var existing = asts.find(function(a){ return a.email === r.email; });
    if(existing){
      existing.name        = r.full_name || existing.name;
      existing.permissions = perms;
      if(password) existing.password = password;
    } else {
      asts.push({
        id: (typeof uid==='function' ? uid() : Date.now()),
        name: r.full_name || r.email,
        email: r.email,
        password: password || '',
        permissions: perms,
        _cloud: true
      });
    }
    saveAssistants(asts);
    return { name: r.full_name || r.email, email: r.email, permissions: perms };
  }

  function authenticateAssistant(email, pw){
    if(typeof isCloudMode !== 'function' || !isCloudMode()){
      return Promise.resolve({ok:true});
    }
    var cfg = BACKEND_CONFIG.supabase;
    function signIn(){
      return fetch(cfg.url + '/auth/v1/token?grant_type=password', {
        method:'POST',
        headers:{'apikey':cfg.anonKey,'Content-Type':'application/json'},
        body: JSON.stringify({email:email,password:pw})
      }).then(function(r){ return r.json(); });
    }
    function signUp(){
      return fetch(cfg.url + '/auth/v1/signup', {
        method:'POST',
        headers:{'apikey':cfg.anonKey,'Content-Type':'application/json'},
        body: JSON.stringify({email:email,password:pw})
      }).then(function(r){ return r.json(); });
    }
    return signIn().then(function(d){
      if(d && d.access_token){ window._supaToken = d.access_token; return {ok:true,source:'signin'}; }
      return signUp().then(function(s){
        if(s && s.access_token){ window._supaToken = s.access_token; return {ok:true,source:'signup'}; }
        return signIn().then(function(d2){
          if(d2 && d2.access_token){ window._supaToken = d2.access_token; return {ok:true,source:'signin-after-signup'}; }
          return {ok:false, msg:(d && (d.error_description||d.msg||d.error))||'كلمة المرور غير صحيحة'};
        });
      });
    }).catch(function(e){ err('Auth flow failed:',e); return {ok:false,msg:'خطأ في الاتصال بالمصادقة'}; });
  }

  /* ════════ MAIN ════════ */
  waitForApp(function(){
    log('installing v3 patches (7 layers)...');

    /* ════════ (A) saveAssistant ════════ */
    window.saveAssistant = function saveAssistant(){
      var name     = document.getElementById('ast-name').value.trim();
      var email    = document.getElementById('ast-email').value.trim().toLowerCase();
      var password = document.getElementById('ast-password').value.trim();
      var editIdx  = document.getElementById('ast-edit-id').value;
      if(!name || !email){ toast('أدخل الاسم والبريد','err'); return; }

      var perms = {};
      Object.keys(ADMIN_PERMS).forEach(function(k){
        var cb = document.getElementById('ast-p-'+k);
        if(cb) perms[k] = cb.checked;
      });

      var asts   = getAssistants();
      var isEdit = (editIdx !== '');

      if(isEdit){
        var i = parseInt(editIdx);
        asts[i].name        = name;
        asts[i].email       = email;
        if(password && password.length >= 6) asts[i].password = password;
        asts[i].permissions = perms;
        toast('✅ تم تحديث المساعد');
      } else {
        if(!password || password.length < 6){
          toast('كلمة المرور يجب أن تكون 6 أحرف على الأقل','err'); return;
        }
        if(asts.find(function(a){ return a.email === email; })){
          toast('البريد مسجل بالفعل','err'); return;
        }
        asts.push({ id:uid(), name:name, email:email, password:password, permissions:perms });
        toast('✅ تمت إضافة المساعد — جارٍ ترقيته في السحابة...');
      }
      saveAssistants(asts);

      if(typeof isCloudMode === 'function' && isCloudMode()){
        if(typeof saveUserToSupabase === 'function'){
          saveUserToSupabase({email:email,name:name,role:'admin',companyName:name})
            .then(function(){
              if(typeof supaUpdate === 'function'){
                supaUpdate('users','email',email,{permissions:JSON.stringify(perms),role:'admin'});
              }
              log('✅ promoted in cloud:', email);
              toast('☁️ تمت المزامنة مع السحابة');
            }).catch(function(e){
              err('cloud promote failed:',e);
              toast('⚠️ فشل رفع المساعد إلى السحابة','err');
            });
        }
        if(password && password.length >= 6){
          try{
            fetch(BACKEND_CONFIG.supabase.url + '/auth/v1/signup', {
              method:'POST',
              headers:{'apikey':BACKEND_CONFIG.supabase.anonKey,'Content-Type':'application/json'},
              body: JSON.stringify({email:email,password:password})
            }).then(function(r){return r.json()}).then(function(d){
              log('Auth signup:', (d && d.id)?'OK':'(may already exist)');
            }).catch(function(){});
          }catch(e){}
        }
        try{
          if(typeof triggerPush === 'function'){
            triggerPush({target:'email',value:email,title:'🛡️ تمت ترقيتك',body:'تم منحك صلاحيات مساعد أدمن — أعد تسجيل الدخول',data:{type:'role_change',url:'/'}});
          }
        }catch(e){}
      }

      if(typeof currentUser !== 'undefined' && currentUser
         && currentUser.email === email
         && (currentUser.role !== 'admin' || !currentUser.isAssistant)){
        currentUser = {role:'admin',id:0,name:name,email:email,isAssistant:true,permissions:perms};
        if(typeof saveSession === 'function') saveSession();
        setTimeout(function(){
          toast('✅ تمت ترقيتك إلى مساعد أدمن');
          try{showScreen('s-admin'); renderAdminDashboard();}catch(e){}
        }, 800);
      }
      closeAssistantModal();
      renderAssistantsList();
    };

    /* ════════ (B) deleteAssistant ════════ */
    window.deleteAssistant = function deleteAssistant(idx){
      var asts = getAssistants();
      if(!asts[idx]) return;
      var astEmail = asts[idx].email;
      var astName  = asts[idx].name;
      document.getElementById('confirm-msg').textContent = '🗑️ حذف المساعد "' + astName + '"؟';
      document.getElementById('confirm-ok').onclick = function(){
        var a = getAssistants(); a.splice(idx,1); saveAssistants(a);
        if(typeof isCloudMode === 'function' && isCloudMode() && astEmail && typeof supaUpdate === 'function'){
          supaUpdate('users','email',astEmail,{role:'customer',permissions:null})
            .then(function(){ log('demoted in cloud:', astEmail); })
            .catch(function(){});
        }
        closeConfirm(); toast('تم الحذف ✅'); renderAssistantsList();
      };
      document.getElementById('confirm-modal').classList.add('on');
    };

    /* ════════ (C) doLogin ════════ */
    var _origDoLogin = window.doLogin;
    window.doLogin = function patchedDoLogin(){
      var role = (typeof currentRole !== 'undefined') ? currentRole : 'customer';
      var emailEl = document.getElementById(role==='customer' ? 'cust-email' : 'vendor-email');
      var pwEl    = document.getElementById(role==='customer' ? 'cust-password' : 'vendor-password');
      if(!emailEl || !pwEl){ return _origDoLogin.apply(this,arguments); }
      var email = (emailEl.value||'').trim().toLowerCase();
      var pw    = pwEl.value || '';
      if(!email || !pw){ return _origDoLogin.apply(this,arguments); }
      emailEl.value = email;
      if(email === MAIN_ADMIN){ return _origDoLogin.apply(this,arguments); }
      log('login attempt:', email);
      toast('⏳ جارٍ التحقق من الصلاحيات...');
      cloudLookupUser(email).then(function(r){
        if(r && r.role === 'admin' && r.email !== MAIN_ADMIN){
          log('cloud says ADMIN ASSISTANT:', email);
          upsertLocalAssistant(r, pw);
          authenticateAssistant(email, pw).then(function(authRes){
            if(!authRes.ok){
              toast(authRes.msg || 'كلمة المرور غير صحيحة','err');
              warn('assistant auth failed:', authRes); return;
            }
            log('✅ assistant authenticated via', authRes.source);
            var perms = parsePerms(r);
            window.currentUser = {role:'admin',id:0,name:r.full_name||email,email:email,isAssistant:true,permissions:perms};
            try{ if(typeof saveSession === 'function') saveSession(); }catch(e){}
            try{ showScreen('s-admin'); renderAdminDashboard(); }catch(e){}
            toast('مرحباً ' + (r.full_name||email) + ' 🛡️');
          });
          return;
        }
        log('cloud role:', r ? r.role : '(غير موجود)');
        _origDoLogin.call(window);
      }).catch(function(e){
        err('cloud lookup failed:',e);
        _origDoLogin.call(window);
      });
    };

    /* ════════ (D) refreshSessionRoleFromCloud ════════ */
    function refreshSessionRoleFromCloud(){
      if(typeof currentUser === 'undefined' || !currentUser || !currentUser.email) return;
      if(currentUser.role === 'admin' && !currentUser.isAssistant) return;
      if(typeof isCloudMode !== 'function' || !isCloudMode()) return;
      cloudLookupUser(currentUser.email).then(function(r){
        if(!r) return;
        if(r.role === 'admin' && r.email !== MAIN_ADMIN){
          var perms = parsePerms(r);
          upsertLocalAssistant(r);
          if(currentUser.role !== 'admin' || !currentUser.isAssistant){
            currentUser = {role:'admin',id:0,name:r.full_name||currentUser.name,email:r.email,isAssistant:true,permissions:perms};
            if(typeof saveSession === 'function') saveSession();
            log('auto-promoted current session');
            toast('🛡️ تمت ترقيتك إلى مساعد أدمن — جارٍ التحديث...');
            setTimeout(function(){
              try{ showScreen('s-admin'); renderAdminDashboard(); }catch(e){}
            }, 1000);
          } else {
            currentUser.permissions = perms;
            if(typeof saveSession === 'function') saveSession();
          }
        } else if(r.role === 'customer' && currentUser.isAssistant){
          log('session demoted by cloud');
          var asts2 = getAssistants().filter(function(a){ return a.email !== r.email; });
          saveAssistants(asts2);
          toast('⚠️ تم سحب صلاحيات مساعد الأدمن — جارٍ تسجيل الخروج...');
          setTimeout(function(){
            try{ if(typeof logout === 'function') logout(); else location.reload(); }
            catch(e){ location.reload(); }
          }, 1500);
        }
      }).catch(function(){});
    }

    /* ════════ (E) selfHeal ════════ */
    function selfHealUploadAssistants(){
      if(typeof isCloudMode !== 'function' || !isCloudMode()) return;
      var asts = getAssistants();
      if(!asts.length){ log('selfHeal: لا يوجد مساعدون محليون'); return; }
      log('selfHeal: فحص', asts.length, 'مساعد للمزامنة...');
      var uploaded = 0, checked = 0;
      asts.forEach(function(a){
        if(!a.email) return;
        var email = a.email.toLowerCase();
        cloudLookupUser(email).then(function(r){
          checked++;
          var needsUpload = !r || r.role !== 'admin';
          if(needsUpload){
            log('selfHeal: رفع', email);
            if(typeof saveUserToSupabase === 'function'){
              saveUserToSupabase({email:email,name:a.name||email,role:'admin',companyName:a.name||email})
                .then(function(){
                  if(typeof supaUpdate === 'function'){
                    supaUpdate('users','email',email,{permissions:JSON.stringify(a.permissions||{}),role:'admin'});
                  }
                  if(a.password && a.password.length >= 6){
                    try{
                      fetch(BACKEND_CONFIG.supabase.url + '/auth/v1/signup', {
                        method:'POST',
                        headers:{'apikey':BACKEND_CONFIG.supabase.anonKey,'Content-Type':'application/json'},
                        body: JSON.stringify({email:email,password:a.password})
                      }).catch(function(){});
                    }catch(e){}
                  }
                  uploaded++;
                  if(uploaded === 1) toast('☁️ جارٍ مزامنة المساعدين القدامى...');
                }).catch(function(e){ err('selfHeal upload failed for',email,e); });
            }
          } else {
            var cloudPerms = parsePerms(r);
            var localPerms = a.permissions || {};
            if(JSON.stringify(cloudPerms) !== JSON.stringify(localPerms) && Object.keys(localPerms).length){
              if(typeof supaUpdate === 'function'){
                supaUpdate('users','email',email,{permissions:JSON.stringify(localPerms)});
                log('selfHeal: تحديث صلاحيات', email);
              }
            }
          }
          if(checked === asts.length){
            log('selfHeal: اكتمل (' + uploaded + ' مرفوع، ' + (asts.length-uploaded) + ' متطابق)');
            if(uploaded > 0){
              setTimeout(function(){ toast('✅ تمت مزامنة ' + uploaded + ' مساعد'); }, 1000);
            }
          }
        }).catch(function(){ checked++; });
      });
    }

    /* ════════════════════════════════════════════════════════════════
       ⭐⭐⭐ (F) permsAutoSync — قلب الإصلاح ⭐⭐⭐
       حلقة المزامنة الأصلية _autoSyncCheck() تتجاهل عمود permissions.
       هنا نضيف حلقة موازية تقرأ permissions من كل المستخدمين كل 4 ثوانٍ
       وتُحدّث mkt_permissions (للشركاء) و mkt_assistants (للمساعدين).
       هذا يجعل تغيير الصلاحيات يصل لكل المتصفحات تلقائياً، تماماً
       كما يصل تعديل max_products.
    ════════════════════════════════════════════════════════════════ */
    var _lastPermsHash = '';

    function permsAutoSync(){
      if(typeof isCloudMode !== 'function' || !isCloudMode()) return;

      // اقرأ فقط الحقول المطلوبة لتقليل الحمل
      rawSupaGet('users?select=email,role,full_name,permissions').then(function(rows){
        if(!rows || !Array.isArray(rows)) return;

        // بصمة سريعة لمعرفة هل تغير شيء
        var hash = '';
        rows.forEach(function(r){
          hash += (r.email||'') + ':' + (r.role||'') + ':' +
                  (typeof r.permissions === 'string' ? r.permissions :
                   r.permissions ? JSON.stringify(r.permissions) : '') + '|';
        });
        if(hash === _lastPermsHash) return; // لا تغيير
        _lastPermsHash = hash;
        log('permsAutoSync: تغيير مرصود — جارٍ التحديث...');

        // ── (1) تحديث صلاحيات الشركاء (mkt_permissions) ──
        var vendors = (typeof getVendors === 'function') ? getVendors() : [];
        var allPerms = ls('mkt_permissions') || {};
        var permsChanged = false;
        var vendorPermsByEmail = {};

        rows.forEach(function(r){
          if(r.role === 'partner' && r.email){
            vendorPermsByEmail[r.email] = parsePerms(r);
          }
        });

        vendors.forEach(function(v){
          if(!v.email) return;
          var cloudP = vendorPermsByEmail[v.email];
          if(!cloudP) return;
          var localP = allPerms[String(v.id)] || {};
          if(JSON.stringify(localP) !== JSON.stringify(cloudP)){
            allPerms[String(v.id)] = cloudP;
            permsChanged = true;
            log('permsAutoSync: تحديث صلاحيات الشريك', v.name, '('+v.email+')');
          }
        });
        if(permsChanged){
          ss('mkt_permissions', allPerms);
          // إعادة رسم صفحة الصلاحيات إن كانت مفتوحة
          var permsPage = document.getElementById('apg-a-permissions');
          if(permsPage && permsPage.classList.contains('on')
             && typeof renderVendorPermsList === 'function'){
            try{ renderVendorPermsList(); }catch(e){}
          }
          // إذا كان المستخدم الحالي شريكاً وصلاحياته تغيرت → toast + إعادة رسم
          if(currentUser && currentUser.role === 'vendor'){
            var myV = vendors.find(function(x){ return x.email === currentUser.email; });
            if(myV && vendorPermsByEmail[currentUser.email]){
              toast('🔔 تم تحديث صلاحياتك من قبل الإدارة');
              try{ if(typeof renderVendorDashboard === 'function') renderVendorDashboard(); }catch(e){}
            }
          }
        }

        // ── (2) تحديث المساعدين (mkt_assistants) ──
        var localAsts = getAssistants();
        var cloudAdmins = rows.filter(function(r){
          return r.role === 'admin' && r.email && r.email !== MAIN_ADMIN;
        });
        var astsChanged = false;

        // أ) أضف/حدّث المساعدين من السحابة
        cloudAdmins.forEach(function(r){
          var cloudP = parsePerms(r);
          var existing = localAsts.find(function(a){ return a.email === r.email; });
          if(!existing){
            localAsts.push({
              id: (typeof uid==='function' ? uid() : Date.now()),
              name: r.full_name || r.email,
              email: r.email,
              password: '',
              permissions: cloudP,
              _cloud: true
            });
            astsChanged = true;
            log('permsAutoSync: مساعد جديد من السحابة', r.email);
          } else {
            if(existing.name !== (r.full_name || existing.name)){
              existing.name = r.full_name || existing.name;
              astsChanged = true;
            }
            if(JSON.stringify(existing.permissions||{}) !== JSON.stringify(cloudP)){
              existing.permissions = cloudP;
              astsChanged = true;
              log('permsAutoSync: تحديث صلاحيات المساعد', r.email);
            }
          }
        });

        // ب) احذف المساعدين الذين لم يعودوا admins في السحابة (تنزيل دور)
        var cloudAdminEmails = cloudAdmins.map(function(r){ return r.email; });
        var filteredAsts = localAsts.filter(function(a){
          // المساعدون _cloud=true إذا لم يكونوا في السحابة admins → احذف
          if(a._cloud && cloudAdminEmails.indexOf(a.email) === -1){
            astsChanged = true;
            log('permsAutoSync: المساعد', a.email, 'لم يعد admin في السحابة — حذف محلي');
            return false;
          }
          return true;
        });

        if(astsChanged){
          saveAssistants(filteredAsts);
          // إعادة رسم قائمة المساعدين إن كانت صفحة الصلاحيات مفتوحة
          var permsPage2 = document.getElementById('apg-a-permissions');
          if(permsPage2 && permsPage2.classList.contains('on')
             && typeof renderAssistantsList === 'function'){
            try{ renderAssistantsList(); }catch(e){}
          }
          // إذا كان المستخدم الحالي مساعد وصلاحياته تغيرت → حدّث currentUser
          if(currentUser && currentUser.isAssistant){
            var myAst = filteredAsts.find(function(a){ return a.email === currentUser.email; });
            if(myAst && JSON.stringify(currentUser.permissions||{}) !== JSON.stringify(myAst.permissions||{})){
              currentUser.permissions = myAst.permissions;
              if(typeof saveSession === 'function') saveSession();
              toast('🔔 تم تحديث صلاحياتك');
              try{ if(typeof renderAdminDashboard === 'function') renderAdminDashboard(); }catch(e){}
            }
          }
        }
      }).catch(function(e){ warn('permsAutoSync failed:', e); });
    }

    /* ════════ (G) جدولة كل الحلقات ════════ */
    setTimeout(selfHealUploadAssistants, 2000);
    setTimeout(refreshSessionRoleFromCloud, 1500);
    setInterval(refreshSessionRoleFromCloud, 30000);

    // ⭐ الحلقة الرئيسية — كل 4 ثوانٍ
    setTimeout(permsAutoSync, 1000);            // فحص أولي سريع
    setInterval(permsAutoSync, PERMS_SYNC_INTERVAL);

    // مزامنة فورية عند العودة للتبويب
    document.addEventListener('visibilitychange', function(){
      if(!document.hidden) permsAutoSync();
    });
    window.addEventListener('online', permsAutoSync);

    log('✅ all 7 patches installed (v3)');
    try{
      console.log('%c[assistant-fix v3] ✅ ready — permissions sync every '
                  + (PERMS_SYNC_INTERVAL/1000) + 's',
                  'color:#0a0;font-weight:bold');
    }catch(e){}
  });
})();
