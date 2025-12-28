// /public/admin-home/AdminHome.js
// v1.4 — stable wiring + token/legacy fallback
console.log("✅ AdminHome.js loaded");

(function () {
  "use strict";

  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY   = "mss_admin_token";
  const LS_LEGACY_KEY  = "mss_admin_key";

  const LOGIN_URL = "/admin-login/AdminLogin.html";
  const SCHOOL_SIGNUP_URL = "/signup/SchoolSignUp.html";
  const MANAGE_SCHOOLS_URL = "/admin/ManageSchools.html";

  function $(id) { return document.getElementById(id); }

  function readSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn("[AdminHome] Failed to read/parse session:", e);
      return null;
    }
  }

  // Prefer JWT token; fallback to legacy key (so older pages keep working)
  function readAuthArtifact() {
    try {
      const token = (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
      if (token) return { type: "token", value: token };

      const legacy = (localStorage.getItem(LS_LEGACY_KEY) || "").trim();
      if (legacy) return { type: "legacy", value: legacy };

      return { type: "none", value: "" };
    } catch (e) {
      console.warn("[AdminHome] Failed to read token/key:", e);
      return { type: "none", value: "" };
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
    const flag =
      session.isSuperAdmin ??
      session.isSuperadmin ??
      session.is_super_admin ??
      false;

    if (flag === true) return true;

    // Optional heuristic fallback (keep if you like)
    const email = String(session.email || "");
    return /@mss\.com$/i.test(email);
  }

  function populateMeta(session, auth) {
    $("admin-email").textContent = session.email || "—";
    $("admin-id").textContent = session.adminId != null ? String(session.adminId) : "—";

    const superAdmin = isSuperAdmin(session);
    $("admin-role").textContent = superAdmin ? "Super admin" : "Admin";

    const badge = $("admin-key-badge");
    if (badge) {
      if (auth.type === "token") badge.textContent = "token: present";
      else if (auth.type === "legacy") badge.textContent = "key: present";
      else badge.textContent = "token: none";
    }

    const superBadge = $("admin-super-badge");
    if (superBadge) superBadge.style.display = superAdmin ? "inline-flex" : "none";
  }

  function logout() {
    try {
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_LEGACY_KEY);
    } catch (e) {
      console.warn("[AdminHome] Error clearing admin storage:", e);
    }
    window.location.href = LOGIN_URL;
  }

  function openInViewer(title, src) {
    // If you decide to stop using the viewer, you can replace this
    // with: window.location.href = src;
    if (!window.MSSViewer || typeof window.MSSViewer.open !== "function") {
      window.location.href = src;
      return;
    }
    window.MSSViewer.open({ title, src });
  }

  function init() {
    const session = readSession();
    const auth = readAuthArtifact();

    if (!session || !session.email || session.adminId == null) {
      logout();
      return;
    }

    const superAdmin = isSuperAdmin(session);
    populateMeta(session, auth);

    setStatus(
      auth.type !== "none"
        ? "You are signed in. Use the buttons below to open each tool."
        : "You are signed in, but your admin token/key is missing. Please log in again.",
      auth.type === "none"
    );

    const btnPortal = $("btn-portal");
    const btnConfig = $("btn-config");
    const btnQuestions = $("btn-questions");
    const btnPrompts = $("btn-prompts");
    const btnInviteSchoolSignup = $("btn-invite-school-signup");
    const btnManageSchools = $("btn-manage-schools");
    const btnSchoolSignup = $("btn-school-signup");
    const btnLogout = $("btn-logout");

    btnPortal?.addEventListener("click", () => {
      window.location.href = "/admin/SchoolPortal.html";
    });

    btnConfig?.addEventListener("click", () => {
      window.location.href = "/config-admin/ConfigAdmin.html";
    });

    btnQuestions?.addEventListener("click", () => {
      window.location.href = "/questions-admin/WidgetSurvey.html";
    });

    btnPrompts?.addEventListener("click", () => {
      // keep it simple for now (viewer + fixed slug)
      window.location.href = "/admin-prompt/PromptAdmin.html?slug=demo";
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
          // If you don't want viewer: window.location.href = MANAGE_SCHOOLS_URL;
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

    btnLogout?.addEventListener("click", (e) => {
      e.preventDefault();
      logout();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();