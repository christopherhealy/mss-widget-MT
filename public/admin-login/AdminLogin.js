// /public/admin-login/AdminLogin.js
// v2.6 — JWT session (prod-ready)
// - Stores mssAdminSession + mss_admin_token
// - Expects server to return { ok:true, admin:{...}, token:"<jwt>" }
// - DEV bypass (optional) never mints a token (protected endpoints remain protected)

console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  // ⚠️ DEV ONLY: if true, allows UI navigation even when server rejects login.
  // This is helpful for QA, but note: no token is issued, so protected APIs will reject.
  const DEV_BYPASS_ON_401 = false;

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";
  const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

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
    } catch (e) {
      console.warn("[AdminLogin] localStorage set failed:", key, e);
    }
  }

  function safeRemoveLS(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("[AdminLogin] localStorage remove failed:", key, e);
    }
  }

  function clearAuthStorage() {
    safeRemoveLS(LS_TOKEN_KEY);
    // Keep session until success? We clear session on each attempt to avoid stale state.
    safeRemoveLS(LS_SESSION_KEY);
  }

  function saveAdminSession(session) {
    safeSetLS(LS_SESSION_KEY, JSON.stringify(session));
  }

  function saveAdminToken(token) {
    if (!token) return;
    safeSetLS(LS_TOKEN_KEY, String(token));
  }

  function deriveIsSuperadminFromEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    return /@mss\.com$/i.test(e);
  }

  // -----------------------------
  // Normalize server response
  // Expected (preferred):
  //   { ok:true, admin:{ adminId, email, isSuperAdmin, ... }, token:"<jwt>" }
  //
  // Tolerated token aliases:
  //   jwt, accessToken, access_token
  // -----------------------------
  function normalizeLoginResponse(data, emailFromForm) {
    if (!data || typeof data !== "object") return null;

    const admin = data.admin || data.session || data;

    const adminId =
      admin.adminId ??
      admin.id ??
      admin.admin_id ??
      null;

    const email =
      String(admin.email || emailFromForm || "")
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

  // -----------------------------
  // Wire form
  // -----------------------------
  const form = document.getElementById("adminLoginForm") || $("form");
  const emailInput = $("input[type=email]") || $("#admin-email");
  const passwordInput = $("input[type=password]") || $("#admin-password");

  if (!form || !emailInput || !passwordInput) {
    console.error("[AdminLogin] Form or inputs not found; login disabled.");
    return;
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
    clearAuthStorage(); // prevent stale tokens/sessions

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      // -----------------------------
      // FAILURE
      // -----------------------------
      if (!res.ok || data.ok === false) {
        const msg =
          data.message ||
          "Login failed. Please check your email and password.";

        if (!DEV_BYPASS_ON_401) {
          setStatus(msg, true);
          return;
        }

        console.warn("[AdminLogin] DEV BYPASS active (server rejected login)", {
          status: res.status,
          msg,
        });

        // DEV-only mapping; does NOT grant API access (no token).
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
        return;
      }

      if (!norm.token) {
        // This is the root cause of your “token missing” situations
        setStatus(
          "Login succeeded but server did not return a JWT token. Fix /api/admin/login to return { token }. Check MSS_ADMIN_JWT_SECRET.",
          true
        );
        return;
      }

      const session = {
        adminId: Number(norm.adminId),
        email: norm.email,
        isSuperadmin:
          typeof norm.isSuperadmin === "boolean"
            ? norm.isSuperadmin
            : deriveIsSuperadminFromEmail(norm.email),
      };

      saveAdminSession(session);
      saveAdminToken(norm.token);

      setStatus("");
      window.location.href = ADMIN_HOME_URL;
    } catch (err) {
      console.error("[AdminLogin] Network error:", err);
      setStatus("Network error. Please try again.", true);
    }
  });
})();