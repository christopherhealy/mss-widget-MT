// /public/admin-login/AdminLogin.js
// v4.1 — Thin UI wrapper around MSSClient (single auth source of truth)
//
// Notes:
// - MSSClient is the ONLY authority for login + storage.
// - This file is intentionally “thin”: UI + school picker only.
// - Fixes: window.mssClient -> window.MSSClient; avoids double-persist; correct setSession shape.
// - DEV bypass is kept but intentionally isolated (off by default).

(function () {
  "use strict";

  // -----------------------------
  // Preconditions / diagnostics
  // -----------------------------
  console.log("✅ AdminLogin.js loaded");
  if (!window.MSSClient || typeof window.MSSClient.login !== "function") {
    console.error("❌ MSSClient not loaded or incomplete", window.MSSClient);
  }

  const DEV_BYPASS_ON_401 = false;
  const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

  function $(sel, root = document) { return root.querySelector(sel); }
  function el(id) { return document.getElementById(id); }

  const statusEl = el("login-status") || $(".login-status") || null;

  function setStatus(msg, isError = false) {
    if (!statusEl) {
      if (msg) console.log("[AdminLogin] status:", msg);
      return;
    }
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#b91c1c" : "";
  }

  // -----------------------------
  // School picker UI
  // -----------------------------
  function ensureSchoolPickerUI(mountNearEl) {
    let wrap = el("login-school-picker");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.id = "login-school-picker";
    wrap.style.display = "none";
    wrap.style.marginTop = "12px";
    wrap.style.padding = "12px";
    wrap.style.border = "1px solid #e2e8f0";
    wrap.style.borderRadius = "10px";
    wrap.style.background = "#fff";

    wrap.innerHTML = `
      <div style="font-weight:600; margin-bottom:6px;">Select your school</div>
      <div style="font-size:13px; color:#64748b; margin-bottom:10px;">
        This email exists in more than one school. Choose the correct school to continue.
      </div>
      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <select id="login-school-select"
          style="padding:8px 10px; border-radius:8px; border:1px solid #cbd5e1; min-width:280px;">
          <option value="" selected disabled>— Select a school —</option>
        </select>
        <button id="login-school-continue" type="button"
          style="padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; background:#0f172a; color:#fff; cursor:pointer;">
          Continue
        </button>
      </div>
      <div id="login-school-hint" style="margin-top:8px; font-size:13px; color:#64748b;"></div>
    `;

    if (mountNearEl && mountNearEl.parentNode) {
      mountNearEl.parentNode.insertBefore(wrap, mountNearEl.nextSibling);
    } else {
      document.body.appendChild(wrap);
    }

    return wrap;
  }

  function showSchoolPicker(schools) {
    const wrap = ensureSchoolPickerUI(statusEl || el("adminLoginForm") || $("form"));
    const sel = el("login-school-select");
    const hint = el("login-school-hint");
    if (!sel) return;

    const opts =
      '<option value="" selected disabled>— Select a school —</option>' +
      (Array.isArray(schools) ? schools : []).map((s) => {
        const slug = String(s.slug || "").trim();
        const name = String(s.name || s.school_name || slug || "(Unnamed school)").trim();
        const label = slug && name ? `${name} (${slug})` : (name || slug);
        return `<option value="${slug.replace(/"/g, "&quot;")}">${label}</option>`;
      }).join("");

    sel.innerHTML = opts;
    if (hint) hint.textContent = "";
    wrap.style.display = "block";
  }

  function hideSchoolPicker() {
    const wrap = el("login-school-picker");
    if (wrap) wrap.style.display = "none";
  }

  // -----------------------------
  // DEV bypass (optional)
  // -----------------------------
  function tryDevBypass(email) {
    if (!DEV_BYPASS_ON_401) return false;

    const DEV_KNOWN_ADMIN_IDS = {
      "chrish@mss.com": 24,
      "andrew@mss.com": 25,
      "tickittaskit@gmail.com": 29,
    };

    const fallbackId = DEV_KNOWN_ADMIN_IDS[email];
    if (!fallbackId) return false;

    if (!window.MSSClient || typeof window.MSSClient.setSession !== "function") return false;

    // NOTE: bypass token is null; do NOT rely on this for protected endpoints.
    window.MSSClient.setSession({
      token: "DEV_BYPASS_NO_TOKEN",
      session: {
        actorType: "admin",
        actorId: Number(fallbackId),
        email,
        slug: null,
        schoolId: null,
        isSuperAdmin: false,
        isTeacherAdmin: false,
        bypass: true,
      },
    });

    setStatus("Signed in (DEV bypass).", false);
    window.location.href = ADMIN_HOME_URL;
    return true;
  }

  // -----------------------------
  // Single login path
  // -----------------------------
  async function attemptLogin({ email, password, slug }) {
    if (!window.MSSClient || typeof window.MSSClient.login !== "function") {
      setStatus("MSSClient not loaded. Check script order.", true);
      console.error("[AdminLogin] MSSClient missing/incomplete:", window.MSSClient);
      return;
    }

    setStatus("Signing you in…");
    hideSchoolPicker();

    // MSSClient.login() is responsible for clearing legacy storage and persisting canonical auth.
    const r = await window.MSSClient.login({ email, password, slug });

    // Contract: either { ok:true, token, session } OR { ok:false, error:"needs_school_selection", schools:[...] }
    if (r && r.ok === false && r.error === "needs_school_selection") {
      showSchoolPicker(r.schools || []);
      setStatus("Select your school to continue.", true);
      return;
    }

    if (!r || r.ok !== true) {
      const msg = (r && (r.message || r.error)) || "Login failed. Please check your email and password.";
      setStatus(msg, true);
      if (tryDevBypass(email)) return;
      return;
    }

    // IMPORTANT: Do NOT re-persist here. MSSClient.login() already persisted token+session.
    setStatus("");
    window.location.href = ADMIN_HOME_URL;
  }

  // -----------------------------
  // Main init
  // -----------------------------
  function init() {
    const form = el("adminLoginForm") || $("form");
    const emailInput = el("email") || $("input[type=email]");
    const passwordInput = el("password") || $("input[type=password]");

    if (!form || !emailInput || !passwordInput) {
      console.error("[AdminLogin] Form or inputs not found; login disabled.", {
        formFound: !!form,
        emailFound: !!emailInput,
        passwordFound: !!passwordInput,
      });
      return;
    }

    // Optional show password wiring
    const showPw =
      el("show-password") ||
      el("showPassword") ||
      document.querySelector('input[name="showPassword"]') ||
      null;

    function setPwVisible(visible) {
      passwordInput.type = visible ? "text" : "password";
    }

    if (showPw) {
      setPwVisible(!!showPw.checked);
      showPw.addEventListener("change", () => setPwVisible(!!showPw.checked));
    }

    // Continue button for school picker
    document.addEventListener("click", async (e) => {
      if (!e.target || e.target.id !== "login-school-continue") return;

      const sel = el("login-school-select");
      const chosen = sel ? String(sel.value || "").trim() : "";
      if (!chosen) {
        setStatus("Please select a school.", true);
        return;
      }

      const email = String(emailInput.value || "").trim().toLowerCase();
      const password = String(passwordInput.value || "").trim();
      if (!email || !password) {
        setStatus("Please enter your email and password.", true);
        return;
      }

      try {
        await attemptLogin({ email, password, slug: chosen });
      } catch (err) {
        console.error("[AdminLogin] Network error:", err);
        setStatus("Network error. Please try again.", true);
      }
    });

    // Standard submit (first attempt without slug)
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = String(emailInput.value || "").trim().toLowerCase();
      const password = String(passwordInput.value || "").trim();

      if (!email || !password) {
        setStatus("Please enter your email and password.", true);
        return;
      }

      try {
        await attemptLogin({ email, password, slug: null });
      } catch (err) {
        console.error("[AdminLogin] Network error:", err);
        setStatus("Network error. Please try again.", true);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();