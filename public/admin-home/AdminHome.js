// /public/admin-home/AdminHome.js
// v1.2 — JWT token version + MSSViewer modal
// - Uses mssAdminSession + mss_admin_token
// - No ES module import
// - Opens Invite School Sign-up in MSSViewer modal

console.log("✅ AdminHome.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";
  const LOGIN_URL = "/admin-login/AdminLogin.html";

  function $(id) {
    return document.getElementById(id);
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("[AdminHome] Failed to read/parse session:", e);
      return null;
    }
  }

  function readToken() {
    try {
      return localStorage.getItem(LS_TOKEN_KEY) || "";
    } catch (e) {
      console.warn("[AdminHome] Failed to read token:", e);
      return "";
    }
  }

  function setStatus(msg, isError = false) {
    const el = $("admin-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  function isSuperAdmin(session) {
    if (!session) return false;
    const email = session.email || "";
    return !!session.isSuperadmin || /@mss\.com$/i.test(email);
  }

  function populateMeta(session, token) {
    $("admin-email").textContent = session.email || "—";
    $("admin-id").textContent =
      session.adminId != null ? String(session.adminId) : "—";

    const isSuper = isSuperAdmin(session);
    $("admin-role").textContent = isSuper ? "Super admin" : "Admin";

    const badge = $("admin-key-badge");
    if (badge) badge.textContent = token ? "token: present" : "token: missing";

    const superBadge = $("admin-super-badge");
    if (superBadge) superBadge.style.display = isSuper ? "inline-flex" : "none";
  }

  function logout() {
    try {
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_TOKEN_KEY);
    } catch (e) {
      console.warn("[AdminHome] Error clearing admin storage:", e);
    }
    window.location.href = LOGIN_URL;
  }

  function openInViewer(title, src) {
    if (!window.MSSViewer || typeof window.MSSViewer.open !== "function") {
      console.warn("[AdminHome] MSSViewer not available; falling back to navigation:", src);
      window.location.href = src;
      return;
    }
    window.MSSViewer.open({ title, src });
  }

  function init() {
    const session = readSession();
    const token = readToken();

    if (!session || !session.email || session.adminId == null) {
      logout();
      return;
    }

    const isSuper = isSuperAdmin(session);

    populateMeta(session, token);

    setStatus(
      token
        ? "You are signed in. Use the buttons below to open each tool."
        : "You are signed in, but your admin token is missing. Please log in again to restore it.",
      !token
    );

    const btnPortal = $("btn-portal");
    const btnConfig = $("btn-config");
    const btnQuestions = $("btn-questions");
    const btnSchoolSignup = $("btn-school-signup");
    const btnInviteSchoolSignup = $("btn-invite-school-signup");
    const btnLogout = $("btn-logout");

    if (btnPortal) btnPortal.addEventListener("click", () => {
      window.location.href = "/admin/SchoolPortal.html";
    });

    if (btnConfig) btnConfig.addEventListener("click", () => {
      window.location.href = "/config-admin/ConfigAdmin.html";
    });

    if (btnQuestions) btnQuestions.addEventListener("click", () => {
      window.location.href = "/questions-admin/WidgetSurvey.html";
    });

    // Super admin only
    if (btnSchoolSignup) {
      btnSchoolSignup.style.display = isSuper ? "inline-flex" : "none";
      if (isSuper) {
        btnSchoolSignup.addEventListener("click", () => {
          window.location.href = "/signup/SchoolSignUp.html";
        });
      }
    }

    // Super admin only — OPEN IN MODAL VIEWER
    if (btnInviteSchoolSignup) {
      btnInviteSchoolSignup.style.display = isSuper ? "inline-flex" : "none";
      if (isSuper) {
        btnInviteSchoolSignup.addEventListener("click", () => {
          openInViewer("Invite School Sign-up", "/admin-invite/InviteSchoolSignup.html");
        });
      }
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