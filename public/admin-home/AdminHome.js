// /public/admin-home/AdminHome.js
// v1.9 — Unified AdminHome (admin OR teacher) with deterministic slug + navigation
//
// Fixes:
// - Deterministic navigation: ALWAYS preventDefault + ALWAYS append ?slug=
// - Single canonical session/token readers (no duplicates)
// - Teacher_admin (teacher actor with isTeacherAdmin) can access admin-capable tools
// - Teacher (non-admin) gets limited menu
//
// Notes:
// - Admin sessions call /api/admin/me for DB-authoritative flags.
// - Teacher sessions do NOT call /api/admin/me.
// - Slug resolution order:
//   1) URL ?slug=...
//   2) session.slug
//   3) admin fallback (my-schools) / superadmin picker
//   4) QA fallback: "mss-demo" (admin only)

console.log("✅ AdminHome.js loaded (v1.9)");

(function () {
  "use strict";

  // -----------------------------
  // LocalStorage keys
  // -----------------------------
  // Canonical (actor) storage
  const LS_SESSION_KEY = "mssSession";
  const LS_TOKEN_KEY   = "mssActorToken";

  // Legacy (migration-only fallbacks)
  const LEGACY_SESSION_KEYS = ["mssAdminSession", "mss_admin_session"];
  const LEGACY_TOKEN_KEYS   = ["mss_admin_token", "mssAdminToken", "mss_admin_jwt", "mss_admin_access_token"];
  const LS_LEGACY_KEY       = "mss_admin_key"; // x-admin-key fallback

  // -----------------------------
  // URLs
  // -----------------------------
  const LOGIN_URL = "/admin-login/AdminLogin.html";
  const SCHOOL_SIGNUP_URL = "/signup/SchoolSignUp.html";
  const MANAGE_SCHOOLS_URL = "/admin/ManageSchools.html";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  function $(id) { return document.getElementById(id); }

  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  function setVisible(id, on) {
    const el = $(id);
    if (!el) return;
    el.style.display = on ? "inline-flex" : "none";
  }

  function setDisabled(id, disabled) {
    const el = $(id);
    if (!el) return;
    el.disabled = !!disabled;
  }

  function setStatus(msg, isError = false) {
    const el = $("admin-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  // -----------------------------
  // Storage helpers (canonical + migration)
  // -----------------------------
  function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }
  function readLS(k) { try { return localStorage.getItem(k); } catch { return null; } }

  function readSession() {
    // 1) canonical
    const raw = readLS(LS_SESSION_KEY);
    const s1 = raw ? safeJsonParse(raw) : null;
    if (s1) return s1;

    // 2) legacy fallback
    for (const k of LEGACY_SESSION_KEYS) {
      const r = readLS(k);
      const s = r ? safeJsonParse(r) : null;
      if (s) return s;
    }
    return null;
  }

  function writeSession(nextSessionObj) {
    try {
      localStorage.setItem(LS_SESSION_KEY, JSON.stringify(nextSessionObj || {}));
      return true;
    } catch (e) {
      console.warn("[AdminHome] writeSession failed:", e);
      return false;
    }
  }

  function safeWriteSession(patch) {
    const s = readSession() || {};
    const next = { ...s, ...(patch || {}) };
    return writeSession(next);
  }

  function readToken() {
    // 1) canonical
    const t1 = String(readLS(LS_TOKEN_KEY) || "").trim();
    if (t1) return t1;

    // 2) legacy token fallbacks (admin jwt)
    for (const k of LEGACY_TOKEN_KEYS) {
      const t = String(readLS(k) || "").trim();
      if (t) return t;
    }
    return "";
  }

  function readLegacyKey() {
    return String(readLS(LS_LEGACY_KEY) || "").trim();
  }

  // Prefer JWT token; fallback to legacy x-admin-key
  function readAuthArtifact() {
    const token = readToken();
    if (token) return { type: "token", value: token };

    const legacy = readLegacyKey();
    if (legacy) return { type: "legacy", value: legacy };

    return { type: "none", value: "" };
  }

  // Unified fetch that carries either Bearer token OR legacy x-admin-key
  async function adminFetch(url, opts = {}) {
    const auth = readAuthArtifact();
    const headers = new Headers(opts.headers || {});

    if (auth.type === "token") headers.set("Authorization", "Bearer " + auth.value);
    else if (auth.type === "legacy") headers.set("x-admin-key", auth.value);

    return fetch(url, { ...opts, headers, cache: "no-store" });
  }

  async function adminFetchJson(url, opts = {}) {
    const res = await adminFetch(url, opts);
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  // -----------------------------
  // Session type helpers
  // -----------------------------
  function isTeacherSession(session) {
    return (
      session &&
      String(session.actorType || "").toLowerCase() === "teacher" &&
      (session.teacherId != null || session.actorId != null || (session.actor && session.actor.actorId != null))
    );
  }

  function isAdminSession(session) {
    return (
      session &&
      String(session.actorType || "").toLowerCase() === "admin" &&
      (session.adminId != null || session.actorId != null || (session.actor && session.actor.actorId != null))
    );
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  function setSlugPill(slug) {
    const pill = $("admin-school-slug-pill");
    if (!pill) return;
    pill.textContent = "slug: " + (slug || "—");
  }

  function setSuperBadgeVisible(isSuper) {
    const superBadge = $("admin-super-badge");
    if (superBadge) superBadge.style.display = isSuper ? "inline-flex" : "none";
  }

  function populateMeta({ email, idLabel, roleLabel, isSuperadmin }, auth) {
    setText("admin-email", email || "—");
    setText("admin-id", idLabel != null ? String(idLabel) : "—");
    setText("admin-role", roleLabel || (isSuperadmin ? "Super admin" : "Admin"));

    const badge = $("admin-key-badge");
    if (badge) {
      if (auth.type === "token") badge.textContent = "token: present";
      else if (auth.type === "legacy") badge.textContent = "key: present";
      else badge.textContent = "token: none";
    }

    setSuperBadgeVisible(!!isSuperadmin);
  }

  function setSchoolScopedButtonsEnabled(enabled) {
    const ids = ["btn-portal", "teacherAdminBtn", "btn-config", "btn-questions", "btn-student-portal"];
    ids.forEach((id) => setDisabled(id, !enabled));
  }

  // Menu visibility policy:
  // - Teacher (non-admin): Questions + Student Portal
  // - Admin-capable (admin OR teacher_admin): all buttons
  function applyRoleVisibility({ actorType, isTeacherAdmin }) {
    const type = String(actorType || "").toLowerCase();
    const isTeacher = type === "teacher";
    const isAdmin = type === "admin";
    const canUseAdminTools = isAdmin || (isTeacher && !!isTeacherAdmin);

    // hide all
    setVisible("btn-portal", false);
    setVisible("teacherAdminBtn", false);
    setVisible("btn-config", false);
    setVisible("btn-questions", false);
    setVisible("btn-student-portal", false);

    if (isTeacher && !canUseAdminTools) {
      setVisible("btn-questions", true);
      setVisible("btn-student-portal", true);
      return;
    }

    if (canUseAdminTools) {
      setVisible("btn-portal", true);
      setVisible("teacherAdminBtn", true);
      setVisible("btn-config", true);
      setVisible("btn-questions", true);
      setVisible("btn-student-portal", true);
      return;
    }
  }

  function logout() {
    try {
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_LEGACY_KEY);
    } catch (e) {
      console.warn("[AdminHome] Error clearing storage:", e);
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

  // -----------------------------
  // Server: /api/admin/me (admin-only, DB-authoritative)
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
      email: String(a.email || a.admin_email || "").trim().toLowerCase(),
      isSuperadmin: !!(a.is_superadmin || a.isSuperAdmin),
      schoolId: a.school_id ?? null,
      fullName: a.full_name || a.fullName || "",
    };
  }

  // -----------------------------
  // Super Admin school picker
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

      if (schools.length === 1) {
        const only = schools[0] || {};
        const slug = String(only.slug || "").trim();
        wrap.style.display = "none";
        await onSelectSlug(slug);
        return { schools, autoSelected: true };
      }

      const opts =
        '<option value="" selected disabled>— Select a school —</option>' +
        schools
          .map((s) => {
            const slug = String(s.slug || "").trim();
            const name = String(s.name || s.slug || "(Unnamed school)").trim();
            const label = slug && name ? `${name} (${slug})` : name || slug;
            return `<option value="${slug.replace(/"/g, "&quot;")}">${label}</option>`;
          })
          .join("");

      sel.innerHTML = opts;
      sel.disabled = false;

      // Force selection each session
      await onSelectSlug("");
      return { schools, autoSelected: false };
    }

    btnRefresh?.addEventListener("click", async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      try {
        await refresh();
        setStatus("Schools refreshed. Select a school to continue.", false);
      } catch (err) {
        console.warn(err);
        setStatus("Failed to refresh schools.", true);
      }
    });

    sel?.addEventListener("change", async () => {
      const chosen = String(sel.value || "").trim();
      await onSelectSlug(chosen);
    });

    return refresh();
  }

  // -----------------------------
  // AdminHome init
  // -----------------------------
  async function init() {
    const session = readSession();
    const auth = readAuthArtifact();

    const sessionIsAdmin = isAdminSession(session);
    const sessionIsTeacher = isTeacherSession(session);
    const hasIdentity = sessionIsAdmin || sessionIsTeacher;

    if (!session || !session.email || !hasIdentity) {
      logout();
      return;
    }

    if (auth.type === "none") {
      setStatus("Missing token/key. Please log in again.", true);
      logout();
      return;
    }

    // Canonical identity
    let email = String(session.email || "").trim().toLowerCase();

    const actor = session.actor || {};
    const actorType = String(session.actorType || actor.actorType || "").toLowerCase();
    const actorId = Number(session.actorId != null ? session.actorId : actor.actorId) || null;

    let adminId =
      sessionIsAdmin
        ? Number(session.adminId != null ? session.adminId : actor.adminId != null ? actor.adminId : actorId) || null
        : null;

    let teacherId =
      sessionIsTeacher
        ? Number(session.teacherId != null ? session.teacherId : actor.teacherId != null ? actor.teacherId : actorId) || null
        : null;

    const teacherAdminAllowed = !!(session.isTeacherAdmin || actor.isTeacherAdmin || false);

    // Admin-only: fetch authoritative admin flags
    let isSuperadmin = false;

    if (sessionIsAdmin) {
      let me;
      try {
        me = await fetchMe();
      } catch (e) {
        console.warn("[AdminHome] fetchMe failed:", e?.message || e);
        setStatus("Session invalid or expired. Please log in again.", true);
        logout();
        return;
      }

      adminId = me.adminId;
      email = me.email;
      isSuperadmin = !!me.isSuperadmin;

      safeWriteSession({
        actorType: "admin",
        adminId,
        email,
        isSuperadmin,
        isSuperAdmin: isSuperadmin, // legacy alias
      });

      populateMeta(
        { email, idLabel: adminId, roleLabel: isSuperadmin ? "Super admin" : "Admin", isSuperadmin },
        auth
      );
    } else {
      // Teacher session: no /api/admin/me call
      safeWriteSession({
        actorType: "teacher",
        email,
        teacherId,
        isSuperadmin: false,
        isSuperAdmin: false,
        isTeacherAdmin: teacherAdminAllowed,
      });

      populateMeta(
        { email, idLabel: teacherId, roleLabel: teacherAdminAllowed ? "Teacher Admin" : "Teacher", isSuperadmin: false },
        auth
      );
    }

    // -----------------------------
    // Slug context
    // -----------------------------
    let SLUG = "";

    async function applySlug(slug) {
      SLUG = String(slug || "").trim();

      setSlugPill(SLUG);
      setSchoolScopedButtonsEnabled(!!SLUG);

      if (sessionIsTeacher) {
        if (!SLUG) {
          setStatus("Missing school context. Please log in again.", true);
          logout();
          return;
        }

        safeWriteSession({ slug: SLUG });

        if (teacherAdminAllowed) applyRoleVisibility({ actorType: "admin", isTeacherAdmin: true });
        else applyRoleVisibility({ actorType: "teacher", isTeacherAdmin: false });

        setStatus("You are signed in. Use the buttons below.", false);
        return;
      }

      // Admin session
      applyRoleVisibility({ actorType: "admin", isTeacherAdmin: false });

      if (!SLUG) {
        if (isSuperadmin) setStatus("Select a school to continue.", false);
        else setStatus("You are signed in. Use the buttons below to open each tool.", false);
        return;
      }

      safeWriteSession({ slug: SLUG });

      if (isSuperadmin) setStatus("School selected. You may open tools.", false);
      else setStatus("You are signed in. Use the buttons below to open each tool.", false);
    }

    // Determine slug
    const params = new URLSearchParams(window.location.search);
    const urlSlug = String(params.get("slug") || "").trim();
    const sessionSlug = String(session.slug || "").trim();

    if (sessionIsTeacher) {
      await applySlug(urlSlug || sessionSlug);
    } else if (isSuperadmin) {
      try {
        await loadSchoolsForSuperAdmin({ email, adminId }, applySlug);
      } catch (e) {
        console.warn("[AdminHome] loadSchoolsForSuperAdmin failed", e);
        await applySlug("");
      }
    } else {
      // Non-super admin
      if (urlSlug) await applySlug(urlSlug);
      else if (sessionSlug) await applySlug(sessionSlug);
      else {
        // QA fallback for admin-only
        await applySlug("mss-demo");
      }
    }

    // -----------------------------
    // Navigation wiring (DETERMINISTIC)
    // -----------------------------
    const btnPortal = $("btn-portal");
    const btnTeacherAdmin = $("teacherAdminBtn");
    const btnConfig = $("btn-config");
    const btnQuestions = $("btn-questions");
    const btnStudentPortal = $("btn-student-portal");

    const btnInviteSchoolSignup = $("btn-invite-school-signup");
    const btnManageSchools = $("btn-manage-schools");
    const btnSchoolSignup = $("btn-school-signup");
    const btnLogout = $("btn-logout");

    function isTeacherBlockedFromAdminTools() {
      return sessionIsTeacher && !teacherAdminAllowed;
    }

    function requireSlugOrWarn() {
      if (!SLUG) {
        setStatus("Please select a school first.", true);
        return null;
      }
      return SLUG;
    }

    function navTo(path, e) {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (isTeacherBlockedFromAdminTools()) return;

      const s = requireSlugOrWarn();
      if (!s) return;

      const u = new URL(path, window.location.origin);
      u.searchParams.set("slug", s);
      window.location.href = u.pathname + "?" + u.searchParams.toString();
    }

    btnTeacherAdmin?.addEventListener("click", (e) => navTo("/admin-teachers/AdminTeachers.html", e));
    btnPortal?.addEventListener("click", (e) => navTo("/admin/SchoolPortal.html", e));
    btnConfig?.addEventListener("click", (e) => navTo("/config-admin/ConfigAdmin.html", e));

    // Questions is allowed for teacher too
    btnQuestions?.addEventListener("click", (e) => {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      const s = requireSlugOrWarn();
      if (!s) return;
      window.location.href = "/questions-admin/WidgetSurvey.html?slug=" + encodeURIComponent(s);
    });

    btnStudentPortal?.addEventListener("click", (e) => navTo("/admin/StudentPortal.html", e));

    // Super-admin-only buttons
    if (btnInviteSchoolSignup) {
      btnInviteSchoolSignup.style.display = isSuperadmin ? "inline-flex" : "none";
      if (isSuperadmin) {
        btnInviteSchoolSignup.addEventListener("click", (e) => {
          if (e && e.preventDefault) e.preventDefault();
          openInViewer("Invite School Sign-up", "/admin-invite/InviteSchoolSignup.html");
        });
      }
    }

    if (btnManageSchools) {
      btnManageSchools.style.display = isSuperadmin ? "inline-flex" : "none";
      if (isSuperadmin) {
        btnManageSchools.addEventListener("click", (e) => {
          if (e && e.preventDefault) e.preventDefault();
          openInViewer("Manage Schools", MANAGE_SCHOOLS_URL);
        });
      }
    }

    if (btnSchoolSignup) {
      btnSchoolSignup.style.display = isSuperadmin ? "inline-flex" : "none";
      if (isSuperadmin) {
        btnSchoolSignup.addEventListener("click", (e) => {
          if (e && e.preventDefault) e.preventDefault();
          openInViewer("School Sign Up", SCHOOL_SIGNUP_URL);
        });
      }
    }

    btnLogout?.addEventListener("click", (e) => {
      if (e && e.preventDefault) e.preventDefault();
      logout();
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => {
      console.error("[AdminHome] init failed", e);
      setStatus("Error loading Admin Home.", true);
    });
  });
})();