// /public/admin-home/AdminHome.js
// v1.0 – Simple landing page using mssAdminSession + mss_admin_key

console.log("✅ AdminHome.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_ADMIN_KEY = "mss_admin_key";
  const LOGIN_URL = "/admin-login/AdminLogin.html";

  function $(id) {
    return document.getElementById(id);
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      console.log("[AdminHome] raw mssAdminSession:", raw);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      console.log("[AdminHome] parsed session:", parsed);
      return parsed;
    } catch (e) {
      console.warn("[AdminHome] Failed to read/parse session:", e);
      return null;
    }
  }

  function readAdminKey() {
    try {
      const key = localStorage.getItem(LS_ADMIN_KEY);
      console.log("[AdminHome] mss_admin_key:", key);
      return key;
    } catch (e) {
      console.warn("[AdminHome] Failed to read admin key:", e);
      return null;
    }
  }

  function setStatus(msg, isError = false) {
    const el = $("admin-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  function populateMeta(session, adminKey) {
    $("admin-email").textContent = session.email || "—";
    $("admin-id").textContent =
      session.adminId != null ? String(session.adminId) : "—";

    const isSuper =
      !!session.isSuperadmin ||
      !!session.is_superadmin ||
      !!session.isSuper;

    $("admin-role").textContent = isSuper ? "Super admin" : "Admin";

    const badge = $("admin-key-badge");
    if (badge) {
      badge.textContent = adminKey ? "key: present" : "key: none";
    }

    const superBadge = $("admin-super-badge");
    if (superBadge) {
      superBadge.style.display = isSuper ? "inline-flex" : "none";
    }
  }

  function logout() {
    try {
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_ADMIN_KEY);
      localStorage.removeItem("MSS_ADMIN_SESSION");
      localStorage.removeItem("MSS_ADMIN_SESSION_V2");
      localStorage.removeItem("MSS_ADMIN_TOKEN");
      localStorage.removeItem("MSS_ADMIN_EMAIL");
    } catch (e) {
      console.warn("[AdminHome] Error clearing admin storage:", e);
    }
    window.location.href = LOGIN_URL;
  }

  function init() {
    console.log("🔧 AdminHome init()");

    const session = readSession();
    const adminKey = readAdminKey();

    if (!session || !session.email || (!session.adminId && session.id == null)) {
      console.warn("[AdminHome] No valid session – redirecting to login");
      logout();
      return;
    }

    // Normalise adminId
    session.adminId =
      session.adminId != null ? session.adminId : session.id;

    populateMeta(session, adminKey);
    setStatus("You are signed in. Use the buttons below to open each tool.");

    // Wire buttons
    const btnPortal = $("btn-portal");
    const btnConfig = $("btn-config");
    const btnQuestions = $("btn-questions");
    const btnLogout = $("btn-logout");

    if (btnPortal) {
      btnPortal.addEventListener("click", () => {
        window.location.href = "/admin/SchoolPortal.html";
      });
    }

    if (btnConfig) {
      btnConfig.addEventListener("click", () => {
        // If you later want to pass a slug, we can add a param here.
        window.location.href = "/config-admin/ConfigAdmin.html";
      });
    }

    if (btnQuestions) {
      btnQuestions.addEventListener("click", () => {
        // You can swap this path to /questions-admin/WidgetSurvey.html if you prefer.
        window.location.href = "/questions-admin/WidgetSurvey.html";
      });
    }

    if (btnLogout) {
      btnLogout.addEventListener("click", (e) => {
        e.preventDefault();
        logout();
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();