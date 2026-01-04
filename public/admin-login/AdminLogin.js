// /public/admin-login/AdminLogin.js
// v2.8 — JWT session (prod-ready, QA-hardened)
// - Stores mssAdminSession + mss_admin_token
// - Expects server to return { ok:true, admin:{...}, token:"<jwt>" }
// - Clears legacy keys to avoid mixed auth
// - Adds QA logging for token presence + persistence

console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  // ⚠️ DEV ONLY: if true, allows UI navigation even when server rejects login.
  // Note: no token is issued, so protected APIs will reject.
  const DEV_BYPASS_ON_401 = false;

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";
  const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

  // Legacy / historical keys we may have used at some point
  const LEGACY_KEYS = [
    "mss_admin_key",
    "mssAdminToken",
    "mss_admin_jwt",
    "mss_admin_session",
  ];

  // -----------------------------
  // Helpers
  // -----------------------------
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

    // Also clear any legacy token fields inside the session object if present
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      const s = raw ? JSON.parse(raw) : null;
      if (s && (s.token || s.jwt || s.adminKey)) {
        delete s.token;
        delete s.jwt;
        delete s.adminKey;
        safeSetLS(LS_SESSION_KEY, JSON.stringify(s));
      }
    } catch (_) {}
  }

  function saveAdminSession(session) {
    return safeSetLS(LS_SESSION_KEY, JSON.stringify(session));
  }

  function saveAdminToken(token) {
    if (!token) return false;
    return safeSetLS(LS_TOKEN_KEY, String(token));
  }

  function deriveIsSuperadminFromEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    return /@mss\.com$/i.test(e);
  }

  // -----------------------------
  // Normalize server response
  // -----------------------------
  function normalizeLoginResponse(data, emailFromForm) {
    if (!data || typeof data !== "object") return null;

    // Accept a few shapes (but prefer { admin, token })
    const admin = data.admin || data.session || data;

    const adminId = admin.adminId ?? admin.id ?? admin.admin_id ?? null;

    const email = String(admin.email || emailFromForm || "")
      .trim()
      .toLowerCase() || null;

    const isSuperadmin = !!(
      admin.isSuperadmin ??
      admin.isSuperAdmin ??
      admin.is_superadmin ??
      admin.superadmin ??
      admin.isSuper ??
      false
    );

    const token =
      data.token ||
      data.jwt ||
      data.accessToken ||
      data.access_token ||
      (data.session && (data.session.token || data.session.jwt)) ||
      null;

    return { adminId, email, isSuperadmin, token };
  }

  async function safeJson(resp) {
    try {
      return await resp.json();
    } catch {
      return {};
    }
  }

  // -----------------------------
  // Init (wire everything once)
  // -----------------------------
  function init() {
    const form = document.getElementById("adminLoginForm") || $("form");

    // Match your HTML exactly:
    // <input id="email" ...>
    // <input id="password" ...>
    const emailInput =
      document.getElementById("email") ||
      $("input[type=email]");

    const passwordInput =
      document.getElementById("password") ||
      $("input[type=password]");

    if (!form || !emailInput || !passwordInput) {
      console.error("[AdminLogin] Form or inputs not found; login disabled.", {
        formFound: !!form,
        emailFound: !!emailInput,
        passwordFound: !!passwordInput,
      });
      return;
    }

    // -----------------------------
    // Show-password toggle (wire on load)
    // -----------------------------
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
    } else {
      console.warn("[AdminLogin] show-password checkbox not found.");
    }

    // -----------------------------
    // Submit handler
    // -----------------------------
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

        // QA: log the minimal response shape (never log password)
        try {
          console.log("[AdminLogin] /api/admin/login", {
            status: res.status,
            okField: data?.ok,
            hasAdmin: !!data?.admin,
            hasToken: !!(data?.token || data?.jwt || data?.accessToken || data?.access_token),
          });
        } catch (_) {}

        // -----------------------------
        // FAILURE
        // -----------------------------
        if (!res.ok || data.ok === false) {
          const msg =
            data.message ||
            data.error ||
            "Login failed. Please check your email and password.";

          if (!DEV_BYPASS_ON_401) {
            setStatus(msg, true);
            return;
          }

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

          saveAdminSession({
            adminId: Number(fallbackId),
            email,
            isSuperadmin: deriveIsSuperadminFromEmail(email),
          });

          setStatus("Signed in (DEV bypass). No token issued.", false);
          window.location.href = ADMIN_HOME_URL;
          return;
        }

        // -----------------------------
        // SUCCESS
        // -----------------------------
        const norm = normalizeLoginResponse(data, email);

        if (!norm || !norm.adminId || !norm.email) {
          setStatus("Login succeeded but session data is incomplete.", true);
          console.warn("[AdminLogin] Incomplete normalized login response:", norm, data);
          return;
        }

        if (!norm.token) {
          setStatus(
            "Login succeeded but server did not return a JWT token. Fix /api/admin/login to return { token }.",
            true
          );
          console.warn("[AdminLogin] Missing token in server response:", data);
          return;
        }

        const sessionOk = saveAdminSession({
          adminId: Number(norm.adminId),
          email: norm.email,
          isSuperadmin:
            typeof norm.isSuperadmin === "boolean"
              ? norm.isSuperadmin
              : deriveIsSuperadminFromEmail(norm.email),
        });

        const tokenOk = saveAdminToken(norm.token);

        // QA: confirm persistence before redirect
        try {
          const storedToken = localStorage.getItem(LS_TOKEN_KEY);
          console.log("[AdminLogin] persisted", {
            sessionOk,
            tokenOk,
            storedTokenLen: storedToken ? storedToken.length : 0,
          });
        } catch (_) {}

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