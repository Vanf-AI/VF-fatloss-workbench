// 减脂工作台 · 云端引导脚本
// 职责：初始化 WorkBuddy Cloud SDK → 注入 window.FATLOSS_HOST_ADAPTER → 登录闸门 → 加载主应用。
(function () {
  "use strict";

  // 部署时替换：endpoint / publishableKey 来自 workbuddy_cloud_service(activate) 返回的 publicConfig。
  // 严禁把真实凭据写进模板提交（本文件会随站点公开部署）。
  var CONFIG = {
    endpoint: "__FATLOSS_ENDPOINT__",
    publishableKey: "__FATLOSS_PUBLISHABLE_KEY__",
  };
  var TABLE = "fatloss_documents";
  var DEFAULT_PACK = window.__FATLOSS_DEFAULT_PACK__ || null;

  var cloud = null;
  var appLoaded = false;
  var pendingOtp = null;

  function initCloud() {
    if (cloud) return cloud;
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: CONFIG.endpoint,
      publishableKey: CONFIG.publishableKey,
    });
    return cloud;
  }

  // ---- 宿主适配器：load() / save()，乐观锁 revision ----
  function injectAdapter() {
    window.FATLOSS_HOST_ADAPTER = {
      mode: "edit",
      async load() {
        const { data, error } = await cloud.database
          .from(TABLE)
          .select("id, doc, revision")
          .order("id", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          const hasSeed = !!(DEFAULT_PACK && DEFAULT_PACK.logs && Object.keys(DEFAULT_PACK.logs).length);
          if (hasSeed) {
            const { data: ins, error: insErr } = await cloud.database
              .from(TABLE)
              .insert({ doc: DEFAULT_PACK, revision: 1 })
              .select("revision")
              .single();
            if (insErr) throw insErr;
            return { document: DEFAULT_PACK, revision: ins.revision };
          }
          return { document: DEFAULT_PACK, revision: 0 };
        }
        return { document: data.doc, revision: data.revision };
      },
      async save(input) {
        const doc = input.document;
        const expectedVersion = input.expectedVersion == null ? 0 : input.expectedVersion;
        const { data: rows, error: readErr } = await cloud.database
          .from(TABLE)
          .select("id, revision")
          .order("id", { ascending: true })
          .limit(1);
        if (readErr) throw readErr;
        const existing = rows && rows[0];
        if (!existing) {
          const { data: inserted, error: insErr } = await cloud.database
            .from(TABLE)
            .insert({ doc: doc, revision: 1 })
            .select("revision")
            .single();
          if (insErr) throw insErr;
          return { revision: inserted.revision };
        }
        if (existing.revision !== expectedVersion) {
          throw Object.assign(new Error("数据已在其他设备或标签页被修改，请刷新后再试"), {
            code: "revision_conflict",
          });
        }
        const newRevision = existing.revision + 1;
        const { data: updated, error: updErr } = await cloud.database
          .from(TABLE)
          .update({ doc: doc, revision: newRevision })
          .eq("id", existing.id)
          .select("revision")
          .single();
        if (updErr) throw updErr;
        return { revision: updated.revision };
      },
    };
  }

  // ---- 登录视图 ----
  function loginMarkup() {
    return (
      '<div class="login-overlay" id="loginOverlay">' +
        '<div class="login-card">' +
          '<div class="login-brand"><span class="login-leaf">❦</span><div><b>减脂工作台</b><small>登录后记录你的饮食与减脂进度</small></div></div>' +
          '<div class="login-tabs">' +
            '<button type="button" class="login-tab active" data-mode="signin">登录</button>' +
            '<button type="button" class="login-tab" data-mode="signup">注册</button>' +
          '</div>' +
          '<form id="signinForm" class="login-form" novalidate>' +
            '<label>邮箱<input id="signinEmail" type="email" autocomplete="username" placeholder="you@example.com" required></label>' +
            '<label>密码<input id="signinPassword" type="password" autocomplete="current-password" placeholder="输入密码" required></label>' +
            '<p class="login-error" id="signinError"></p>' +
            '<button type="submit" class="login-submit" id="signinBtn">登 录</button>' +
          '</form>' +
          '<form id="signupForm" class="login-form" hidden novalidate>' +
            '<label>邮箱<input id="signupEmail" type="email" autocomplete="username" placeholder="you@example.com" required></label>' +
            '<label>密码<input id="signupPassword" type="password" autocomplete="new-password" placeholder="设置密码（至少 6 位）" minlength="6" required></label>' +
            '<label>验证码' +
              '<div class="login-otp-row"><input id="signupCode" inputmode="numeric" placeholder="6 位验证码" required>' +
              '<button type="button" class="login-code-btn" id="sendCodeBtn">获取验证码</button></div>' +
            '</label>' +
            '<p class="login-error" id="signupError"></p>' +
            '<button type="submit" class="login-submit" id="signupBtn">注册并进入</button>' +
          '</form>' +
        '</div>' +
      '</div>' +
      '<style>' +
        '.login-overlay{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:24px;z-index:9999;font-family:var(--font-body);}' +
        '.login-card{width:100%;max-width:400px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:32px 28px;box-shadow:var(--shadow-3);}' +
        '.login-brand{display:flex;align-items:center;gap:12px;margin-bottom:22px;}' +
        '.login-leaf{font-size:28px;color:var(--primary);line-height:1;}' +
        '.login-brand b{display:block;font-size:19px;color:var(--text);letter-spacing:.5px;}' +
        '.login-brand small{display:block;font-size:12px;color:var(--muted);margin-top:2px;}' +
        '.login-tabs{display:flex;gap:6px;background:var(--bg-soft);border-radius:12px;padding:4px;margin-bottom:20px;}' +
        '.login-tab{flex:1;border:0;background:transparent;padding:9px 0;border-radius:9px;font-size:14px;color:var(--muted);cursor:pointer;}' +
        '.login-tab.active{background:var(--card-bg);color:var(--text);font-weight:600;box-shadow:var(--shadow-1);}' +
        '.login-form label{display:block;font-size:13px;color:var(--muted);margin-bottom:14px;font-weight:500;}' +
        '.login-form input{width:100%;margin-top:6px;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font-size:15px;color:var(--text);background:var(--card-bg);}' +
        '.login-form input:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft);}' +
        '.login-otp-row{display:flex;gap:8px;}' +
        '.login-otp-row input{flex:1;}' +
        '.login-code-btn{flex-shrink:0;border:1px solid var(--primary);background:transparent;color:var(--primary);border-radius:10px;padding:0 14px;font-size:13px;cursor:pointer;white-space:nowrap;}' +
        '.login-code-btn:disabled{opacity:.5;cursor:default;}' +
        '.login-error{font-size:12px;color:var(--danger);min-height:16px;margin:2px 0 10px;}' +
        '.login-submit{width:100%;border:0;background:var(--text);color:var(--bg);border-radius:12px;padding:13px;font-size:15px;font-weight:600;cursor:pointer;}' +
        '.login-submit:disabled{opacity:.6;cursor:default;}' +
      '</style>'
    );
  }

  function showLogin() {
    var host = document.createElement("div");
    host.innerHTML = loginMarkup();
    document.body.appendChild(host);
    bindLogin();
  }

  function bindLogin() {
    var tabs = document.querySelectorAll(".login-tab");
    var signinForm = document.getElementById("signinForm");
    var signupForm = document.getElementById("signupForm");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.remove("active"); });
        t.classList.add("active");
        var mode = t.dataset.mode;
        signinForm.hidden = mode !== "signin";
        signupForm.hidden = mode !== "signup";
      });
    });

    signinForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = document.getElementById("signinEmail").value.trim();
      var password = document.getElementById("signinPassword").value;
      var btn = document.getElementById("signinBtn");
      var err = document.getElementById("signinError");
      err.textContent = "";
      if (!email || !password) { err.textContent = "请输入邮箱和密码"; return; }
      btn.disabled = true; btn.textContent = "登录中…";
      var res = await cloud.auth.signInWithPassword({ email: email, password: password });
      btn.disabled = false; btn.textContent = "登 录";
      if (res.error) { err.textContent = "邮箱或密码不正确，请重试"; return; }
      await loadApp();
    });

    document.getElementById("sendCodeBtn").addEventListener("click", async function () {
      var email = document.getElementById("signupEmail").value.trim();
      var err = document.getElementById("signupError");
      var btn = this;
      err.textContent = "";
      if (!email) { err.textContent = "请先填写邮箱"; return; }
      btn.disabled = true; btn.textContent = "发送中…";
      var sent = await cloud.auth.sendOtp({ email: email });
      if (sent.error) { btn.disabled = false; btn.textContent = "获取验证码"; err.textContent = "验证码发送失败，请稍后再试"; return; }
      pendingOtp = { email: email, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
      if (pendingOtp.isExistingUser) {
        btn.disabled = false; btn.textContent = "获取验证码";
        err.textContent = "该邮箱已注册，请切换到「登录」直接登录";
        return;
      }
      btn.textContent = "已发送";
      var n = 60;
      var timer = setInterval(function () {
        n -= 1;
        if (n <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "重新获取"; }
        else { btn.textContent = n + "s 后重发"; }
      }, 1000);
    });

    signupForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var email = document.getElementById("signupEmail").value.trim();
      var password = document.getElementById("signupPassword").value;
      var code = document.getElementById("signupCode").value.trim();
      var btn = document.getElementById("signupBtn");
      var err = document.getElementById("signupError");
      err.textContent = "";
      if (!pendingOtp || pendingOtp.email !== email) { err.textContent = "请先获取验证码"; return; }
      if (!code) { err.textContent = "请输入验证码"; return; }
      btn.disabled = true; btn.textContent = "注册中…";
      var completed = await cloud.auth.verifyOtp({
        email: pendingOtp.email,
        verificationId: pendingOtp.verificationId,
        isExistingUser: pendingOtp.isExistingUser,
        token: code,
        password: pendingOtp.isExistingUser ? undefined : password,
      });
      if (completed.error) { btn.disabled = false; btn.textContent = "注册并进入"; err.textContent = "验证码不正确或已过期，请重试"; return; }
      pendingOtp = null;
      await loadApp();
    });
  }

  function hideLogin() {
    var overlay = document.getElementById("loginOverlay");
    if (overlay) overlay.remove();
  }

  async function loadApp() {
    if (appLoaded) return;
    appLoaded = true;
    hideLogin();
    await import("./app.mjs?v=1");
  }

  async function boot() {
    // 未部署（endpoint 仍是占位符）时，跳过云登录，直接加载 app.mjs 走本地 demo 模式。
    if (CONFIG.endpoint.indexOf("__") === 0) {
      await loadApp();
      return;
    }
    initCloud();
    injectAdapter();
    try {
      const res = await cloud.auth.getSession();
      if (res.error || !res.data) {
        showLogin();
        return;
      }
      await loadApp();
    } catch (e) {
      showLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
