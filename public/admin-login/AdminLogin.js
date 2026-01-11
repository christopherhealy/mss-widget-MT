// /public/admin-login/AdminLogin.js
// v2.9 — JWT session (role from server only)
// - Stores mssAdminSession + mss_admin_token
// - Expects server to return { ok:true, admin:{...}, token:"<jwt>" }
// - NO role inference from email (DB/token is source of truth)

console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  const DEV_BYPASS_ON_401 = false;

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";
  const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

  const LEGACY_KEYS = [
    "mss_admin_key",
    "mssAdminToken",
    "mss_admin_jwt",
    "mss_admin_session",
  ];

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  const statusEl =
    document.getElementById("login-status") ||
    $(".login-status") ||
    null;

  function setStatus(msg, isError = false) {
    if (!statusEl) {
      if (msg) console.log("[AdminLogin] status:", msg);
      return;
    }
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#b91c1c" : "";
  }

  function safeSetLS(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn("[AdminLogin] localStorage set failed:", key, e);
      return false;
    }
  }

  function safeRemoveLS(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn("[AdminLogin] localStorage remove failed:", key, e);
      return false;
    }
  }

  function clearAuthStorage() {
    safeRemoveLS(LS_TOKEN_KEY);
    safeRemoveLS(LS_SESSION_KEY);
    LEGACY_KEYS.forEach((k) => safeRemoveLS(k));
  }

  function saveAdminSession(session) {
    return safeSetLS(LS_SESSION_KEY, JSON.stringify(session));
  }

  function saveAdminToken(token) {
    if (!token) return false;
    return safeSetLS(LS_TOKEN_KEY, String(token));
  }

  function normalizeLoginResponse(data, emailFromForm) {
    if (!data || typeof data !== "object") return null;

    const admin = data.admin || data.session || null;
    const adminId = admin?.adminId ?? admin?.id ?? admin?.admin_id ?? null;

    const email = String(admin?.email || emailFromForm || "")
      .trim()
      .toLowerCase() || null;

    const isSuperadmin = !!(
      admin?.is_superadmin ??
      admin?.isSuperadmin ??
      admin?.isSuperAdmin ??
      admin?.superadmin ??
      admin?.isSuper ??
      false
    );

    const token =
      data.token ||
      data.jwt ||
      data.accessToken ||
      data.access_token ||
      (data.session && (data.session.token || data.session.jwt)) ||
      null;

    return { adminId, email, isSuperadmin, token, rawAdmin: admin };
  }

  async function safeJson(resp) {
    try {
      return await resp.json();
    } catch {
      return {};
    }
  }

  function init() {
    const form = document.getElementById("adminLoginForm") || $("form");
    const emailInput = document.getElementById("email") || $("input[type=email]");
    const passwordInput = document.getElementById("password") || $("input[type=password]");

    if (!form || !emailInput || !passwordInput) {
      console.error("[AdminLogin] Form or inputs not found; login disabled.", {
        formFound: !!form,
        emailFound: !!emailInput,
        passwordFound: !!passwordInput,
      });
      return;
    }

    const showPw =
      document.getElementById("show-password") ||
      document.getElementById("showPassword") ||
      document.querySelector('input[name="showPassword"]') ||
      null;

    function setPwVisible(visible) {
      passwordInput.type = visible ? "text" : "password";
    }

    if (showPw) {
      setPwVisible(!!showPw.checked);
      showPw.addEventListener("change", () => setPwVisible(!!showPw.checked));
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = String(emailInput.value || "").trim().toLowerCase();
      const password = String(passwordInput.value || "").trim();

      if (!email || !password) {
        setStatus("Please enter your email and password.", true);
        return;
      }

      setStatus("Signing you in…");
      clearAuthStorage();

      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ email, password }),
        });

        const data = await safeJson(res);

        console.log("[AdminLogin] /api/admin/login", {
          status: res.status,
          okField: data?.ok,
          hasAdmin: !!data?.admin,
          hasToken: !!(data?.token || data?.jwt || data?.accessToken || data?.access_token),
        });

        // FAILURE
        if (!res.ok || data.ok === false) {
          const msg =
            data.message ||
            data.error ||
            "Login failed. Please check your email and password.";

          if (!DEV_BYPASS_ON_401) {
            setStatus(msg, true);
            return;
          }

          // DEV BYPASS (optional)
          console.warn("[AdminLogin] DEV BYPASS active (server rejected login)", {
            status: res.status,
            msg,
          });

          const DEV_KNOWN_ADMIN_IDS = {
            "chrish@mss.com": 24,
            "andrew@mss.com": 25,
            "tickittaskit@gmail.com": 29,
          };

          const fallbackId = DEV_KNOWN_ADMIN_IDS[email];
          if (!fallbackId) {
            setStatus("DEV bypass failed: unknown admin email.", true);
            return;
          }

          // In bypass, do NOT claim superadmin unless you explicitly want it:
          saveAdminSession({
            adminId: Number(fallbackId),
            email,
            isSuperadmin: false,
            bypass: true
          });

          setStatus("Signed in (DEV bypass). No token issued.", false);
          window.location.href = ADMIN_HOME_URL;
          return;
        }

        // SUCCESS
        const norm = normalizeLoginResponse(data, email);

        if (!norm || !norm.adminId || !norm.email) {
          setStatus("Login succeeded but session data is incomplete.", true);
          console.warn("[AdminLogin] Incomplete normalized login response:", norm, data);
          return;
        }

        if (!norm.token) {
          setStatus("Login succeeded but server did not return a JWT token.", true);
          console.warn("[AdminLogin] Missing token in server response:", data);
          return;
        }

        const sessionOk = saveAdminSession({
          adminId: Number(norm.adminId),
          email: norm.email,
          isSuperadmin: !!norm.isSuperadmin,   // SOURCE OF TRUTH: server/admin record
          admin: norm.rawAdmin || null         // helpful for QA, optional
        });

        const tokenOk = saveAdminToken(norm.token);

        console.log("[AdminLogin] persisted", {
          sessionOk,
          tokenOk,
          storedTokenLen: (localStorage.getItem(LS_TOKEN_KEY) || "").length,
          isSuperadmin: !!norm.isSuperadmin
        });

        if (!tokenOk) {
          setStatus("Login succeeded but token could not be saved to localStorage.", true);
          return;
        }

        setStatus("");
        window.location.href = ADMIN_HOME_URL;
      } catch (err) {
        console.error("[AdminLogin] Network error:", err);
        setStatus("Network error. Please try again.", true);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();