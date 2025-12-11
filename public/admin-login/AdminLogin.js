// /public/admin-login/AdminLogin.js
// v2.3 – DEV debug version
// - Saves mssAdminSession + mss_admin_key
// - Logs raw password (DEV ONLY)
// - DEV_BYPASS_ON_401 lets us in even if /api/admin/login returns 401

console.log("✅ AdminLogin.js loaded");

(function () {
  "use strict";

  // ⚠️ DEV ONLY: when server-side auth is fixed, set this back to false
  const DEV_BYPASS_ON_401 = true;

  const LS_SESSION_KEY = "mssAdminSession"; // used by AdminHome + SchoolPortal
  const LS_ADMIN_KEY = "mss_admin_key";     // used by Config Admin / Questions admin
  const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

  // ---------------------------------------------------------------------------
  // Tiny helpers
  // ---------------------------------------------------------------------------
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
    statusEl.style.color = isError ? "#d00" : "";
  }

  function saveAdminSession(session) {
    try {
      console.log("[AdminLogin] Saving mssAdminSession:", session);
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.error("[AdminLogin] Error saving session:", e);
    }
  }

  function saveAdminKey(adminKey) {
    if (!adminKey) return;
    try {
      console.log("[AdminLogin] Saving mss_admin_key:", adminKey);
      localStorage.setItem(LS_ADMIN_KEY, String(adminKey));
    } catch (e) {
      console.error("[AdminLogin] Error saving admin key:", e);
    }
  }

  // For debug: log any existing values
  try {
    const rawSession = localStorage.getItem(LS_SESSION_KEY);
    const rawKey = localStorage.getItem(LS_ADMIN_KEY);
    console.log("[AdminLogin] Existing mssAdminSession:", rawSession);
    console.log("[AdminLogin] Existing mss_admin_key:", rawKey);
  } catch (e) {
    console.warn("[AdminLogin] localStorage not accessible:", e);
  }

  // ---------------------------------------------------------------------------
  // Normalize whatever /api/admin/login returns
  // ---------------------------------------------------------------------------
  function normalizeLoginResponse(data, emailFromForm) {
    if (!data || typeof data !== "object") {
      console.warn(
        "[AdminLogin] normalizeLoginResponse: data is not an object:",
        data
      );
      return null;
    }

    const adminKey =
      data.adminKey ||
      data.admin_key ||
      data.token ||
      (data.session &&
        (data.session.adminKey || data.session.admin_key)) ||
      null;

    let admin =
      data.admin ||
      (data.session && (data.session.admin || data.session)) ||
      data;

    if (!admin || typeof admin !== "object") {
      console.warn(
        "[AdminLogin] normalizeLoginResponse: no admin object in data:",
        data
      );
      return { adminKey, adminId: null, email: null, isSuperadmin: null };
    }

    const adminId =
      admin.adminId ??
      admin.id ??
      admin.admin_id ??
      null;

    const email =
      admin.email ||
      data.email ||
      emailFromForm ||
      null;

    const isSuperadmin = !!(
      admin.isSuperadmin ??
      admin.is_superadmin ??
      admin.superadmin ??
      admin.isSuper
    );

    return { adminKey, adminId, email, isSuperadmin };
  }

  // ---------------------------------------------------------------------------
  // Wire up the form + inputs
  // ---------------------------------------------------------------------------
  const form =
    document.getElementById("adminLoginForm") ||
    $("form");

  const emailInput =
    $("#email.mss-input") ||
    $("#admin-email") ||
    $("input[type=email]") ||
    $("input[name=email]");

  const passwordInput =
    $("#password.mss-input") ||
    $("#admin-password") ||
    $("input[type=password]") ||
    $("input[name=password]");

  if (!form || !emailInput || !passwordInput) {
    console.error(
      "[AdminLogin] Could not find form or inputs – login disabled."
    );
    return;
  }

  console.log("[AdminLogin] Wiring login form", {
    form,
    emailInput,
    passwordInput,
  });

  // Show-password toggle (hooked to <input id="show-password"> in the HTML)
  const showPwCheckbox = document.getElementById("show-password");
  if (showPwCheckbox && passwordInput) {
    showPwCheckbox.addEventListener("change", () => {
      const type = showPwCheckbox.checked ? "text" : "password";
      console.log("[AdminLogin] Show password:", showPwCheckbox.checked);
      passwordInput.type = type;
    });
  }

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Signing you in…", false);

    const email = (emailInput.value || "").trim();
    const password = (passwordInput.value || "").trim();

    if (!email || !password) {
      setStatus("Please enter your email and password.", true);
      return;
    }

    // 🔍 DEV: log raw email + password so we can see exactly what was typed
    console.log("[AdminLogin] SUBMIT attempt:", {
      email,
      rawPassword: password, // ⚠️ DEV ONLY – do NOT keep this in production
    });

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        console.warn("[AdminLogin] Non-JSON response:", e);
      }

      console.log("[AdminLogin] Login response (raw):", {
        status: res.status,
        data,
      });

      const normPreview = normalizeLoginResponse(data || {}, email) || {};
      console.log("[AdminLogin] Normalized preview:", normPreview);

      // ----------------------------------------------------
      // INVALID LOGIN (email wrong OR password wrong)
      // ----------------------------------------------------
      if (res.status === 401 || !res.ok || (data && data.ok === false)) {
        const msg =
          (data && (data.message || data.error)) ||
          "Login failed. Please check your email and password.";

        setStatus(msg, true);

        console.warn("[AdminLogin] Server rejected credentials:", {
          status: res.status,
          msg,
          normPreview,
        });

        // 🔧 DEV BYPASS: still let them in so we can QA the portal
        if (DEV_BYPASS_ON_401) {
          console.warn(
            "[AdminLogin] DEV_BYPASS_ON_401 is TRUE – creating local session despite 401."
          );

          // DEV: map known admin emails → real admin IDs from the DB
          const DEV_KNOWN_ADMIN_IDS = {
            "chrish@mss.com": 24,
            "tickittaskit@gmail.com": 29,
            "tickittaskit+ott-esl@gmail.com": 30,
            // add others here as needed
          };

          const normalizedEmail =
            (normPreview.email || email || "").toLowerCase();

          const fallbackId =
            normPreview.adminId ??
            DEV_KNOWN_ADMIN_IDS[normalizedEmail] ??
            -1;

          const fallbackSession = {
            adminId: fallbackId,
            email: normalizedEmail,
            isSuperadmin:
              typeof normPreview.isSuperadmin === "boolean"
                ? normPreview.isSuperadmin
                : false,
          };

          console.log("[AdminLogin] Fallback session (dev):", fallbackSession);

          saveAdminSession(fallbackSession);
          if (normPreview.adminKey) {
            saveAdminKey(normPreview.adminKey);
          }

          setStatus("Signed in (DEV bypass – server rejected creds).", false);
          window.location.href = ADMIN_HOME_URL;
        }

        // If we’re not bypassing, just stop here
        return;
      }

      // ----------------------------------------------------
      // SUCCESS – normalize and save session
      // ----------------------------------------------------
      const norm = normalizeLoginResponse(data, email);
      console.log("[AdminLogin] Normalized SUCCESS:", norm);

      if (!norm || !norm.adminId || !norm.email) {
        setStatus(
          "Login succeeded but session data is incomplete. Please contact support.",
          true
        );
        return;
      }

      saveAdminSession({
        adminId: norm.adminId,
        email: norm.email,
        isSuperadmin: norm.isSuperadmin,
      });

      saveAdminKey(norm.adminKey);

      setStatus("");
      window.location.href = ADMIN_HOME_URL;
    } catch (err) {
      console.error("[AdminLogin] Network error:", err);
      setStatus(
        "We couldn't sign you in due to a technical problem. Please try again.",
        true
      );
    }
  });
})();