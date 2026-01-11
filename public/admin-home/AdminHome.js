// /public/admin-home/AdminHome.js
// v1.6 — DB-authoritative role via /api/admin/me + superadmin school picker (hide when only 1)
// - Never derives superadmin from email.
// - Uses token (Bearer) or legacy key for adminFetch.
// - If superadmin has 1 school: auto-select + hide picker.
// - If superadmin has 2+ schools: force selection each session.

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

  function safeWriteSession(patch) {
    try {
      const s = readSession() || {};
      const next = { ...s, ...patch };
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(next));
      return true;
    } catch (e) {
      console.warn("[AdminHome] Failed to write session:", e);
      return false;
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

    return fetch(url, { ...opts, headers, cache: "no-store" });
  }

  async function adminFetchJson(url, opts = {}) {
    const res = await adminFetch(url, opts);
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  function setStatus(msg, isError = false) {
    const el = $("admin-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
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
    const pill = $("admin-school-slug-pill");
    if (!pill) return;
    pill.textContent = "slug: " + (slug || "—");
  }

  function setSuperBadgeVisible(isSuper) {
    const superBadge = $("admin-super-badge");
    if (superBadge) superBadge.style.display = isSuper ? "inline-flex" : "none";
  }

  function populateMeta({ email, adminId, isSuperadmin }, auth) {
    $("admin-email").textContent = email || "—";
    $("admin-id").textContent = adminId != null ? String(adminId) : "—";
    $("admin-role").textContent = isSuperadmin ? "Super admin" : "Admin";

    const badge = $("admin-key-badge");
    if (badge) {
      if (auth.type === "token") badge.textContent = "token: present";
      else if (auth.type === "legacy") badge.textContent = "key: present";
      else badge.textContent = "token: none";
    }

    setSuperBadgeVisible(!!isSuperadmin);
  }

  // -----------------------------
  // Authoritative "me" (DB-backed)
  // Requires server route:
  //   GET /api/admin/me  -> { ok:true, admin:{ id,email,full_name,is_superadmin,school_id } }
  // -----------------------------
  async function fetchMe() {
    const { res, body } = await adminFetchJson("/api/admin/me?ts=" + Date.now());
    if (!res.ok || body.ok === false) {
      const err = body.error || ("http_" + res.status);
      throw new Error("me_failed:" + err);
    }
    const a = body.admin || {};
    return {
      adminId: a.id ?? a.adminId ?? a.admin_id ?? null,
      email: (a.email || a.admin_email || "").trim().toLowerCase(),
      isSuperadmin: !!(a.is_superadmin || a.isSuperAdmin),
      schoolId: a.school_id ?? null,
      fullName: a.full_name || a.fullName || ""
    };
  }

  // -----------------------------
  // Super Admin school picker
  // - If 1 school: hide picker, auto-select.
  // - If 2+: show picker, force selection (no persistence).
  // -----------------------------
  async function loadSchoolsForSuperAdmin(session, onSelectSlug) {
    const wrap = $("school-picker-wrap");
    const sel = $("admin-school-select");
    const btnRefresh = $("btn-school-refresh");

    if (!wrap || !sel) return;

    wrap.style.display = "block";

    async function refresh() {
      sel.disabled = true;
      sel.innerHTML = '<option value="" selected>Loading schools…</option>';

      // Prefer a server route that uses req.admin.id rather than query params.
      // If you keep /api/admin/my-schools?email=&adminId=, it should still DB-check server-side.
      const url =
        "/api/admin/my-schools?email=" +
        encodeURIComponent(session.email || "") +
        "&adminId=" +
        encodeURIComponent(String(session.adminId ?? session.id ?? ""));

      const { res, body } = await adminFetchJson(url);

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
        return { schools: [] };
      }

      // If exactly one school: hide picker UI and auto-select
      if (schools.length === 1) {
        const only = schools[0] || {};
        const slug = String(only.slug || "").trim();

        // Hide entire picker line (as requested)
        wrap.style.display = "none";

        onSelectSlug(slug);
        return { schools, autoSelected: true };
      }

      // Else: show picker and force selection
      wrap.style.display = "block";

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

      // Force selection each session
      onSelectSlug("");
      return { schools, autoSelected: false };
    }

    btnRefresh?.addEventListener("click", async () => {
      try {
        await refresh();
        setStatus("Schools refreshed. Select a school to continue.", false);
      } catch (e) {
        console.warn(e);
        setStatus("Failed to refresh schools.", true);
      }
    });

    // Selection handler (only relevant when schools.length > 1)
    sel?.addEventListener("change", () => {
      const chosen = String(sel.value || "").trim();
      onSelectSlug(chosen);
    });

    return refresh();
  }

  async function init() {
    const session = readSession();
    const auth = readAuthArtifact();

    if (!session || !session.email || session.adminId == null) {
      logout();
      return;
    }

    if (auth.type === "none") {
      setStatus("Missing admin token/key. Please log in again.", true);
      logout();
      return;
    }

    // 1) Authoritative role from server (DB)
    let me;
    try {
      me = await fetchMe();
    } catch (e) {
      console.warn("[AdminHome] fetchMe failed:", e?.message || e);
      setStatus("Session invalid or expired. Please log in again.", true);
      logout();
      return;
    }

    // Keep local session consistent (avoid role drift)
    safeWriteSession({
      adminId: me.adminId,
      email: me.email,
      isSuperadmin: me.isSuperadmin,
      isSuperAdmin: me.isSuperadmin
    });

    const superAdmin = !!me.isSuperadmin;
    populateMeta({ email: me.email, adminId: me.adminId, isSuperadmin: superAdmin }, auth);

    // Slug context:
    // - Admin: can use URL slug or default mss-demo
    // - Super Admin: must choose (unless only 1 school -> auto-selected)
    let SLUG = "";

    function applySlug(slug) {
      SLUG = String(slug || "").trim();
      setSlugPill(SLUG);
      setSchoolScopedButtonsEnabled(!!SLUG);

      if (superAdmin) {
        if (SLUG) setStatus("School selected. You may open tools.", false);
        else setStatus("Select a school to continue.", false);
      } else {
        setStatus("You are signed in. Use the buttons below to open each tool.", false);
      }
    }

    if (superAdmin) {
      // Force choose each session unless there is only one school
      try {
        await loadSchoolsForSuperAdmin({ email: me.email, adminId: me.adminId }, applySlug);
      } catch (e) {
        console.warn("[AdminHome] loadSchoolsForSuperAdmin failed", e);
        applySlug("");
      }
    } else {
      const params = new URLSearchParams(window.location.search);
      applySlug((params.get("slug") || "mss-demo").trim());
    }

    // Wire buttons
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

    btnTeacherAdmin?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href = "/admin-teachers/AdminTeachers.html?slug=" + encodeURIComponent(s);
    });

    btnPortal?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href = "/admin/SchoolPortal.html?slug=" + encodeURIComponent(s);
    });

    btnConfig?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href = "/config-admin/ConfigAdmin.html?slug=" + encodeURIComponent(s);
    });

    btnQuestions?.addEventListener("click", () => {
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href = "/questions-admin/WidgetSurvey.html?slug=" + encodeURIComponent(s);
    });

    // Super admin only buttons
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