// /public/admin-home/AdminHome.js
// v1.3 — JWT token version + MSSViewer modal
console.log("✅ AdminHome.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY = "mss_admin_token";
  const LOGIN_URL = "/admin-login/AdminLogin.html";
  const SCHOOL_SIGNUP_URL = "/signup/SchoolSignUp.html"; 

  // ✅ adjust if your file lives elsewhere
  const MANAGE_SCHOOLS_URL = "/admin/ManageSchools.html";

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
      return (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
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

    // tolerate a few variants
    const flag =
      session.isSuperAdmin ??
      session.isSuperadmin ??
      session.is_super_admin ??
      false;

    if (flag === true) return true;

    // optional fallback heuristic (keep or remove)
    const email = String(session.email || "");
    return /@mss\.com$/i.test(email);
  }

  function populateMeta(session, token) {
    $("admin-email").textContent = session.email || "—";
    $("admin-id").textContent =
      session.adminId != null ? String(session.adminId) : "—";

    const superAdmin = isSuperAdmin(session);
    $("admin-role").textContent = superAdmin ? "Super admin" : "Admin";

    const badge = $("admin-key-badge");
    if (badge) badge.textContent = token ? "token: present" : "token: missing";

    const superBadge = $("admin-super-badge");
    if (superBadge) superBadge.style.display = superAdmin ? "inline-flex" : "none";
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
      console.warn("[AdminHome] MSSViewer not available; navigating:", src);
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

    const superAdmin = isSuperAdmin(session);
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
    const btnInviteSchoolSignup = $("btn-invite-school-signup");
    const btnManageSchools = $("btn-manage-schools");
    const btnSchoolSignup = $("btn-school-signup");
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

    // Super admin only — Invite School Signup
    if (btnInviteSchoolSignup) {
      btnInviteSchoolSignup.style.display = superAdmin ? "inline-flex" : "none";
      if (superAdmin) {
        btnInviteSchoolSignup.addEventListener("click", () => {
          openInViewer("Invite School Sign-up", "/admin-invite/InviteSchoolSignup.html");
        });
      }
    }

    // Super admin only — Manage Schools
    if (btnManageSchools) {
      btnManageSchools.style.display = superAdmin ? "inline-flex" : "none";
      if (superAdmin) {
        btnManageSchools.addEventListener("click", () => {
          openInViewer("Manage Schools", MANAGE_SCHOOLS_URL);
        });
      }
    }

   // Super admin only — School Sign Up
if (btnSchoolSignup) {
  btnSchoolSignup.style.display = superAdmin ? "inline-flex" : "none";
  if (superAdmin) {
    btnSchoolSignup.addEventListener("click", () => {
      openInViewer("School Sign Up", SCHOOL_SIGNUP_URL);
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