/* /public/js/mss_client.js — PROD CANDIDATE (Set & Forget) — v20260121_prod3
 *
 * Goals:
 * - Single canonical auth/session/token store
 * - Deterministic redirect diagnostics
 * - One canonical fetch wrapper (Bearer + optional slug injection)
 * - One compatibility shim for legacy pages (requireAdminSession/adminHeaders)
 * - Peer-reviewable, stable, minimal surface area
 */
(function () {
  "use strict";

  // ============================================================
  // Constants
  // ============================================================

  // Canonical storage keys
  const LS_SESSION = "mssSession";
  const LS_TOKEN = "mssActorToken";

  // Back-compat bridge (temporary during migration)
  const LS_LEGACY_ADMIN_TOKEN_KEYS = ["mss_admin_token", "mssAdminToken", "mss_admin_jwt"];
  const LS_LEGACY_ADMIN_SESSION_KEYS = ["mssAdminSession", "mss_admin_session"];

  // Diagnostics keys (sticky; not cleared by default)
  const LS_LAST_REDIRECT_DIAG = "mssLastRedirectDiag";
  const LS_LAST_API_DIAG = "mssLastApiDiag";
  const LS_LAST_GLOBAL_ERROR = "mssLastGlobalErrorDiag";

  // QA toggle: localStorage mssQaMode="1" OR URL ?qa=1 OR window.MSS_QA=true
  const LS_QA_MODE = "mssQaMode";

  // Login URL
  const LOGIN_URL = "/admin-login/AdminLogin.html";

  // ============================================================
  // LocalStorage helpers
  // ============================================================

  function readLS(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  }

  function writeLS(k, v) {
    try { localStorage.setItem(k, v); } catch (_) {}
  }

  function removeLS(k) {
    try { localStorage.removeItem(k); } catch (_) {}
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  // ============================================================
  // Basic utilities
  // ============================================================

  function nowIso() {
    try { return new Date().toISOString(); } catch { return ""; }
  }

  function isQaMode() {
    try {
      if (window.MSS_QA === true) return true;
      if (String(readLS(LS_QA_MODE) || "") === "1") return true;
      const sp = new URLSearchParams(location.search);
      return sp.get("qa") === "1";
    } catch {
      return false;
    }
  }

  function getSlugFromUrl() {
    try {
      return String(new URLSearchParams(location.search).get("slug") || "").trim() || null;
    } catch {
      return null;
    }
  }

  async function tryCopy(text) {
    // Best-effort only; often blocked without a user gesture.
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(String(text || ""));
        return true;
      }
    } catch (_) {}
    return false;
  }

  // ============================================================
  // Session + token (canonical)
  // ============================================================

  function readSession() {
    const raw = readLS(LS_SESSION);
    return raw ? safeJsonParse(raw) : null;
  }

  function readToken() {
    return String(readLS(LS_TOKEN) || "").trim() || "";
  }

  function clearAllAuthStorage() {
    removeLS(LS_SESSION);
    removeLS(LS_TOKEN);
    // NOTE: diagnostics are intentionally sticky; do not clear automatically
  }

  function summarizeSession(sess) {
    if (!sess || typeof sess !== "object") return null;
    const actor = (sess.actor && typeof sess.actor === "object") ? sess.actor : null;
    return {
      actorType: (sess.actorType || actor?.actorType || null),
      actorId: (sess.actorId ?? actor?.actorId ?? null),
      email: (sess.email || actor?.email || null),
      slug: (sess.slug || actor?.slug || null),
      schoolId: (sess.schoolId ?? actor?.schoolId ?? null),
      isTeacherAdmin: !!(sess.isTeacherAdmin ?? actor?.isTeacherAdmin),
      isSuperAdmin: !!(sess.isSuperAdmin ?? actor?.isSuperAdmin),
    };
  }

  // ============================================================
  // Diagnostics
  // ============================================================

  function buildDiag(kind, reason, extra) {
    const session = readSession();
    const token = readToken();

    return {
      kind: String(kind || "mss_diag"),
      at: nowIso(),
      reason: reason != null ? String(reason) : null,
      href: String(location.href || ""),
      origin: String(location.origin || ""),
      pathname: String(location.pathname || ""),
      slug_url: getSlugFromUrl(),
      slug_session: session ? (String(session.slug || session.actor?.slug || "").trim() || null) : null,
      token_present: !!token,
      token_prefix: token ? token.slice(0, 16) : null,
      session_present: !!session,
      session: summarizeSession(session),
      extra: (extra && typeof extra === "object") ? extra : null,
      trace: (window.__MSS_CLIENT_TRACE__ && typeof window.__MSS_CLIENT_TRACE__ === "object")
        ? window.__MSS_CLIENT_TRACE__
        : null,
    };
  }

  function persistDiag(key, obj) {
    try { writeLS(key, JSON.stringify(obj, null, 2)); } catch (_) {}
  }

  function readDiag(key) {
    const raw = String(readLS(key) || "").trim();
    return raw || null;
  }

  function readDiagJson(key) {
    const raw = readDiag(key);
    return raw ? safeJsonParse(raw) : null;
  }

  function clearDiag(key) {
    removeLS(key);
  }

  // ============================================================
  // Proof-of-life trace (safe, lightweight)
  // ============================================================

  try {
    window.__MSS_CLIENT_TRACE__ = { loadedAt: nowIso(), href: String(location.href || "") };
    // Keep as console.log (not error) so it doesn't look like a failure
    console.log("MSSClient loaded", window.__MSS_CLIENT_TRACE__);
  } catch (_) {}

  // ============================================================
  // Deterministic redirect
  // ============================================================

  function redirectToLogin(reason, extra = null, opts = {}) {
    const o = (opts && typeof opts === "object") ? opts : {};
    const clearAuth = o.clearAuth !== false; // default true

    // 1) Build diag FIRST (before clearing)
    const diag = buildDiag("mss_redirect_diag", reason, extra);
    const json = JSON.stringify(diag, null, 2);

    // 2) Persist + log always (deterministic)
    writeLS(LS_LAST_REDIRECT_DIAG, json);
    try { console.error("[MSSClient] redirectToLogin", reason, diag); } catch (_) {}

    // 3) QA mode: block navigation and show JSON
    if (isQaMode()) {
      tryCopy(json).catch(() => {});
      try { alert(json); } catch (_) {}
      // debugger;
    }

    // 4) Clear auth LAST
    if (clearAuth) clearAllAuthStorage();

    // 5) Navigate
    try {
      const u = new URL(LOGIN_URL, location.origin);
      if (reason) u.searchParams.set("reason", String(reason));
      location.href = u.pathname + u.search;
    } catch {
      location.href = LOGIN_URL;
    }
  }

  // ============================================================
  // URL helpers (slug injection)
  // ============================================================

  function withSlug(url, slug) {
    const s = String(slug || "").trim();
    if (!s) return String(url || "");

    try {
      const u = new URL(String(url || ""), location.origin);
      if (u.origin !== location.origin) return String(url || "");
      if (u.searchParams.has("slug")) return u.pathname + u.search;
      u.searchParams.set("slug", s);
      return u.pathname + u.search;
    } catch {
      const raw = String(url || "");
      if (raw.includes("slug=")) return raw;
      const sep = raw.includes("?") ? "&" : "?";
      return raw + sep + "slug=" + encodeURIComponent(s);
    }
  }

  function getSlugForRequests() {
    // Session first (authoritative), then URL.
    try {
      const s = readSession();
      const slug = String(s?.slug || s?.actor?.slug || "").trim();
      if (slug) return slug;
    } catch (_) {}
    return getSlugFromUrl();
  }

  // ============================================================
  // Canonical apiFetch (Bearer + diagnostics + optional slug)
  // ============================================================

  async function apiFetch(url, opts) {
    const o = (opts && typeof opts === "object") ? opts : {};
    const ensureSlug = o.ensureSlug === true;

    const token = readToken();
    if (!token) {
      redirectToLogin("missing_token", { url: String(url || ""), ensureSlug }, { clearAuth: true });
      throw new Error("missing_token");
    }

    const slug = ensureSlug ? getSlugForRequests() : null;
    const finalUrl = (ensureSlug && slug) ? withSlug(url, slug) : String(url || "");

    const headers = new Headers(o.headers || {});
    headers.set("Authorization", "Bearer " + token);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    // If caller supplies body and didn't supply Content-Type, assume JSON.
    if (o.body != null && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const { ensureSlug: _drop, ...rest } = o;

    let res;
    try {
      res = await fetch(finalUrl, { ...rest, headers, cache: rest.cache || "no-store" });
    } catch (err) {
      const diag = buildDiag("mss_api_diag", "network_error", {
        url: finalUrl,
        method: rest.method || "GET",
        message: String(err?.message || err || ""),
      });
      persistDiag(LS_LAST_API_DIAG, diag);
      try { console.error("[MSSClient] apiFetch network_error", diag); } catch (_) {}
      throw err;
    }

    // 401 => deterministic redirect
    if (res.status === 401) {
      redirectToLogin(
        "unauthorized",
        { url: finalUrl, method: rest.method || "GET", status: 401 },
        { clearAuth: true }
      );
      throw new Error("unauthorized");
    }

    // Other errors: capture body but do not redirect
    if (!res.ok) {
      let bodyText = null;
      let bodyJson = null;
      try {
        const ct = String(res.headers.get("content-type") || "");
        if (ct.includes("application/json")) bodyJson = await res.clone().json();
        else bodyText = await res.clone().text();
      } catch (_) {}

      const diag = buildDiag("mss_api_diag", "http_error", {
        url: finalUrl,
        method: rest.method || "GET",
        status: res.status,
        statusText: res.statusText,
        bodyJson,
        bodyText,
      });
      persistDiag(LS_LAST_API_DIAG, diag);
      try { console.error("[MSSClient] apiFetch http_error", diag); } catch (_) {}
    }

    return res;
  }

  // ============================================================
  // Session persistence (+ legacy bridge)
  // ============================================================

  function setSession(args) {
    const token = String(args?.token || "").trim();
    const session = args?.session;

    if (!token || !session) return null;

    writeLS(LS_TOKEN, token);
    try { writeLS(LS_SESSION, JSON.stringify(session)); } catch (_) { writeLS(LS_SESSION, "{}"); }

    // Temporary back-compat: keep older pages running during migration
    try {
      for (const k of LS_LEGACY_ADMIN_TOKEN_KEYS) writeLS(k, token);
      for (const k of LS_LEGACY_ADMIN_SESSION_KEYS) writeLS(k, JSON.stringify(session));
    } catch (_) {}

    return { token, session };
  }

  // ============================================================
  // Login
  // ============================================================

  async function login(args) {
    const email = String(args?.email || "").trim().toLowerCase();
    const password = String(args?.password || "");
    const slug = args?.slug != null ? String(args.slug).trim() : null;

    if (!email || !password) {
      return { ok: false, error: "missing_credentials", message: "Email and password are required." };
    }

    // Clean slate for deterministic login
    clearAllAuthStorage();

    const payload = { email, password };
    if (slug) payload.slug = slug;

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (data && data.ok === false && data.error === "needs_school_selection") {
      return {
        ok: false,
        error: "needs_school_selection",
        schools: data.schools || [],
        message: data.message || "",
      };
    }

    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        error: data.error || ("http_" + res.status),
        message: data.message || "Login failed.",
      };
    }

    const token = String(data.token || data.jwt || data.accessToken || data.access_token || "").trim();
    const actor = data.actor || null;
    if (!token || !actor) return { ok: false, error: "bad_login_response", message: "Missing token/actor." };

    const session = {
      actorType: actor.actorType || actor.actor_type || null,
      actorId: actor.actorId || actor.actor_id || null,
      email: actor.email || null,
      slug: actor.slug || actor.school_slug || actor.schoolSlug || null,
      schoolId: (actor.schoolId ?? actor.school_id ?? null),
      isSuperAdmin: !!(actor.isSuperAdmin || actor.is_superadmin),
      isTeacherAdmin: !!(actor.isTeacherAdmin || actor.is_teacher_admin),
      actor,
    };

    const persisted = setSession({ token, session });
    if (!persisted) return { ok: false, error: "storage_failed", message: "Could not persist auth." };

    return { ok: true, token, session };
  }

  // ============================================================
  // bootGuard (page-level guard + convenience bundle)
  // ============================================================

  function bootGuard(opts) {
    const o = (opts && typeof opts === "object") ? opts : {};

    const session = readSession();
    const token = readToken();

    if (!session || !token) {
      redirectToLogin(
        "missing_session_or_token",
        { haveSession: !!session, haveToken: !!token },
        { clearAuth: true }
      );
      throw new Error("missing_session_or_token");
    }

    let slug = getSlugFromUrl();
    if (!slug) slug = String(session.slug || "").trim() || null;
    if (!slug) slug = String(session.actor?.slug || "").trim() || null;

    const actorType = String(session.actorType || "").trim().toLowerCase();

    if (Array.isArray(o.allow) && o.allow.length) {
      const allow = o.allow.map(x => String(x).trim().toLowerCase());
      if (!actorType || !allow.includes(actorType)) {
        redirectToLogin("forbidden_actor", { actorType, allow }, { clearAuth: false });
        throw new Error("forbidden_actor");
      }
    }

    if (o.requireTeacherAdmin === true) {
      const isAdmin = actorType === "admin";
      const isTeacherAdmin = !!session.isTeacherAdmin;
      if (!isAdmin && !isTeacherAdmin) {
        redirectToLogin("teacher_admin_required", { actorType, isTeacherAdmin }, { clearAuth: false });
        throw new Error("teacher_admin_required");
      }
    }

    if (o.requireSlug === true && !slug) {
      redirectToLogin("missing_slug", { actorType }, { clearAuth: false });
      throw new Error("missing_slug");
    }

    return { session, token, slug, apiFetch };
  }

  // ============================================================
  // Global error capture (sticky diagnostics)
  // ============================================================

  try {
    window.addEventListener("error", function (evt) {
      const diag = buildDiag("mss_global_error", "window_error", {
        message: String(evt?.message || ""),
        filename: String(evt?.filename || ""),
        lineno: evt?.lineno ?? null,
        colno: evt?.colno ?? null,
      });
      persistDiag(LS_LAST_GLOBAL_ERROR, diag);
      try { console.error("[MSSClient] window_error", diag); } catch (_) {}
    });

    window.addEventListener("unhandledrejection", function (evt) {
      const reason = evt?.reason;
      const diag = buildDiag("mss_global_error", "unhandledrejection", {
        message: String(reason?.message || reason || ""),
        stack: String(reason?.stack || ""),
      });
      persistDiag(LS_LAST_GLOBAL_ERROR, diag);
      try { console.error("[MSSClient] unhandledrejection", diag); } catch (_) {}
    });
  } catch (_) {}

  // ============================================================
  // Export (single authoritative object)
  // ============================================================

  window.MSSClient = {
    // auth/session
    login,
    setSession,
    readSession,
    readToken,
    clearAllAuthStorage,

    // guards + fetch
    bootGuard,
    apiFetch,

    // redirect
    redirectToLogin,

    // diags (raw + parsed)
    readLastRedirectDiag: function () { return readDiag(LS_LAST_REDIRECT_DIAG); },
    readLastRedirectDiagJson: function () { return readDiagJson(LS_LAST_REDIRECT_DIAG); },
    clearLastRedirectDiag: function () { clearDiag(LS_LAST_REDIRECT_DIAG); },

    readLastApiDiag: function () { return readDiag(LS_LAST_API_DIAG); },
    readLastApiDiagJson: function () { return readDiagJson(LS_LAST_API_DIAG); },
    clearLastApiDiag: function () { clearDiag(LS_LAST_API_DIAG); },

    readLastGlobalErrorDiag: function () { return readDiag(LS_LAST_GLOBAL_ERROR); },
    readLastGlobalErrorDiagJson: function () { return readDiagJson(LS_LAST_GLOBAL_ERROR); },
    clearLastGlobalErrorDiag: function () { clearDiag(LS_LAST_GLOBAL_ERROR); },
  };

  // ============================================================
  // Legacy global shims (ConfigAdmin + older admin pages)
  // - Provides: window.requireAdminSession(), window.adminHeaders()
  // - Deterministic: uses MSSClient.redirectToLogin() for redirects
  // ============================================================

