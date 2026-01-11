// /public/admin-home/AdminHome.js
// v1.5 — Super Admin must choose a school (no persistence) + token/legacy fallback
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

  // Unified fetch that carries either Bearer token OR legacy x-admin-key
  async function adminFetch(url, opts = {}) {
    const auth = readAuthArtifact();
    const headers = new Headers(opts.headers || {});

    if (auth.type === "token") {
      headers.set("Authorization", "Bearer " + auth.value);
    } else if (auth.type === "legacy") {
      headers.set("x-admin-key", auth.value);
    }

    return fetch(url, { ...opts, headers });
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

    // Optional heuristic fallback
    const email = String(session.email || "");
    return /@mss\.com$/i.test(email);
  }

  function populateMeta(session, auth) {
    const superAdmin = isSuperAdmin(session);

    $("admin-email").textContent = session.email || "—";
    $("admin-id").textContent =
      session.adminId != null ? String(session.adminId) : "—";
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
    if (!window.MSSViewer || typeof window.MSSViewer.open !== "function") {
      window.location.href = src;
      return;
    }
    window.MSSViewer.open({ title, src });
  }

  // Buttons that require a school slug context
  function setSchoolScopedButtonsEnabled(enabled) {
    const ids = ["btn-portal", "teacherAdminBtn", "btn-config", "btn-questions"];
    ids.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !enabled;
    });
  }

  function setSlugPill(slug) {
    const pill = $("admin-school-slug-pill"); // if present in HTML
    if (!pill) return;
    pill.textContent = "slug: " + (slug || "—");
  }

  // Super Admin: load schools into dropdown, but DO NOT auto-select.
  // Requirement: force the super admin to pick a school each session (no persistence).
  async function loadSchoolsForSuperAdmin(session) {
    const wrap = $("school-picker-wrap");
    const sel = $("admin-school-select");
    const btnRefresh = $("btn-school-refresh");

    if (!wrap || !sel) return;

    wrap.style.display = "block";

    async function refresh() {
      sel.disabled = true;
      sel.innerHTML = '<option value="" selected>Loading schools…</option>';

      const url =
        "/api/admin/my-schools?email=" +
        encodeURIComponent(session.email || "") +
        "&adminId=" +
        encodeURIComponent(String(session.adminId ?? session.id ?? ""));

      const res = await adminFetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || body.ok === false) {
        sel.innerHTML = '<option value="" selected>(Failed to load schools)</option>';
        setSlugPill("");
        setSchoolScopedButtonsEnabled(false);
        throw new Error("Failed to load schools: " + (body.error || res.status));
      }

      const schools = Array.isArray(body.schools) ? body.schools : [];

      if (!schools.length) {
        sel.innerHTML = '<option value="" selected>(No schools found)</option>';
        setSlugPill("");
        setSchoolScopedButtonsEnabled(false);
        return;
      }

      // Required placeholder first
      const opts =
        '<option value="" selected disabled>— Select a school —</option>' +
        schools
          .map((s) => {
            const slug = String(s.slug || "").trim();
            const name = String(s.name || s.slug || "(Unnamed school)").trim();
            const label = slug && name ? `${name} (${slug})` : (name || slug);
            return `<option value="${slug.replace(/"/g, "&quot;")}">${label}</option>`;
          })
          .join("");

      sel.innerHTML = opts;
      sel.disabled = false;

      // Force selection
      setSlugPill("");
      setSchoolScopedButtonsEnabled(false);
    }

    // Wire refresh
    btnRefresh?.addEventListener("click", async () => {
      try {
        await refresh();
        setStatus("Schools refreshed. Select a school to continue.", false);
      } catch (e) {
        console.warn(e);
        setStatus("Failed to refresh schools.", true);
      }
    });

    // Initial load
    await refresh();
  }

  async function init() {
    const session = readSession();
    const auth = readAuthArtifact();

    if (!session || !session.email || session.adminId == null) {
      logout();
      return;
    }

    const superAdmin = isSuperAdmin(session);
    populateMeta(session, auth);

    // Slug context:
    // - Admin: can use URL slug or default mss-demo
    // - Super Admin: MUST choose on this page (no default, no persistence)
    let SLUG = "";

    // Super Admin school picker handling
    if (superAdmin) {
      try {
        await loadSchoolsForSuperAdmin(session);
      } catch (e) {
        console.warn("[AdminHome] loadSchoolsForSuperAdmin failed", e);
      }

      // enforce selection
      SLUG = "";
      setSlugPill("");
      setSchoolScopedButtonsEnabled(false);
      setStatus("Select a school to continue.", false);

      const sel = $("admin-school-select");
      sel?.addEventListener("change", () => {
        const chosen = String(sel.value || "").trim();
        SLUG = chosen;
        setSlugPill(SLUG);
        setSchoolScopedButtonsEnabled(!!SLUG);
        if (SLUG) setStatus("School selected. You may open tools.", false);
        else setStatus("Select a school to continue.", true);
      });
    } else {
      // Regular admin flow
      const params = new URLSearchParams(window.location.search);
      SLUG = (params.get("slug") || "mss-demo").trim();
      setSlugPill(SLUG);
      setSchoolScopedButtonsEnabled(true);
    }

    // Auth status
    if (auth.type === "none") {
      setStatus(
        "You are signed in, but your admin token/key is missing. Please log in again.",
        true
      );
    } else if (!superAdmin) {
      setStatus("You are signed in. Use the buttons below to open each tool.", false);
    } else {
      // super admin status already set above (“Select a school…”)
      // keep as-is
    }

    const btnPortal = $("btn-portal");
    const btnConfig = $("btn-config");
    const btnQuestions = $("btn-questions");
    const btnInviteSchoolSignup = $("btn-invite-school-signup");
    const btnManageSchools = $("btn-manage-schools");
    const btnSchoolSignup = $("btn-school-signup");
    const btnLogout = $("btn-logout");
    const btnTeacherAdmin = $("teacherAdminBtn");

    function requireSlugOrWarn() {
      if (!SLUG) {
        setStatus("Please select a school first.", true);
        return null;
      }
      return SLUG;
    }

    // School-scoped tools (carry slug)
    btnTeacherAdmin?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href =
        "/admin-teachers/AdminTeachers.html?slug=" + encodeURIComponent(s);
    });

    btnPortal?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href =
        "/admin/SchoolPortal.html?slug=" + encodeURIComponent(s);
    });

    btnConfig?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href =
        "/config-admin/ConfigAdmin.html?slug=" + encodeURIComponent(s);
    });

    btnQuestions?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href =
        "/questions-admin/WidgetSurvey.html?slug=" + encodeURIComponent(s);
    });

    // Super admin only
    if (btnInviteSchoolSignup) {
      btnInviteSchoolSignup.style.display = superAdmin ? "inline-flex" : "none";
      if (superAdmin) {
        btnInviteSchoolSignup.addEventListener("click", () => {
          openInViewer("Invite School Sign-up", "/admin-invite/InviteSchoolSignup.html");
        });
      }
    }

    if (btnManageSchools) {
      btnManageSchools.style.display = superAdmin ? "inline-flex" : "none";
      if (superAdmin) {
        btnManageSchools.addEventListener("click", () => {
          openInViewer("Manage Schools", MANAGE_SCHOOLS_URL);
        });
      }
    }

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

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => {
      console.error("[AdminHome] init failed", e);
      setStatus("Error loading Admin Home.", true);
    });
  });
})();