(function attachLegacyGlobals() {
  if (!window.MSSClient) return;

  // Only define if missing (do NOT overwrite)
  if (typeof window.requireAdminSession !== "function") {
    window.requireAdminSession = function requireAdminSession(opts = {}) {
      const session = window.MSSClient.readSession();
      const actorType = String(session?.actorType || session?.actor?.actorType || "").toLowerCase();
      const isSuperAdmin = !!(session?.isSuperAdmin || session?.actor?.isSuperAdmin);

      if (actorType !== "admin") {
        window.MSSClient.redirectToLogin("admin_required", { actorType }, { clearAuth: false });
        throw new Error("admin_required");
      }
      if (opts.allowSuperAdmin === false && isSuperAdmin) {
        window.MSSClient.redirectToLogin("superadmin_not_allowed", { actorType, isSuperAdmin }, { clearAuth: false });
        throw new Error("superadmin_not_allowed");
      }
      return session;
    };
  }
  // ============================================================
  // Legacy compatibility shim (GLOBAL exports)
  // ============================================================

  function readLegacyAdminSession() {
    // 1) Prefer canonical session (new)
    const s = readSession();
    if (s && typeof s === "object") return s;

    // 2) Fall back to legacy admin session keys
    for (let i = 0; i < LS_LEGACY_ADMIN_SESSION_KEYS.length; i++) {
      const raw = readLS(LS_LEGACY_ADMIN_SESSION_KEYS[i]);
      const legacy = raw ? safeJsonParse(raw) : null;
      if (legacy && typeof legacy === "object") return legacy;
    }
    return null;
  }

  function readAnyToken() {
    // 1) Canonical token
    const t = readToken();
    if (t) return t;

    // 2) Legacy token keys
    for (let i = 0; i < LS_LEGACY_ADMIN_TOKEN_KEYS.length; i++) {
      const raw = String(readLS(LS_LEGACY_ADMIN_TOKEN_KEYS[i]) || "").trim();
      if (raw) return raw;
    }

    // 3) Sometimes legacy session stored a token
    const s = readLegacyAdminSession();
    const st = String(
      s?.token || s?.jwt || s?.accessToken || s?.access_token || s?.admin_jwt || s?.adminJwt || ""
    ).trim();
    return st || "";
  }

  function requireAdminSession(reason) {
    const sess = readLegacyAdminSession();
    const email = String(sess?.email || "").trim();
    const tok = readAnyToken();

    // minimal “admin presence” gate
    if (email && tok) return sess;

    const msg = reason || "Your admin session has ended. Please sign in again.";
    try { console.warn("[MSSClient] requireAdminSession failed:", { email: !!email, tok: !!tok }); } catch (_) {}

    // keep diagnostics sticky (your design intent)
    writeLS(LS_LAST_GLOBAL_ERROR, JSON.stringify({
      kind: "mss_require_admin_session_failed",
      at: nowIso(),
      reason: msg,
      href: String(location.href || ""),
      email_present: !!email,
      token_present: !!tok,
      session_summary: summarizeSession(sess),
    }));

    // redirect
    try { location.href = LOGIN_URL; } catch (_) {}
    throw new Error("requireAdminSession_failed");
  }

  function adminHeaders(extra) {
    const tok = readAnyToken();
    const h = Object.assign({}, extra || {});
    if (tok && !h.Authorization && !h.authorization) h.Authorization = "Bearer " + tok;
    return h;
  }

  // EXPOSE GLOBALS (critical)
  window.requireAdminSession = requireAdminSession;
  window.adminHeaders = adminHeaders;

  // Optional: expose canonical readers for debugging
  window.mssReadSession = readSession;
  window.mssReadToken = readToken;
  window.mssReadAnyToken = readAnyToken;
  if (typeof window.adminHeaders !== "function") {
    window.adminHeaders = function adminHeaders(extra = {}) {
      const token = window.MSSClient.readToken();
      return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(extra && typeof extra === "object" ? extra : {}),
      };
    };
  }
})();
})();