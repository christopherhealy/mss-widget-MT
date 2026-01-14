// /admin/SchoolPortal.js — v0.21 Portal logic, Build: 2025-12-10
// - Auth via mss_admin_key + /api/admin/session
// - Multi-school support via /api/admin/my-schools
// - Superadmin vs normal admin enforced server-side
// - Uses /api/admin/reports/:slug (view-backed) for Test Results
// - Uses /api/list-dashboards to list dashboards for DashboardViewer
// - Admin logout via #portal-logout and clearing admin key + legacy sessions

console.log("✅ SchoolPortal.js loaded");

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // Auth + config
  // -----------------------------------------------------------------------

const ADMIN_API_BASE = ""; // same origin
const ADMIN_LOGIN_URL = "/admin-login/AdminLogin.html";
const ADMIN_KEY_STORAGE = "mss_admin_key";
const ADMIN_HOME_URL = "/admin-home/AdminHome.html";

// Simple ID helper
const $ = (id) => document.getElementById(id);

// These get filled after we load the session
let ADMIN_SESSION = null;
let ADMIN_EMAIL = null;
let ADMIN_ID = null;
let ADMIN_KEY = null;

function maskKey(key) {
  if (!key) return "—";
  const s = String(key);
  if (s.length <= 8) return "****";
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function getAdminKey() {
  try {
    // 1) Prefer URL param if present (supports new tabs / deep links)
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("adminKey") || params.get("adminkey");
    if (fromUrl && String(fromUrl).trim()) {
      const k = String(fromUrl).trim();
      // Persist for subsequent calls
      window.localStorage.setItem(ADMIN_KEY_STORAGE, k);
      console.log("[SchoolPortal] getAdminKey → (from URL)", maskKey(k));
      return k;
    }

    // 2) Fall back to localStorage
    const key = window.localStorage.getItem(ADMIN_KEY_STORAGE);
    console.log("[SchoolPortal] getAdminKey → (from LS)", maskKey(key));
    return key;
  } catch (e) {
    console.warn("[SchoolPortal] getAdminKey error:", e);
    return null;
  }
}
// Dec 16 — upgraded to allow Cancel + revert school selector cleanly
function confirmSchoolChange(nextLabel) {
  return new Promise((resolve) => {
    let overlay = document.getElementById("mss-school-switch-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "mss-school-switch-overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(15,23,42,0.55)";
      overlay.style.display = "none";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.zIndex = "9999";
      overlay.style.padding = "16px";

      overlay.innerHTML = `
        <div style="
          width: min(560px, 100%);
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
          overflow: hidden;
          font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        ">
          <div style="padding:16px 18px; border-bottom: 1px solid #e2e8f0;">
            <div style="font-size:16px; font-weight:700; color:#0f172a;">
              Change schools?
            </div>
            <div id="mss-school-switch-body" style="margin-top:6px; font-size:13px; color:#64748b; line-height:1.35;">
              You are about to change schools.
            </div>
          </div>

          <div style="padding:16px 18px; display:flex; gap:10px; justify-content:flex-end;">
            <button id="mss-school-switch-cancel" style="
              padding:10px 14px;
              border-radius: 10px;
              border: 1px solid #cbd5e1;
              background: #fff;
              color: #0f172a;
              font-weight: 600;
              cursor: pointer;
            ">Cancel</button>

            <button id="mss-school-switch-ok" style="
              padding:10px 14px;
              border-radius: 10px;
              border: none;
              background: #1d4ed8;
              color: #fff;
              font-weight: 700;
              cursor: pointer;
            ">Continue</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
    }

    // Prevent re-entrancy (double-open)
    if (overlay.dataset.busy === "1") {
      console.warn("[SchoolPortal] confirmSchoolChange: overlay already open");
      return;
    }
    overlay.dataset.busy = "1";
    overlay.dataset.choice = ""; // clear stale value

    const body = overlay.querySelector("#mss-school-switch-body");
    const btnOk = overlay.querySelector("#mss-school-switch-ok");
    const btnCancel = overlay.querySelector("#mss-school-switch-cancel");

    if (!body || !btnOk || !btnCancel) {
      overlay.dataset.busy = "0";
      const ok = window.confirm(
        `You are changing schools${nextLabel ? " to:\n\n" + nextLabel : ""}\n\nPress OK to continue, or Cancel to stay on the current school.`
      );
      resolve(!!ok);
      return;
    }

    body.innerHTML = `
      <p style="margin:0;">You are changing schools${nextLabel ? " to:" : "."}</p>
      ${nextLabel ? `<p style="margin:8px 0 0; font-weight:700; color:#0f172a;">${String(nextLabel)}</p>` : ""}
      <p style="margin:10px 0 0;">
        Press <b>Continue</b> to proceed, or <b>Cancel</b> to stay on the current school.
      </p>
    `;

    const cleanup = () => {
      overlay.style.display = "none";
      overlay.dataset.busy = "0";
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
    };

    const onOk = () => {
      overlay.dataset.choice = "ok";
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      overlay.dataset.choice = "cancel";
      cleanup();
      resolve(false);
    };

    const onBackdrop = (e) => {
      if (e.target === overlay) onCancel();
    };

    const onKey = (e) => {
      if (e.key === "Escape") return onCancel();
      if (e.key === "Enter") return onOk();
    };

    overlay.style.display = "flex";
    btnOk.addEventListener("click", onOk);
    btnCancel.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

// ---------------------------------------------------------------------
// Admin auth helpers (JWT first-class; legacy key kept separate)
// ---------------------------------------------------------------------

const LS_TOKEN_KEY   = "mss_admin_token";   // JWT
const LS_LEGACY_KEY  = "mss_admin_key";     // legacy (NOT a JWT)
const LS_SESSION_KEY = "mssAdminSession";   // session object (may contain token)

// Returns JWT token only (or null)
function getAdminJwtToken() {
  // Canonical
  let t = String(localStorage.getItem("mss_admin_token") || "").trim();
  if (t) return t;

  // Back-compat uppercase (common drift)
  t = String(localStorage.getItem("MSS_ADMIN_TOKEN") || "").trim();
  if (t) {
    try { localStorage.setItem("mss_admin_token", t); } catch {}
    return t;
  }

  // Session object fallbacks
  try {
    const raw = localStorage.getItem("mssAdminSession");
    const s = raw ? JSON.parse(raw) : null;
    const candidate = String(
      s?.token || s?.jwt || s?.accessToken || s?.mss_admin_token || s?.mss_admin_token || ""
    ).trim();
    if (candidate && candidate.split(".").length === 3) {
      try { localStorage.setItem("mss_admin_token", candidate); } catch {}
      return candidate;
    }
  } catch (_) {}

  return null;
}

// Returns legacy admin key (or null) — never used as Bearer
function getLegacyAdminKey() {
  const k = String(localStorage.getItem(LS_LEGACY_KEY) || "").trim();
  return k || null;
}

/**
 * adminFetch
 * - Attaches Bearer JWT
 * - Redirects to login ONLY on 401
 * - Throws structured errors for 403+other non-OK, so caller can show UI messages
 */
async function adminFetch(url, opts = {}) {
  const token = getAdminJwtToken();
  const legacyKey = getLegacyAdminKey(); // keep if you still need it for old endpoints

  const callerHeaders = opts.headers || {};
  const headers = new Headers(callerHeaders);

  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  // JWT Bearer only
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // OPTIONAL legacy key (only if some endpoints still require it)
  // If not needed, delete the next line entirely.
  // if (legacyKey) headers.set("x-admin-key", legacyKey);

  // QA logging — include first 12 chars so you can confirm which path is used
  try {
    console.log("[adminFetch]", opts.method || "GET", url, {
      hasJwt: !!token,
      jwtPrefix: token ? token.slice(0, 12) : null,
      hasLegacyKey: !!legacyKey,
      hasAuthHeader: headers.has("Authorization"),
    });
  } catch (_) {}

  let res;
  try {
    res = await fetch(url, { ...opts, headers, cache: opts.cache || "no-store" });
  } catch (err) {
    const e = new Error("network_error");
    e.status = 0;
    e.cause = err;
    throw e;
  }

  // ---- AUTH handling policy ----
  // 401 = not authenticated / expired token => go to login
  if (res.status === 401) {
    // Clear storage to prevent loops
    try {
      localStorage.removeItem(LS_TOKEN_KEY);
      localStorage.removeItem(LS_SESSION_KEY);
      localStorage.removeItem(LS_LEGACY_KEY);
    } catch (_) {}

    // IMPORTANT: use your real login route
    window.location.href = "/admin-login/AdminLogin.html";
    throw new Error("unauthorized");
  }

  // Non-OK responses: try to parse JSON body for { error, message }
  if (!res.ok) {
    let body = {};
    try {
      body = await res.clone().json();
    } catch (_) {}

    const errCode = String(body.error || ("http_" + res.status));
    const msg = String(body.message || body.error || res.statusText || "Request failed");

    const e = new Error(msg);
    e.status = res.status;
    e.error = errCode;
    e.body = body;

    // 403 = authenticated but not permitted (do NOT redirect)
    // Caller should catch and show a permission message
    throw e;
  }

  return res;
}

// ---------------------------------
// AI Prompts loader (permission-aware)
// ---------------------------------
async function loadAiPrompts(slug) {
  try {
    const res = await adminFetch(
      `/api/admin/ai-prompts/${encodeURIComponent(slug)}`
    );
    const data = await res.json().catch(() => ({}));
    return data.prompts || [];
  } catch (e) {
    if (e && e.status === 403) {
      // Admin is authenticated but not permitted
      setStatus(
        "You are signed in, but you do not have permission to access AI prompts.",
        true
      );

      // IMPORTANT: do NOT redirect
      disableGenerateReportUi(true); // hide or disable Generate Report
      return [];
    }

    setStatus(
      "Failed to load AI prompts: " + (e.message || "error"),
      true
    );
    return [];
  }
}

// Keep this for debugging only (not used by adminFetch now)
function getLegacySession() {
  try {
    const raw = window.localStorage.getItem(LS_SESSION_KEY);
    console.log("[SchoolPortal] raw mssAdminSession:", raw);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    console.log("[SchoolPortal] parsed mssAdminSession:", parsed);
    return parsed;
  } catch (e) {
    console.warn("[SchoolPortal] Failed to read/parse mssAdminSession:", e);
    return null;
  }
}

// FIX: your actual AdminHome path (based on your latest AdminHome.js location)
const DEFAULT_ADMIN_HOME_URL = "/admin-home/AdminHome.html";
 // -----------------------------------------------------------------------
  // Query params
  // -----------------------------------------------------------------------

  const params = new URLSearchParams(window.location.search);
  let INITIAL_SLUG = params.get("slug");
  const ASSESSMENT_ID_FROM_URL = params.get("assessmentId");

  // -----------------------------------------------------------------------
  // Admin Home navigation helper
  // -----------------------------------------------------------------------

  function buildAdminHomeUrl() {
    let base = ADMIN_HOME_URL;

    try {
      const url = new URL(base, window.location.origin);

      // Prefer adminKey from URL, else from localStorage
      const params = new URLSearchParams(window.location.search);
      const adminKey =
        params.get("adminKey") ||
        window.localStorage.getItem(ADMIN_KEY_STORAGE);

      if (adminKey) {
        url.searchParams.set("adminKey", adminKey);
      }

      return url.pathname + url.search;
    } catch (e) {
      console.warn("[SchoolPortal] buildAdminHomeUrl failed:", e);
      return ADMIN_HOME_URL;
    }
  }

function returnToAdminHome() {
    try {
      // If opened from AdminHome via window.open()
      if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close(); // only works if script-opened
        return;
      }
    } catch (e) {
      // ignore cross-window issues
    }

    // Fallback: navigate in same tab
    window.location.href = buildAdminHomeUrl();
  }

async function ensureSlugFromSingleSchoolOrThrow() {
  // If URL already has slug (or already set), we're done
  if ((INITIAL_SLUG && String(INITIAL_SLUG).trim()) || (CURRENT_SLUG && String(CURRENT_SLUG).trim())) {
    return;
  }

  // Must have a loaded session at this point
  if (!ADMIN_SESSION || !ADMIN_EMAIL || !ADMIN_ID) {
    throw new Error("No admin session available to infer slug.");
  }

  const qs = new URLSearchParams();
  if (ADMIN_EMAIL) qs.set("email", ADMIN_EMAIL);
  if (ADMIN_ID != null) qs.set("adminId", String(ADMIN_ID));

  const url = "/api/admin/my-schools" + (qs.toString() ? "?" + qs.toString() : "");
  const res = await adminFetch(url, { method: "GET" });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error("my-schools failed");
  }

  const schools = Array.isArray(data.schools) ? data.schools : [];
  if (schools.length === 1 && schools[0].slug) {
    const inferred = String(schools[0].slug);

    INITIAL_SLUG = inferred;
    CURRENT_SLUG = inferred;

    try {
      const u = new URL(window.location.href);
      u.searchParams.set("slug", inferred);
      window.history.replaceState({}, "", u.toString());
    } catch (_) {}

    return;
  }

  throw new Error("No slug provided and cannot infer a single school.");
}

 function clearAdminSessionAndRedirect() {
  try {
    localStorage.removeItem("mss_admin_token");
    localStorage.removeItem("MSS_ADMIN_TOKEN");
    localStorage.removeItem("mssAdminSession");
    localStorage.removeItem("MSS_ADMIN_SESSION");
    localStorage.removeItem("MSS_ADMIN_SESSION_V2");
    localStorage.removeItem("mss_admin_key");
    localStorage.removeItem("MSS_ADMIN_EMAIL");
  } catch (e) {
    console.warn("[SchoolPortal] Error clearing admin session", e);
  }
  window.location.href = ADMIN_LOGIN_URL;
}

 // ✅ New: load admin session directly from localStorage.mssAdminSession
async function loadAdminSession() {
  const legacy = getLegacySession(); // reads mssAdminSession

  // If adminKey is stored in session, persist it
if (!ADMIN_KEY && legacy && legacy.adminKey) {
  try {
    window.localStorage.setItem(ADMIN_KEY_STORAGE, String(legacy.adminKey));
    ADMIN_KEY = String(legacy.adminKey);
  } catch {}
}
 

  if (!legacy) {
    console.warn("[SchoolPortal] No mssAdminSession – redirecting to login");
    clearAdminSessionAndRedirect();
    return null;
  }

  const adminId =
    legacy.adminId != null
      ? legacy.adminId
      : legacy.id != null
      ? legacy.id
      : null;

  const email = legacy.email || null;

  // Derive role from stored flags OR email domain
  const storedIsSuper =
    !!legacy.isSuper ||
    !!legacy.isSuperadmin ||
    !!legacy.is_superadmin;

  const derivedIsSuper =
    email && /@mss\.com$/i.test(email);

  const isSuper = storedIsSuper || derivedIsSuper;

  if (!adminId || !email) {
    console.warn(
      "[SchoolPortal] mssAdminSession missing adminId or email; redirecting to login",
      legacy
    );
    clearAdminSessionAndRedirect();
    return null;
  }

  ADMIN_SESSION = {
    adminId,
    email,
    isSuper,
  };
  ADMIN_EMAIL = email;
  ADMIN_ID = adminId;

  console.log("[SchoolPortal] Loaded admin session from mssAdminSession:", {
    ADMIN_ID,
    ADMIN_EMAIL,
    isSuper,
  });

  // Keep async signature
  return ADMIN_SESSION;
}


  // -----------------------------------------------------------------------
  // DOM refs
  // -----------------------------------------------------------------------

  const SCHOOL_SWITCH_WARNING_HTML = `
    <p>You have changed schools.</p>
    <p style="margin-top:6px;">
      <strong>Important:</strong> Please close any open
      <b>Config Admin</b> or <b>Question Editor</b> tabs from the previous school
      before continuing.
    </p>
  `;

  const titleEl = $("portal-title");
  const subtitleEl = $("portal-subtitle");
  const slugBadgeEl = $("portal-slug-badge");
  const assessmentLabelEl = $("portal-assessment-label");

  const iframeEl = $("portal-iframe");
  const tabWidgetEl = $("tab-widget");
  const tabDashboardEl = $("tab-dashboard");

  const btnWidgetSurvey = $("btn-widgetSurvey");
  const btnConfigAdmin = $("btn-configAdmin");
  const btnCopyEmbed = $("btn-copy-embed");
  const embedSnippetEl = $("embed-snippet");
  const btnAdminHome = $("btn-admin-home");

  const btnPromptManager = $("btnPromptManager");

  const statsLoadingEl = $("stats-loading");
  const statsContentEl = $("stats-content");
  const statsRangeLabelEl = $("stats-range-label");
  const statTotalTestsEl = $("stat-totalTests");
  const statTopQuestionEl = $("stat-topQuestion");
  const statHighestCEFR = $("stat-highestCEFR");
  const statLowestCEFR = $("stat-lowestCEFR");
  const statAvgCEFR = $("stat-avgCEFR");

  const timeframeToggleEl = $("timeframe-toggle");

  const filterFromEl = $("filter-from");
  const filterToEl = $("filter-to");
  const btnRefreshTests = $("btn-refresh-tests");
  const btnDownloadCsv = $("btn-download-csv");
  const btnDeleteSelected = $("btn-delete-selected");
  const testsCountLabel = $("tests-count-label");
  const testsTbody = $("tests-tbody");

  const schoolSelectEl = $("portal-school-selector");

  // Quick-link anchors (optional / older layouts)
  const linkConfigEl = $("portal-link-config");
  const linkQuestionsEl = $("portal-link-questions");
  const linkDashboardEl = $("portal-link-dashboard");
  const linkReportsEl = $("portal-link-reports");

  const logoutBtn = $("portal-logout");

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  let SCHOOLS = []; // [{id, slug, name, ...}]
  let CURRENT_SCHOOL = null;
  let CURRENT_SLUG = INITIAL_SLUG || null;

  let widgetPath = "/widgets/WidgetMin.html";
  let dashboardPath = "/dashboards/Dashboard2.html";

  let assessmentId = ASSESSMENT_ID_FROM_URL
    ? Number(ASSESSMENT_ID_FROM_URL)
    : null;
  let assessmentName = null;

  let currentTimeRange = "today";

  let tests = [];
  let pendingDeleteIds = [];

  let REPORT_VIEW_MODE = "transcript";
  let DASHBOARD_OPTIONS = [];

  let LAST_ROW = null;
  let LAST_AI_PROMPT = "";

  console.log("[SchoolPortal] starting; ADMIN_EMAIL / ADMIN_ID will be set in init");

  // -----------------------------------------------------------------------
  // Helpers: School / slug
  // -----------------------------------------------------------------------

  function showSchoolChangeWarning() {
    return new Promise((resolve) => {
      const backdrop = $("portal-warning-backdrop");
      const msgEl = $("portal-warning-message");
      const okBtn = $("portal-warning-ok");

      if (backdrop && msgEl && okBtn) {
        msgEl.innerHTML = SCHOOL_SWITCH_WARNING_HTML;
        backdrop.classList.remove("hidden");

        okBtn.onclick = () => {
          backdrop.classList.add("hidden");
          msgEl.textContent = "";
          resolve();
        };
      } else {
        window.alert(
          "You have changed schools.\n\n" +
            "Important: Please close any open Config Admin or Question Editor tabs " +
            "from the previous school before continuing."
        );
        resolve();
      }
    });
  }

  function updateSlugUi() {
    const slug = CURRENT_SLUG || "—";

    if (slugBadgeEl) {
      slugBadgeEl.textContent = `slug: ${slug}`;
    }

    if (CURRENT_SCHOOL && titleEl) {
      titleEl.textContent = CURRENT_SCHOOL.name || "School Portal";
    }

    if (subtitleEl) {
      if (!subtitleEl.textContent || subtitleEl.textContent.includes("Loading")) {
        subtitleEl.textContent =
          "Manage your questions, widget, dashboard, and reports.";
      }
    }

    if (schoolSelectEl && SCHOOLS.length) {
      schoolSelectEl.value = slug;
      schoolSelectEl.disabled = SCHOOLS.length === 1;
    }
  }

  function applySlugToQuickLinks() {
    if (!CURRENT_SLUG) return;

    const slugParam = `slug=${encodeURIComponent(CURRENT_SLUG)}`;

    if (linkConfigEl) {
      linkConfigEl.href = `/config-admin/ConfigAdmin.html?${slugParam}`;
    }

    if (linkQuestionsEl) {
      linkQuestionsEl.href = `/admin/Questions.html?${slugParam}`;
    }

    if (linkDashboardEl) {
      const baseDash = dashboardPath || "/dashboards/Dashboard3.html";
      const dashUrl = baseDash.includes("?")
        ? `${baseDash}&${slugParam}`
        : `${baseDash}?${slugParam}`;
      linkDashboardEl.href = dashUrl;
    }

    if (linkReportsEl) {
      linkReportsEl.href = `/admin/Reports.html?${slugParam}`;
    }
  }

let aiPromptsCache = [];     // prompts for CURRENT_SLUG
let currentSubmissionId = null;


function setReportStatus(msg="", isError=false){
  const el = $("reportStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

async function loadAiPromptsForSchool() {
  if (!CURRENT_SLUG) {
    aiPromptsCache = [];
    return { ok: true, prompts: [] };
  }

  try {
    const res = await adminFetch(
      `/api/admin/ai-prompts/${encodeURIComponent(CURRENT_SLUG)}`,
      { method: "GET" }
    );

    const data = await res.json().catch(() => ({}));
    aiPromptsCache = Array.isArray(data.prompts) ? data.prompts : [];
    return { ok: true, prompts: aiPromptsCache };

  } catch (e) {
    // 401 never returns here (adminFetch already redirected), but keep it defensive.
    if (e && e.status === 401) {
      return { ok: false, auth: true, status: 401, prompts: [] };
    }

    // THIS is the important change:
    if (e && e.status === 403) {
      aiPromptsCache = [];
      return { ok: false, forbidden: true, status: 403, prompts: [] };
    }

    return {
      ok: false,
      auth: false,
      status: e?.status || 0,
      error: e?.error || e?.message || "load_prompts_failed",
      prompts: []
    };
  }
}

function populateAiPromptSelect() {
  const sel = $("aiPromptSelect");
  const hint = $("aiPromptHint");
  if (!sel) return;

  // show only active prompts in dropdown (recommended)
  const active = (aiPromptsCache || []).filter(p => p.is_active !== false);

  sel.innerHTML = active.length
    ? active.map(p => {
        const label = `${p.name}${p.is_default ? " (Default)" : ""}`;
        return `<option value="${p.id}">${label}</option>`;
      }).join("")
    : `<option value="">No prompts found (create one in AI Prompt Manager)</option>`;

  // preselect default if present
  const def = active.find(p => !!p.is_default) || active[0] || null;
  if (def) sel.value = String(def.id);

  if (hint) {
    hint.textContent = active.length
      ? "Choose a prompt template for this report."
      : "No active prompts. Open AI Prompt Manager and add one.";
  }
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showModalHtml(title, html) {
  const ov = document.getElementById("mssModalOverlay");
  const t  = document.getElementById("mssModalTitle");
  const b  = document.getElementById("mssModalBody");
  const x  = document.getElementById("mssModalCloseX");

  if (!ov || !t || !b) {
    console.warn("[Portal] MSS modal missing; falling back to console only.");
    return;
  }

  t.textContent = title || "Notice";
  b.innerHTML = html || "";
  ov.classList.add("show");
  ov.setAttribute("aria-hidden", "false");

  const close = () => {
    ov.classList.remove("show");
    ov.setAttribute("aria-hidden", "true");
  };

  if (x) x.onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };

  const onKey = (ev) => {
    if (ev.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  return { close };
}

// Stylish confirm using MSS modal
// - Relies on escHtml(...) and showModalHtml(...)
// - Resolves TRUE on OK, FALSE on cancel, X, Escape, or backdrop click
function confirmModal(
  title,
  bodyText,
  { okText = "Delete", cancelText = "Cancel", danger = true } = {}
) {
  return new Promise((resolve) => {
    const body = `
      <div class="viewerText">${escHtml(bodyText || "")}</div>
      <div class="toolbar" style="margin-top:12px; display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn" id="mssConfirmCancel" type="button">${escHtml(cancelText)}</button>
        <button class="btn ${danger ? "danger" : "primary"}" id="mssConfirmOk" type="button">${escHtml(okText)}</button>
      </div>
    `;

    const modal = showModalHtml(title, body);
    if (!modal) return resolve(false);

    const ov = document.getElementById("mssModalOverlay");
    const okBtn = document.getElementById("mssConfirmOk");
    const cancelBtn = document.getElementById("mssConfirmCancel");

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;

      // cleanup
      if (ov) ov.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);

      try { modal.close(); } catch (_) {}
      resolve(val);
    };

    const onBackdrop = (e) => {
      // Backdrop click (not inside modal)
      if (e.target === ov) finish(false);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };

    if (okBtn) okBtn.onclick = () => finish(true);
    if (cancelBtn) cancelBtn.onclick = () => finish(false);

    // Treat backdrop + Escape as cancel
    if (ov) ov.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);

    // IMPORTANT: also resolve false if the user clicks the X that showModalHtml wires
    // We can’t rely on polling; instead hook the close button directly if it exists.
    // (If showModalHtml uses a different id, adjust this selector.)
    const closeX = document.getElementById("mssModalCloseX");
    if (closeX) {
      closeX.onclick = () => finish(false);
    }

    // If showModalHtml returns a DOM node reference for the overlay, prefer using that.
    // But with the current contract we defensively hook by id above.
  });
}
  // -----------------------------------------------------------------------
  // Schools API
  // -----------------------------------------------------------------------

// ✅ New: rely on cookie/session; do NOT require mss_admin_key
 
// -----------------------------------------------------------------------
// Schools API – use email + adminId AND (if present) admin key header
// -----------------------------------------------------------------------
async function fetchSchoolsForAdmin() {
  console.log("[SchoolPortal] fetchSchoolsForAdmin() starting", {
    ADMIN_EMAIL,
    ADMIN_ID,
    ADMIN_SESSION,
  });

  if (!ADMIN_SESSION || !ADMIN_EMAIL || !ADMIN_ID) {
    console.warn("[SchoolPortal] No valid admin session; redirecting to login");
    clearAdminSessionAndRedirect();
    return;
  }

  // 1) NON-SUPER ADMIN → single school only, driven by ?slug=
  if (!ADMIN_SESSION.isSuper) {
    console.log("[SchoolPortal] Non-super admin – single school mode");

    if (!INITIAL_SLUG) {
      alert(
        "No school slug is available for this account.\n\n" +
        "Please open the portal link that includes ?slug=your-school-slug or contact support."
      );
      return;
    }


    SCHOOLS = [{ id: null, slug: INITIAL_SLUG, name: INITIAL_SLUG }];
    CURRENT_SLUG = INITIAL_SLUG;
    CURRENT_SCHOOL = SCHOOLS[0];

    if (schoolSelectEl) {
      schoolSelectEl.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = CURRENT_SLUG;
      opt.textContent = CURRENT_SCHOOL.name;
      schoolSelectEl.appendChild(opt);
      schoolSelectEl.disabled = true;
    }

    updateSlugUi();
    applySlugToQuickLinks();
    return;
  }

  // 2) SUPER ADMIN → use /api/admin/my-schools (multi-school)
  console.log("[SchoolPortal] Super admin – loading all schools via my-schools");

  const qs = new URLSearchParams();
  qs.set("email", ADMIN_EMAIL);
  qs.set("adminId", String(ADMIN_ID));

  let url = "/api/admin/my-schools";
  const query = qs.toString();
  if (query) url += `?${query}`;

  console.log("[SchoolPortal] my-schools URL:", url);

  try {
    const res = await adminFetch(url, { method: "GET" });

    let data = {};
    try { data = await res.json(); } catch {}

    console.log("[SchoolPortal] my-schools response:", {
      status: res.status,
      data,
    });

    if (res.status === 401) {
      clearAdminSessionAndRedirect();
      return;
    }

    if (!res.ok || data.ok === false) {
      if (!CURRENT_SLUG) {
        alert("No schools found for this admin, and no slug in the URL. Please contact support.");
      }
      return;
    }

    SCHOOLS = Array.isArray(data.schools) ? data.schools : [];
    if (!schoolSelectEl) return;

    if (!SCHOOLS.length) {
      schoolSelectEl.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No schools found";
      schoolSelectEl.appendChild(opt);
      schoolSelectEl.disabled = true;

      if (!CURRENT_SLUG) {
        alert("No schools are associated with this super admin account. Please contact support.");
      }
      updateSlugUi();
      return;
    }

    let initialSlug = INITIAL_SLUG;
    if (!initialSlug || !SCHOOLS.some((s) => String(s.slug) === String(initialSlug))) {
      initialSlug = SCHOOLS[0].slug;
    }

    CURRENT_SLUG = initialSlug;
    CURRENT_SCHOOL = SCHOOLS.find((s) => String(s.slug) === String(initialSlug)) || SCHOOLS[0];

    schoolSelectEl.innerHTML = "";
    SCHOOLS.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.slug;
      opt.textContent = s.name || s.slug;
      schoolSelectEl.appendChild(opt);
    });

    schoolSelectEl.value = CURRENT_SLUG;
    schoolSelectEl.disabled = SCHOOLS.length === 1;

    updateSlugUi();
    applySlugToQuickLinks();
  } catch (err) {
    console.error("[SchoolPortal] fetchSchoolsForAdmin failed", err);
    if (!CURRENT_SLUG) {
      alert("Unable to load schools for this admin and no slug was provided. Please contact support.");
    }
  }
}
  // -----------------------------------------------------------------------
  // Widget / Dashboard preview
  // -----------------------------------------------------------------------

  function setActivePreviewTab(target) {
    [tabWidgetEl, tabDashboardEl].forEach((btn) => {
      if (!btn) return;
      btn.classList.toggle("active", btn.dataset.target === target);
    });

    if (target === "widget") {
      setIframeToWidget();
    } else {
      setIframeToDashboard();
    }
  }

  function setIframeToWidget() {
    if (!iframeEl || !CURRENT_SLUG) return;
    const url = `${widgetPath}?slug=${encodeURIComponent(CURRENT_SLUG)}`;
    iframeEl.src = url;
  }

  function setIframeToDashboard() {
    if (!iframeEl || !CURRENT_SLUG) return;
    const base = dashboardPath || "/dashboards/Dashboard3.html";
    const url = base.includes("?")
      ? `${base}&slug=${encodeURIComponent(CURRENT_SLUG)}`
      : `${base}?slug=${encodeURIComponent(CURRENT_SLUG)}`;
    iframeEl.src = url;
  }

 // -----------------------------------------------------------------------
 // Embed snippet builder (FIX: absolute widget URL for 3rd-party sites) Dec 17
// -----------------------------------------------------------------------

function buildEmbedSnippet() {
  if (!embedSnippetEl || !CURRENT_SLUG) return;

  const safeSlug = String(CURRENT_SLUG || "").trim() || "mss-demo";

  // Always generate embed code that works on THIRD-PARTY sites.
  // So: widget URL must be ABSOLUTE, not "/widgets/WidgetMax.html".
  //
  // If you ever move production host, change this one constant.
  const PROD_BASE = "https://mss-widget-mt.vercel.app";

  // Normalize widget path
  let widgetHtmlPath = widgetPath || "/widgets/Widget3.html";

  // If widgetPath is relative like "WidgetMax.html", normalize to "/widgets/WidgetMax.html"
  if (!/^https?:\/\//i.test(widgetHtmlPath)) {
    if (!widgetHtmlPath.startsWith("/")) {
      // If it's just "WidgetMax.html" (or "widgets/WidgetMax.html") normalize
      if (/^widgets\//i.test(widgetHtmlPath)) {
        widgetHtmlPath = "/" + widgetHtmlPath;
      } else if (/\.html$/i.test(widgetHtmlPath)) {
        widgetHtmlPath = "/widgets/" + widgetHtmlPath;
      } else {
        // last resort: treat as a path segment
        widgetHtmlPath = "/" + widgetHtmlPath;
      }
    }
  }

  // Build absolute widget URL if it's not already absolute
  const widgetUrl = /^https?:\/\//i.test(widgetHtmlPath)
    ? widgetHtmlPath
    : `${PROD_BASE}${widgetHtmlPath}`;

  // Script URL should also be absolute
  const embedJsUrl = `${PROD_BASE}/embed/widget-embed.js`;

  const snippet = [
    "<!-- MySpeakingScore Speaking Widget -->",
    "<div",
    '  class="mss-widget"',
    `  data-mss-slug="${safeSlug}"`,
    `  data-mss-widget="${widgetUrl}"`,
    "></div>",
    `<script async src="${embedJsUrl}"></script>`,
    "<!-- End MySpeakingScore widget -->",
    "",
  ].join("\n");

  embedSnippetEl.value = snippet;
}
  function copyEmbedToClipboard() {
    if (!embedSnippetEl || !btnCopyEmbed) return;
    embedSnippetEl.select();
    embedSnippetEl.setSelectionRange(0, 99999);

    try {
      document.execCommand("copy");
      const original = btnCopyEmbed.textContent;
      btnCopyEmbed.textContent = "Copied!";
      setTimeout(() => {
        btnCopyEmbed.textContent = original || "Copy embed code";
      }, 1500);
    } catch (e) {
      console.warn("Copy failed", e);
      alert("Copy failed. Please select the text and copy manually.");
    }
  }

async function refreshReportForSelection() {
  const promptId = Number(($("aiPromptSelect")?.value || 0));
  if (!currentSubmissionId) return;
  if (!promptId) return;

  setReportStatus("Checking existing…");
  $("reportOutput").textContent = "";

  try {
    const qs = new URLSearchParams({
      submission_id: String(currentSubmissionId),
      ai_prompt_id: String(promptId),
    });

    const res = await adminFetch(`/api/admin/reports/existing?${qs.toString()}`, { method: "GET" });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) return clearAdminSessionAndRedirect();
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);

    if (data.exists) {
      $("reportOutput").textContent = data.report_text || "(Empty cached report)";
      setReportStatus("Loaded (cached).");
      $("btnRunReport").textContent = "Regenerate (disabled)";
      $("btnRunReport").disabled = true; // enforce use-once
    } else {
      setReportStatus("Not generated yet. Click Generate.");
      $("btnRunReport").textContent = "Generate";
      $("btnRunReport").disabled = false;
    }
  } catch (e) {
    setReportStatus(`Check failed: ${e.message || "unknown"}`, true);
    $("btnRunReport").disabled = false;
  }
}

function confirmPortalModal({ title = "Confirm", body = "", okText = "OK", cancelText = "Cancel" } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById("portal-delete-backdrop");
    const btnCancel = document.getElementById("portal-delete-cancel");
    const btnOk = document.getElementById("portal-delete-confirm");

    // If your portal confirm modal also has a title/body node, set them here.
    const titleEl = document.getElementById("portal-delete-title");
    const bodyEl  = document.getElementById("portal-delete-body");

    if (!backdrop || !btnCancel || !btnOk) {
      console.warn("[confirmPortalModal] Missing portal delete modal DOM; falling back to window.confirm");
      resolve(window.confirm(body));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;

    // Set button labels if those nodes are normal buttons
    if (btnOk) btnOk.textContent = okText;
    if (btnCancel) btnCancel.textContent = cancelText;

    const cleanup = () => {
      btnCancel.onclick = null;
      btnOk.onclick = null;
      backdrop.onclick = null;
      backdrop.classList.add("hidden");
      resolve(false);
    };

    btnCancel.onclick = () => {
      backdrop.classList.add("hidden");
      resolve(false);
    };

    btnOk.onclick = () => {
      backdrop.classList.add("hidden");
      resolve(true);
    };

    backdrop.onclick = (e) => {
      if (e.target === backdrop) {
        backdrop.classList.add("hidden");
        resolve(false);
      }
    };

    backdrop.classList.remove("hidden");
  });
}
  // -----------------------------------------------------------------------
  // Small formatting helpers
  // -----------------------------------------------------------------------

  function formatShortDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatHelpCell(t) {
    const level = t.help_level || "none";
    const surface = t.help_surface || "";
    if (!surface) return level;
    return `${level} / ${surface}`;
  }

  function formatDashCell(t) {
    const w = t.widget_variant || "";
    const d = t.dashboard_variant || "";
    if (w && d) return `${w} → ${d}`;
    if (w) return w;
    if (d) return d;
    return "—";
  }

  // -----------------------------------------------------------------------
  // Dashboard list + Report view mode
  // -----------------------------------------------------------------------

  async function loadDashboardOptionsIntoSelect() {
    const select = document.getElementById("reportViewSelect");
    const hasSelect = !!select;

    if (hasSelect) {
      select.innerHTML = `
        <option value="transcript">Transcript + AI Prompt</option>
      `;
    }

    try {
      const resp = await fetch("/api/list-dashboards");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      DASHBOARD_OPTIONS = [];

      if (Array.isArray(json.dashboards)) {
        json.dashboards.forEach((dashName) => {
          const value = dashName.toLowerCase();
          const label = dashName;

          DASHBOARD_OPTIONS.push({ value, label });

          if (hasSelect) {
            select.insertAdjacentHTML(
              "beforeend",
              `<option value="${value}">${label}</option>`
            );
          }
        });
      }

      console.log("📊 Dashboard options loaded:", DASHBOARD_OPTIONS);
    } catch (err) {
      console.warn("Could not load dashboards:", err);
    }
  }

  function initReportViewMode() {
    const select = document.getElementById("reportViewSelect");
    if (!select) {
      REPORT_VIEW_MODE = "transcript";
      return;
    }

    REPORT_VIEW_MODE = select.value || "transcript";

    select.addEventListener("change", () => {
      REPORT_VIEW_MODE = select.value;
      console.log("📊 Report view mode:", REPORT_VIEW_MODE);
    });
  }

  function truncate(text, length = 40) {
    if (!text) return "—";
    text = String(text).trim();
    return text.length > length ? text.slice(0, length) + "…" : text;
  }

  // -----------------------------------------------------------------------
  // Tests table sorting
  // -----------------------------------------------------------------------

  let currentSortKey = null;
  let currentSortDir = "asc";

  const SORT_CONFIG = {
    id: {
      type: "number",
      get: (row) => row.id,
    },
    date: {
      type: "date",
      get: (row) => row.submitted_at || row.created_at || row.timestamp,
    },
    student: {
      type: "string",
      get: (row) =>
        row.student_name ||
        row.student_email ||
        (row.student_id != null ? String(row.student_id) : ""),
    },
    question: {
      type: "string",
      get: (row) => row.question || "",
    },
    wpm: {
      type: "number",
      get: (row) => (row.wpm == null ? null : Number(row.wpm)),
    },
    toefl: {
      type: "number",
      get: (row) => row.mss_toefl ?? row.toefl,
    },
    ielts: {
      type: "number",
      get: (row) => row.mss_ielts ?? row.ielts,
    },
    pte: {
      type: "number",
      get: (row) => row.mss_pte ?? row.pte,
    },
    cefr: {
      type: "string",
      get: (row) => row.mss_cefr || row.cefr || "",
    },
    help: {
      type: "string",
      get: (row) => formatHelpCell(row),
    },
    dash: {
      type: "string",
      get: (row) => formatDashCell(row),
    },
    fluency: {
      type: "number",
      get: (row) => row.mss_fluency,
    },
    grammar: {
      type: "number",
      get: (row) => row.mss_grammar,
    },
    pron: {
      type: "number",
      get: (row) => row.mss_pron,
    },
    vocab: {
      type: "number",
      get: (row) => row.mss_vocab,
    },
  };

  function loadInitialSort() {
    try {
      const raw = window.localStorage.getItem("mssPortalSort");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.key && SORT_CONFIG[parsed.key]) {
        currentSortKey = parsed.key;
        currentSortDir = parsed.dir === "desc" ? "desc" : "asc";
      }
    } catch (e) {
      console.warn("[SchoolPortal] Failed to load sort state", e);
    }
  }

  function saveSortState() {
    try {
      window.localStorage.setItem(
        "mssPortalSort",
        JSON.stringify({ key: currentSortKey, dir: currentSortDir })
      );
    } catch (e) {
      console.warn("[SchoolPortal] Failed to save sort state", e);
    }
  }

  function sortTestsInPlace() {
    if (!Array.isArray(tests) || !currentSortKey) return;
    const cfg = SORT_CONFIG[currentSortKey];
    if (!cfg || typeof cfg.get !== "function") return;

    const { type, get } = cfg;

    tests.sort((a, b) => {
      const va = get(a);
      const vb = get(b);

      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      let cmp = 0;
      if (type === "number") {
        cmp = Number(va) - Number(vb);
      } else if (type === "date") {
        cmp = new Date(va) - new Date(vb);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }

      return currentSortDir === "asc" ? cmp : -cmp;
    });
  }

  function updateHeaderSortIndicators() {
    const table = document.getElementById("tests-table");
    if (!table) return;

    const ths = table.querySelectorAll("thead th[data-sort-key]");
    ths.forEach((th) => {
      th.classList.remove("tests-th-sort-asc", "tests-th-sort-desc");
      const key = th.dataset.sortKey;
      if (key && key === currentSortKey) {
        th.classList.add(
          currentSortDir === "asc" ? "tests-th-sort-asc" : "tests-th-sort-desc"
        );
      }
    });
  }

  function setSort(key) {
    if (!key || !SORT_CONFIG[key]) return;

    if (currentSortKey === key) {
      currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
    } else {
      currentSortKey = key;
      currentSortDir = "asc";
    }

    saveSortState();
    sortTestsInPlace();
    renderTestsTable();
    updateHeaderSortIndicators();
  }

  function wireTableSorting() {
    const table = document.getElementById("tests-table");
    if (!table) return;

    const ths = table.querySelectorAll("thead th");
    ths.forEach((th) => {
      const key = th.dataset.sortKey;
      if (!key || !SORT_CONFIG[key]) return;

      th.style.cursor = "pointer";
      th.addEventListener("click", () => setSort(key));
    });
  }

  // -----------------------------------------------------------------------
  // Render Tests table
  // -----------------------------------------------------------------------

  function renderTestsTable() {
    const safe = (v) =>
      v === null || v === undefined || v === "" ? "—" : v;

    if (!tests || tests.length === 0) {
      testsTbody.innerHTML =
        `<tr><td colspan="17" class="muted">No data for this period.</td></tr>`;
      testsCountLabel.textContent = "0 tests";
      return;
    }

    const rows = tests.map((t) => {
      const date = formatShortDateTime(
        t.submitted_at || t.submittedAt || t.created_at
      );

      const helpText = formatHelpCell(t);
      const dashText = formatDashCell(t);

      return `
        <tr data-id="${safe(t.id)}">

          <!-- 1: Select -->
          <td>
            <input 
              type="checkbox" 
              class="test-select" 
              data-id="${safe(t.id)}"
            />
          </td>

          <!-- 2: Actions -->
          <td>
            <select class="row-action-select" data-id="${safe(t.id)}">
              <option value="">Actions…</option>           
              <option value="transcript">Transcript</option>
              <option value="generate_report">Generate Report</option>
              <option value="dashboard">Dashboard view</option>
            </select>
          </td>

          <!-- 3: ID -->
          <td>${safe(t.id)}</td>

          <!-- 4: Date -->
          <td>${safe(date)}</td>

          <!-- 5: Student -->
          <td>${safe(t.student_email || t.student_name || t.student_id)}</td>

          <!-- 6: Question -->
          <td title="${safe(t.question)}">
            ${truncate(t.question, 30)}
          </td>

          <!-- 7: Words Per Minute -->
          <td>${safe(t.wpm)}</td>

          <!-- 8–11: MSS scores -->
          <td>${safe(t.mss_toefl)}</td>
          <td>${safe(t.mss_ielts)}</td>
          <td>${safe(t.mss_pte)}</td>
          <td>${safe(t.mss_cefr)}</td>

          <!-- 12: Help -->
          <td>${safe(helpText)}</td>

          <!-- 13: Dash -->
          <td>${safe(dashText)}</td>

          <!-- 14–17: Subscores -->
          <td>${safe(t.mss_fluency)}</td>
          <td>${safe(t.mss_grammar)}</td>
          <td>${safe(t.mss_pron)}</td>
          <td>${safe(t.mss_vocab)}</td>

        </tr>
      `;
    });

    testsTbody.innerHTML = rows.join("");

    testsCountLabel.textContent = `${tests.length} test${
      tests.length === 1 ? "" : "s"
    }`;

    wireRowActionSelects();
  }

  function wireRowActionSelects() {
  const selects = testsTbody.querySelectorAll(".row-action-select");
  if (!selects.length) return;

  selects.forEach((select) => {
    if (select._mssBound) return; // prevent double-binding
    select._mssBound = true;

    select.addEventListener("change", () => {
      const value = select.value;
      const id = select.dataset.id;

      console.log("🧪 Row action changed:", { value, id });

      if (!value) return;

      try {
        if (!id) throw new Error("missing_row_id");

        const row = tests.find((t) => String(t.id) === String(id));
        if (!row) throw new Error("row_not_found");

        if (value === "generate_report") {
          console.log("🧪 Calling openReportViewerForSubmission:", row.id);
          if (typeof openReportViewerForSubmission !== "function") {
            throw new Error("openReportViewerForSubmission_not_defined");
          }
          openReportViewerForSubmission(row.id);
        } else if (value === "transcript") {
          showTranscript(row);
        } else if (value === "dashboard") {
          openDashboardPickerForRow(row);
        }
      } catch (e) {
        console.error("❌ Row action handler failed:", e);
        showWarning(`Action failed: ${e.message || e}`);
      } finally {
        select.value = ""; // reset menu no matter what
      }
    });
  });
}
// -----------------------------------------------------------------------
// Report Viewer (Generate Report) — inside IIFE
// -----------------------------------------------------------------------
function wireReportViewerEvents() {
  const ov = document.getElementById("reportOverlay");
  const btnRun = document.getElementById("btnRunReport");
  const btnClose = document.getElementById("btnReportClose");
  const btnX = document.getElementById("reportCloseX");
  const btnDelete = document.getElementById("btnReportDelete");

  console.log("✅ wireReportViewerEvents()", {
    hasOverlay: !!ov,
    hasRun: !!btnRun,
    hasClose: !!btnClose,
    hasX: !!btnX,
    hasDelete: !!btnDelete,
    hasDeleteFn: typeof deleteCurrentReportFromViewer === "function",
  });

  // Stop clicks inside modal from bubbling to backdrop
  const modal = ov?.querySelector(".sp-modal");
  if (modal && !modal._mssBoundClickStop) {
    modal.addEventListener("click", (e) => e.stopPropagation());
    modal._mssBoundClickStop = true;
  }

  // Run
  if (btnRun && !btnRun._mssBound) {
    btnRun.addEventListener("click", generateReport);
    btnRun._mssBound = true;
  }

  // Close buttons
  const closeHandler = () => closeReportViewer();
  if (btnClose && !btnClose._mssBound) {
    btnClose.addEventListener("click", closeHandler);
    btnClose._mssBound = true;
  }
  if (btnX && !btnX._mssBound) {
    btnX.addEventListener("click", closeHandler);
    btnX._mssBound = true;
  }

  // Delete (this is the important one)
  if (btnDelete && !btnDelete._mssBound) {
    btnDelete.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("🗑️ btnReportDelete clicked", {
        currentSubmissionId,
        reportViewerPromptId,
        reportViewerHasCachedReport,
      });

      if (typeof deleteCurrentReportFromViewer !== "function") {
        setReportStatus("Delete is not implemented yet.", true);
        return;
      }
      deleteCurrentReportFromViewer().catch((err) => {
        console.warn("deleteCurrentReportFromViewer failed:", err);
      });
    });
    btnDelete._mssBound = true;
  }

  // Click outside closes
  if (ov && !ov._mssBoundBackdrop) {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeReportViewer();
    });
    ov._mssBoundBackdrop = true;
  }

  // Escape closes
  if (!document._mssReportEscBound) {
    document.addEventListener("keydown", (e) => {
      const visible = ov && !ov.classList.contains("hidden");
      if (visible && e.key === "Escape") closeReportViewer();
    });
    document._mssReportEscBound = true;
  }
}
// ---- globals (ensure these exist once in the IIFE scope) ----

function safeBlurActiveElementIfInside(containerEl) {
  try {
    const ae = document.activeElement;
    if (containerEl && ae && containerEl.contains(ae)) {
      ae.blur();
    }
  } catch (_) {}
}

function openReportViewerForSubmission(submissionId) {
  currentSubmissionId = Number(submissionId || 0);
  if (!currentSubmissionId) {
    showWarning("Missing submission id.");
    return;
  }

  // ---------- DOM refs (defensive) ----------
  const ov = $("reportOverlay");
  const titleEl = $("reportTitle");
  const metaEl = $("reportMeta");
  const outEl = $("reportOutput");
  const btnRun = $("btnRunReport");
  const btnDelete = $("btnReportDelete");
  const btnClose = $("btnReportClose");
  const btnX = $("reportCloseX");
  const sel = $("aiPromptSelect");

  if (!ov) return;

  // ---------- Reset viewer state/UI ----------
  if (titleEl) titleEl.textContent = "Generate Report";
  if (metaEl) {
    metaEl.textContent = `submission_id=${currentSubmissionId} • slug=${CURRENT_SLUG || "—"}`;
  }
  if (outEl) outEl.textContent = "";
  setReportStatus("");

  // Reset report-specific state (prevents stale prompt/report flags)
  reportViewerPromptId = 0;
  reportViewerHasCachedReport = false;

  // Hide delete until we confirm cached report exists
  if (btnDelete) {
    btnDelete.style.display = "none";
    btnDelete.disabled = false;
  }

  // Default: enable Generate (we may disable it after prompt permission check)
  if (btnRun) btnRun.disabled = false;

  // ---------- Show modal ----------
  document.body.classList.add("modal-open");
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  ov.style.pointerEvents = "auto";

  // ---------- Re-bind report viewer events (your pattern) ----------
  // NOTE: Avoid doing this if you can make wireReportViewerEvents() truly idempotent.
  // But if you keep it, reset flags consistently.
  if (btnRun) btnRun._mssBound = false;
  if (btnClose) btnClose._mssBound = false;
  if (btnX) btnX._mssBound = false;
  if (btnDelete) btnDelete._mssBound = false;

  wireReportViewerEvents();

  // ---------- Focus assist ----------
  setTimeout(() => {
    const first =
      $("aiPromptSelect") ||
      $("btnRunReport") ||
      ov.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');

    try { first?.focus?.(); } catch (_) {}
  }, 0);

  // ---------- Load prompts and apply permission rules ----------
  (async () => {
    try {
      setReportStatus("Loading prompts…");

      const result = await loadAiPromptsForSchool();
      // EXPECTED SHAPES (per our earlier fix):
      // { ok:true, prompts:[...] }
      // { ok:false, forbidden:true, status:403 }
      // { ok:false, auth:true, status:401 }
      // { ok:false, error:"..." }

      if (!result || result.ok !== true) {
        // 401: adminFetch usually already redirected, but keep defensive
        if (result?.auth) {
          setReportStatus("Session expired. Please sign in again.", true);
          clearAdminSessionAndRedirect();
          return;
        }

        // 403: stay in modal and disable Generate Report feature
        if (result?.forbidden) {
          setReportStatus(
            "You are signed in, but you do not have permission to access AI prompts for this school.",
            true
          );

          // Disable Generate and make prompt selector inert/clear
          if (btnRun) btnRun.disabled = true;
          if (btnDelete) btnDelete.style.display = "none";

          if (sel) {
            sel.innerHTML = `<option value="">Not permitted</option>`;
            sel.disabled = true;
          }

          // Optional: explain next action
          // (You can also hide the action in the row menu for non-super admins.)
          return;
        }

        // Other failure: keep modal open, show error
        const msg =
          result?.error ||
          result?.message ||
          "Unable to load AI prompts.";

        setReportStatus(msg, true);
        if (btnRun) btnRun.disabled = true; // safer: prevent generate without prompts
        return;
      }

      // OK: prompts loaded
      if (sel) sel.disabled = false;
      populateAiPromptSelect();

      // Bind change handler ONCE
      if (sel && !sel._mssBound) {
        sel.addEventListener("change", () => {
          refreshReportForSelection().catch(() => {});
        });
        sel._mssBound = true;
      }

      setReportStatus("");

      // Optional: immediately check cache for the default prompt selection
      // (uncomment if you want "Not generated yet" vs "Loaded cached" automatically)
      // await refreshReportForSelection();

    } catch (e) {
      setReportStatus(`Unable to load prompts: ${e?.message || "unknown"}`, true);
      if (btnRun) btnRun.disabled = true;
    }
  })();
}
function closeReportViewer() {
  const ov = $("reportOverlay");
  if (!ov) return;

  // IMPORTANT: prevent aria-hidden warning (focused descendant)
  safeBlurActiveElementIfInside(ov);

  ov.classList.add("hidden");
  ov.setAttribute("aria-hidden", "true");
  currentSubmissionId = null;

  // ---- NEW: unlock background scroll ----
  document.body.classList.remove("modal-open");

  // Optional: return focus to something sensible on the main page
  setTimeout(() => {
    // NOTE: in your HTML the id is btn-refresh-tests, not btnRefreshTests
    const back =
      $("btn-refresh-tests") ||
      $("openReportsBtn") ||
      document.querySelector('[data-role="tests-card"] button') ||
      null;
    back?.focus?.();
  }, 0);
}
// -----------------------------------------------------------------------
// Generate Report (Report Viewer)
// - Calls POST /api/admin/reports/generate
// - If response is cached, show Delete button and disable Generate until deleted
// -----------------------------------------------------------------------

let reportViewerHasCachedReport = false;
let reportViewerPromptId = null;

async function generateReport() {
  const btnRun = $("btnRunReport");
  const btnDelete = $("btnReportDelete");
  const promptId = Number(($("aiPromptSelect")?.value || 0));

  if (!CURRENT_SLUG) return setReportStatus("Missing slug.", true);
  if (!currentSubmissionId) return setReportStatus("Missing submission id.", true);
  if (!promptId) return setReportStatus("Please choose an AI prompt.", true);

  // Reset viewer state for this run
  reportViewerPromptId = promptId;
  reportViewerHasCachedReport = false;

  // Hide delete button until we know it's cache
  if (btnDelete) {
    btnDelete.style.display = "none";
    btnDelete.disabled = false;
  }

  setReportStatus("Generating report…");
  if (btnRun) btnRun.disabled = true;

  try {
    // adminFetch injects Authorization; we provide JSON body.
    const res = await adminFetch("/api/admin/reports/generate", {
      method: "POST",
      body: JSON.stringify({
        slug: CURRENT_SLUG,
        submission_id: currentSubmissionId,
        ai_prompt_id: promptId,
      }),
    });

    // Handle auth first (avoid JSON parsing issues on auth failures)
    if (res.status === 401 || res.status === 403) {
      clearAdminSessionAndRedirect();
      return;
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.message || `http_${res.status}`);
    }

    $("reportOutput").textContent = data.report_text || "(No report returned)";
    setReportStatus("");

    // If this is cached, show Delete and disable Generate until deleted
    reportViewerHasCachedReport = (data.source === "cache");

    if (btnDelete) {
      btnDelete.style.display = reportViewerHasCachedReport ? "inline-block" : "none";
    }

    if (btnRun) {
      btnRun.disabled = reportViewerHasCachedReport;
    }
  } catch (e) {
    setReportStatus(`Generate failed: ${e?.message || "unknown"}`, true);
    if (btnRun) btnRun.disabled = false;
  }
}

// -----------------------------------------------------------------------
// Delete cached report immediately (no confirm dialog)
// DELETE /api/admin/reports/:slug/:submission_id/:prompt_id
// -----------------------------------------------------------------------
async function deleteCurrentReportFromViewer() {
  console.log("🧨 deleteCurrentReportFromViewer() CLICK");

  const btnRun = $("btnRunReport");
  const btnDelete = $("btnReportDelete");

  if (!CURRENT_SLUG) return setReportStatus("Missing slug.", true);
  if (!currentSubmissionId) return setReportStatus("Missing submission id.", true);
  if (!reportViewerPromptId) return setReportStatus("Missing prompt id.", true);

  setReportStatus("Deleting cached report…");
  if (btnDelete) btnDelete.disabled = true;

  try {
    const url =
      `/api/admin/reports/${encodeURIComponent(CURRENT_SLUG)}` +
      `/${encodeURIComponent(String(currentSubmissionId))}` +
      `/${encodeURIComponent(String(reportViewerPromptId))}`;

    console.log("🧨 DELETE url:", url);

    const res = await adminFetch(url, { method: "DELETE" });
    console.log("🧨 DELETE status:", res.status);

    if (res.status === 401 || res.status === 403) {
      setReportStatus("Session expired. Please sign in again.", true);
      clearAdminSessionAndRedirect();
      return;
    }

    const data = await res.json().catch(() => ({}));
    console.log("🧨 DELETE response:", data);

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.message || `http_${res.status}`);
    }

    // Clear viewer + reset state
    $("reportOutput").textContent = "";
    reportViewerHasCachedReport = false;

    // Hide delete until a cached report is detected again
    if (btnDelete) btnDelete.style.display = "none";

    // Re-enable Generate
    if (btnRun) btnRun.disabled = false;

    setReportStatus(data.deleted ? "Deleted cached report ✓" : "No cached report found to delete.", !data.deleted);
  } catch (e) {
    console.warn("🧨 DELETE failed:", e);
    setReportStatus(`Delete failed: ${e?.message || "unknown"}`, true);
  } finally {
    if (btnDelete) btnDelete.disabled = false;
  }
}

  // -----------------------------------------------------------------------
  // DashboardViewer integration
  // -----------------------------------------------------------------------

  function buildDashboardViewerUrl(row, explicitLayout) {
    const baseLayout =
      explicitLayout && explicitLayout !== "transcript"
        ? explicitLayout
        : REPORT_VIEW_MODE && REPORT_VIEW_MODE.startsWith("dashboard")
        ? REPORT_VIEW_MODE
        : "dashboard3";

    const schoolSlug = row.school_slug || CURRENT_SLUG;

    const p = new URLSearchParams({
      slug: schoolSlug || "",
      submissionId: row.id,
      layout: baseLayout,
    });

    return `/DashboardViewer.html?${p.toString()}`;
  }

  function openDashboardPickerForRow(row) {
    if (!row) return;
    const url = buildDashboardViewerUrl(row);
    console.log("🧭 Opening DashboardViewer:", url);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openReportForRow(row) {
    if (!row) return;

    if (!REPORT_VIEW_MODE || REPORT_VIEW_MODE === "transcript") {
      showTranscript(row);
      return;
    }

    const url = buildDashboardViewerUrl(row, REPORT_VIEW_MODE);
    console.log("🧭 Opening DashboardViewer (global mode):", {
      REPORT_VIEW_MODE,
      url,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // -----------------------------------------------------------------------
  // API calls: widget meta, assessment meta, stats, tests
  // -----------------------------------------------------------------------

  async function fetchWidgetMeta() {
    if (!CURRENT_SLUG) return;

    try {
      const res = await fetch(
        `/api/admin/widget/${encodeURIComponent(CURRENT_SLUG)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      const rootCfg = data.config || {};
      const nestedCfg =
        (data.settings && data.settings.config) || {};
      const cfg = { ...nestedCfg, ...rootCfg };

      const rawWidget =
        cfg.widgetPath ||
        cfg.widgetUrl ||
        cfg.widget_layout ||
        cfg.widgetLayout ||
        null;

      if (rawWidget) {
        if (
          /^https?:\/\//i.test(rawWidget) ||
          rawWidget.startsWith("/")
        ) {
          widgetPath = rawWidget;
        } else {
          widgetPath = `/widgets/${rawWidget}`;
        }
      }

      const rawDash =
        cfg.dashboardPath ||
        cfg.dashboardUrl ||
        cfg.dashboard_style ||
        cfg.dashboardStyle ||
        null;

      if (rawDash) {
        if (
          /^https?:\/\//i.test(rawDash) ||
          rawDash.startsWith("/")
        ) {
          dashboardPath = rawDash;
        } else {
          dashboardPath = `/dashboards/${rawDash}`;
        }
      }

      console.log("🎛 Widget meta", {
        rawWidget,
        rawDash,
        widgetPath,
        dashboardPath,
        cfg,
        data,
      });

      const schoolName =
        (data.school && data.school.name) ||
        (CURRENT_SCHOOL && CURRENT_SCHOOL.name) ||
        "School Portal";

      if (titleEl) {
        titleEl.textContent = schoolName;
      }
      if (subtitleEl) {
        subtitleEl.textContent =
          cfg.subtitle ||
          cfg.title ||
          "Manage your questions, widget, dashboard, and reports.";
      }

      updateSlugUi();
      applySlugToQuickLinks();

      setActivePreviewTab("widget");
      buildEmbedSnippet();
    } catch (err) {
      console.error("Failed to fetch widget meta", err);
      if (subtitleEl) {
        subtitleEl.textContent = "Error loading widget configuration.";
      }
    }
  }

  async function fetchAssessmentMeta() {
    if (!CURRENT_SLUG) return;
    if (assessmentId && ASSESSMENT_ID_FROM_URL) {
      assessmentLabelEl.textContent = `Assessment ID: ${assessmentId}`;
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/assessments/${encodeURIComponent(CURRENT_SLUG)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data.ok === false) throw new Error(data.error || "api_error");

      assessmentId = data.assessmentId;
      assessmentName = data.assessment?.name || null;

      if (assessmentId) {
        const labelName = assessmentName || `#${assessmentId}`;
        assessmentLabelEl.textContent = `Assessment: ${labelName}`;
      } else {
        assessmentLabelEl.textContent = "Assessment: —";
      }
    } catch (err) {
      console.error("Failed to fetch assessment meta", err);
      assessmentLabelEl.textContent = "Assessment: —";
    }
  }

  async function fetchStats(range) {
    if (!CURRENT_SLUG) return;
    statsLoadingEl.style.display = "block";
    statsContentEl.style.display = "none";

    try {
      const url = `/api/admin/stats/${encodeURIComponent(
        CURRENT_SLUG
      )}?range=${encodeURIComponent(range)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      currentTimeRange = data.range || range;

      statsRangeLabelEl.textContent = `Showing ${
        currentTimeRange || range
      } (${data.from || "—"} to ${data.to || "—"})`;
      statTotalTestsEl.textContent =
        data.totalTests != null ? data.totalTests : "0";
      statTopQuestionEl.textContent = data.topQuestion?.text || "—";
      statHighestCEFR.textContent = data.highestCEFR || "—";
      statLowestCEFR.textContent = data.lowestCEFR || "—";
      statAvgCEFR.textContent = data.avgCEFR || "—";

      statsLoadingEl.style.display = "none";
      statsContentEl.style.display = "block";
    } catch (err) {
      console.error("Failed to fetch stats", err);
      statsLoadingEl.textContent = "Error fetching stats.";
      statsContentEl.style.display = "none";
    }
  }

  // -----------------------------------------------------------------------
  // Date helpers
  // -----------------------------------------------------------------------

  function parseYmd(str) {
    if (!str) return null;
    const [y, m, d] = str.split("-").map((v) => Number(v));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function validateDateRangeFields(fromInput, toInput) {
    if (!fromInput || !toInput) return true;

    const fromVal = fromInput.value;
    const toVal = toInput.value;

    if (!fromVal || !toVal) return true;

    const fromDate = parseYmd(fromVal);
    const toDate = parseYmd(toVal);
    if (!fromDate || !toDate) return true;

    if (toDate < fromDate) {
      showWarning(
        "The end date cannot be earlier than the start date. I've adjusted it for you."
      );
      toInput.value = fromVal;
      return false;
    }
    return true;
  }

  function validateDateRange() {
    return validateDateRangeFields(filterFromEl, filterToEl);
  }

  function showWarning(message) {
    const backdrop = $("portal-warning-backdrop");
    const msgEl = $("portal-warning-message");
    const okBtn = $("portal-warning-ok");

    if (backdrop && msgEl && okBtn) {
      msgEl.textContent = message;
      backdrop.classList.remove("hidden");

      okBtn.onclick = () => {
        backdrop.classList.add("hidden");
      };
    } else {
      window.alert(message);
    }
  }

  // -----------------------------------------------------------------------
  // Reports API + CSV
  // -----------------------------------------------------------------------

  function filterRowsByDate(rows) {
    const fromVal = filterFromEl.value;
    const toVal = filterToEl.value;

    if (!fromVal && !toVal) return rows;

    const fromDate = fromVal ? parseYmd(fromVal) : null;
    const toDate = toVal ? parseYmd(toVal) : null;

    if (!fromDate && !toDate) return rows;

    return rows.filter((row) => {
      const dtRaw = row.submitted_at || row.takenAt || row.timestamp;
      if (!dtRaw) return true;
      const dt = new Date(dtRaw);
      if (Number.isNaN(dt.getTime())) return true;

      if (fromDate && dt < fromDate) return false;

      if (toDate) {
        const endOfDay = new Date(
          toDate.getFullYear(),
          toDate.getMonth(),
          toDate.getDate(),
          23,
          59,
          59,
          999
        );
        if (dt > endOfDay) return false;
      }
      return true;
    });
  }

  async function fetchTests() {
    if (!CURRENT_SLUG) return;

    if (!validateDateRange()) {
      tests = [];
      renderTestsTable();
      return;
    }

    btnRefreshTests.disabled = true;
    btnRefreshTests.innerHTML = `<span class="spinner"></span>`;

    try {
      const url = `/api/admin/reports/${encodeURIComponent(
        CURRENT_SLUG
      )}?limit=500`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const allRows =
        (Array.isArray(data.rows) && data.rows) ||
        (Array.isArray(data.tests) && data.tests) ||
        [];

      tests = filterRowsByDate(allRows);
      loadInitialSort();
      sortTestsInPlace();
      renderTestsTable();
      updateHeaderSortIndicators();
    } catch (err) {
      console.error("Failed to fetch tests/reports", err);
      tests = [];
      renderTestsTable();
    } finally {
      btnRefreshTests.disabled = false;
      btnRefreshTests.textContent = "Refresh";
    }
  }

  function normalizeTranscriptForCsv(value) {
    if (!value) return "";

    let s = String(value);
    s = s.replace(/<[^>]*>/g, "");
    s = s.replace(/\u00A0/g, " ");
    s = s.replace(/\s+/g, " ").trim();

    return s;
  }

  function toCsvRow(cells) {
    return cells
      .map((val) => {
        if (val == null) return '""';
        let s = String(val);
        s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        s = s.replace(/"/g, '""');
        return `"${s}"`;
      })
      .join(",");
  }

  function downloadCsv() {
    if (!CURRENT_SLUG) return;

    if (!validateDateRange()) return;

    if (!tests || !tests.length) {
      alert("No tests to export for this period.");
      return;
    }

    console.log("✅ SchoolPortal downloadCsv using local tests[]");

    const headers = [
      "id",
      "school_slug",
      "submitted_at",
      "question",
      "student_id",
      "toefl",
      "ielts",
      "pte",
      "cefr",
      "vox_score",
      "help_level",
      "help_surface",
      "widget_variant",
      "dashboard_variant",
      "wpm",
      "mss_fluency",
      "mss_grammar",
      "mss_pron",
      "mss_vocab",
      "mss_cefr",
      "mss_toefl",
      "mss_ielts",
      "mss_pte",
      "transcript_clean",
    ];

    const lines = [];
    lines.push(toCsvRow(headers));

    for (const t of tests) {
      const row = [
        t.id,
        t.school_slug,
        t.submitted_at || t.created_at || "",
        t.question,
        t.wpm,
        t.student_id,
        t.toefl,
        t.ielts,
        t.pte,
        t.cefr,
        t.vox_score,
        t.help_level,
        t.help_surface,
        t.widget_variant,
        t.dashboard_variant,
        t.mss_fluency,
        t.mss_grammar,
        t.mss_pron,
        t.mss_vocab,
        t.mss_cefr,
        t.mss_toefl,
        t.mss_ielts,
        t.mss_pte,
        normalizeTranscriptForCsv(t.transcript_clean || ""),
      ];
      lines.push(toCsvRow(row));
    }

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `mss-reports-${CURRENT_SLUG}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  // -----------------------------------------------------------------------
  // Delete Selected
  // -----------------------------------------------------------------------

  function onDeleteSelected() {
    if (!tests || !tests.length) {
      showWarning("No tests to delete.");
      return;
    }

    const checked = testsTbody.querySelectorAll(".test-select:checked");
    if (!checked.length) {
      showWarning("Please select at least one row to delete.");
      return;
    }

    const ids = Array.from(checked).map((cb) => Number(cb.dataset.id));
    pendingDeleteIds = ids;

    const backdrop = document.getElementById("portal-delete-backdrop");
    const msgEl = document.getElementById("portal-delete-message");

    if (msgEl) {
      msgEl.textContent =
        ids.length === 1
          ? "Delete this submission? This cannot be undone."
          : `Delete ${ids.length} submissions? This cannot be undone.`;
    }

    if (backdrop) {
      backdrop.classList.remove("hidden");
    }
  }

  async function handleDeleteConfirm() {
    const backdrop = document.getElementById("portal-delete-backdrop");
    if (!pendingDeleteIds || !pendingDeleteIds.length) {
      if (backdrop) backdrop.classList.add("hidden");
      return;
    }

    const ids = pendingDeleteIds.slice();
    pendingDeleteIds = [];

    try {
      const res = await fetch("/api/admin/reports/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // ignore non-JSON
      }

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      tests = tests.filter((t) => !ids.includes(Number(t.id)));
      renderTestsTable();
    } catch (err) {
      console.error("Failed to delete submissions:", err);
      alert("Error deleting submissions. Please try again.");
    } finally {
      if (backdrop) backdrop.classList.add("hidden");
    }
  }

  // -----------------------------------------------------------------------
  // Prompt overlay (separate modal used by mssShowPrompt)
  // -----------------------------------------------------------------------

  (function () {
    const overlay = document.getElementById("mssPromptOverlay");
    const modal = document.getElementById("mssPromptModal");
    const textarea = document.getElementById("mssPromptText");
    const closeBtn = document.getElementById("mssPromptClose");
    const copyBtn = document.getElementById("mssPromptCopy");
    const statusEl = document.getElementById("mssPromptStatus");

    function openPrompt(promptText) {
      if (!overlay || !modal || !textarea) return;
      textarea.value = promptText || "";
      overlay.hidden = false;
      modal.hidden = false;
      statusEl && (statusEl.textContent = "");
      textarea.focus();
      textarea.select();
    }

    function closePrompt() {
      if (!overlay || !modal) return;
      overlay.hidden = true;
      modal.hidden = true;
    }

    async function copyPrompt() {
      if (!textarea) return;
      const text = textarea.value;
      if (!text) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
        }
        if (statusEl) statusEl.textContent = "Prompt copied to clipboard.";
      } catch (err) {
        console.error("Copy failed:", err);
        if (statusEl)
          statusEl.textContent =
            "Unable to copy. Please select and copy manually.";
      }
    }

    if (closeBtn) closeBtn.addEventListener("click", closePrompt);
    if (copyBtn) copyBtn.addEventListener("click", copyPrompt);
    if (overlay) {
      overlay.addEventListener("click", closePrompt);
    }
    document.addEventListener("keydown", (e) => {
      const modalVisible = modal && !modal.hidden;
      if (e.key === "Escape" && modalVisible) {
        closePrompt();
      }
    });

    window.mssShowPrompt = openPrompt;
  })();
//============== Show AI report =================//
async function showAIReport(row) {
  if (!row || !row.id) return;

  const backdrop = document.getElementById("portal-transcript-backdrop");
  const body = document.getElementById("portal-transcript-body");
  const title = document.getElementById("portal-transcript-title");
  const subtitle = document.getElementById("portal-transcript-subtitle");
  const closeBtn = document.getElementById("portal-transcript-close");
  const okBtn = document.getElementById("portal-transcript-ok");

  if (!backdrop || !body) {
    alert("Viewer modal not found.");
    return;
  }

  LAST_ROW = row;

  const submittedAt = row.submitted_at || row.created_at || "";

  if (title) {
    title.textContent = "AI Report – " + formatShortDateTime(submittedAt || "");
  }

  if (subtitle) {
    subtitle.textContent = row.student_email
      ? row.student_email
      : row.student_id
      ? "Student #" + row.student_id
      : "";
  }

  body.textContent = "Generating report…";

  backdrop.classList.remove("hidden");

  const close = () => backdrop.classList.add("hidden");

  if (closeBtn && !closeBtn._mssBound) {
    closeBtn.addEventListener("click", close);
    closeBtn._mssBound = true;
  }
  if (okBtn && !okBtn._mssBound) {
    okBtn.addEventListener("click", close);
    okBtn._mssBound = true;
  }

  try {
    const res = await adminFetch(
      `/api/admin/ai-report/${encodeURIComponent(row.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}), // reserved for future options
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
      const msg =
        data.message ||
        data.error ||
        `AI report failed (HTTP ${res.status})`;
      body.textContent = "Error: " + msg;
      return;
    }

    body.textContent = data.reportText || "(No report text returned.)";
  } catch (err) {
    console.error("showAIReport failed:", err);
    body.textContent = "Error: " + (err.message || "AI report failed.");
  }
}
  // -----------------------------------------------------------------------
  // AI Prompt builder for a single submission row
  // -----------------------------------------------------------------------

// Server-owned prompts index (reuse existing aiPromptsCache defined earlier)
let aiPromptsById = new Map();

function setAiPromptsCache(prompts) {
  aiPromptsCache = Array.isArray(prompts) ? prompts : [];
  aiPromptsById = new Map(aiPromptsCache.map(p => [Number(p.id), p]));
}

// Simple Mustache-like renderer: replaces {{var}} with value (or "")
function renderTemplate(templateText, vars) {
  const tpl = String(templateText || "");
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v === null || v === undefined) return "";
    return String(v);
  });
}

// Normalize a submission row into the canonical placeholder set used by server templates
function varsFromSubmissionRow(row) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = row?.[k];
      if (v !== null && v !== undefined && v !== "") return v;
    }
    return "";
  };

  return {
    question:  pick("question"),
    transcript: pick("transcript", "transcript_clean", "clean_transcript", "transcriptClean"),
    student:   pick("student", "student_email", "studentEmail", "student_name", "studentName", "student_id"),

    // metrics
    wpm:         pick("wpm", "speed_wpm", "speed"),
    mss_fluency: pick("mss_fluency"),
    mss_pron:    pick("mss_pron"),
    mss_grammar: pick("mss_grammar"),
    mss_vocab:   pick("mss_vocab"),
    mss_cefr:    pick("mss_cefr", "cefr"),
    mss_toefl:   pick("mss_toefl", "toefl"),
    mss_ielts:   pick("mss_ielts", "ielts"),
    mss_pte:     pick("mss_pte", "pte"),
  };
}

// NEW: Use ONLY the server prompt template (ai_prompts.prompt_text)
function buildAIPromptFromRowUsingServerPrompt(row, promptId) {
  const pid = Number(promptId || 0);
  if (!pid) throw new Error("missing_prompt_id");

  const p = aiPromptsById.get(pid);
  if (!p || !p.prompt_text) throw new Error("prompt_not_loaded");

  const vars = varsFromSubmissionRow(row);
  return renderTemplate(p.prompt_text, vars).trim();
}

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------

  function handleLogout(event) {
    if (event) event.preventDefault();
    clearAdminSessionAndRedirect();
  }

//Dec 11
  // -----------------------------------------------------------------------
  // School selector change handler
  // -----------------------------------------------------------------------
 // Dec 16 — school switch with Cancel support (reverts selector)
async function onSchoolChanged(event) {
  const select = event?.target || schoolSelectEl;
  if (!select) return;

  const newSlug = select.value;
  const prevSlug = CURRENT_SLUG;

  if (!newSlug || newSlug === prevSlug) return;

  const newSchool = SCHOOLS.find((s) => String(s.slug) === String(newSlug));
  if (!newSchool) {
    console.warn("[SchoolPortal] onSchoolChanged: slug not in SCHOOLS:", newSlug);
    // safest: revert
    if (prevSlug) select.value = prevSlug;
    return;
  }

  const nextLabel =
    (select.selectedOptions && select.selectedOptions[0] && select.selectedOptions[0].textContent) ||
    (newSchool.name || newSchool.slug || newSlug);

  // Confirm first (Cancel means revert + abort)
  const ok = await confirmSchoolChange(nextLabel);
  if (!ok) {
    select.value = prevSlug;
    return;
  }

  console.log("[SchoolPortal] School changed:", { from: prevSlug, to: newSlug });

  // Optional warning modal about closing other tabs (OK-only)
  await showSchoolChangeWarning();

  // Proceed with switch
  CURRENT_SLUG = newSlug;
  CURRENT_SCHOOL = newSchool;

  // Keep URL in sync (helps refresh / deep links)
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("slug", newSlug);
    window.history.replaceState({}, "", u.toString());
  } catch (_) {}

  updateSlugUi();
  applySlugToQuickLinks();

  // Reload widget/dashboard + stats + reports for new school
  await fetchWidgetMeta();
  await fetchAssessmentMeta();
  await fetchStats("today");
  await fetchTests();
}

// -------------------------------------------------------------------------
// Global handler: any button with data-copy-modal copies current modal text
// -------------------------------------------------------------------------

document.addEventListener("click", async function (e) {
  const btn = e.target.closest("[data-copy-modal]");
  if (!btn) return;

  console.log("🔥 COPY BUTTON CLICKED");

 const activeModal =
  document.querySelector(".sp-modal-backdrop:not(.hidden) .sp-modal") ||
  document.querySelector("#mssPromptModal:not([hidden])") ||
  document.querySelector("#reportOverlay[style*='display: flex'] .modal") ||
  document.querySelector("#reportOverlay:not([aria-hidden='true']) .modal");

  if (!activeModal) {
    console.warn("No visible modal.");
    return;
  }

 const textEl =
  activeModal.querySelector("[data-copy-target]") ||
  activeModal.querySelector("#portal-transcript-body") ||
  activeModal.querySelector("#mssPromptText") ||
  activeModal.querySelector("#reportOutput");
  if (!textEl) {
    console.warn("No text element found in modal.");
    return;
  }

  const text = textEl.value || textEl.innerText || textEl.textContent || "";
  if (!text.trim()) {
    alert("Nothing to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    console.log("✅ Copied modal content");
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = "Copy to Clipboard"), 1500);
  } catch (err) {
    console.error("Clipboard error:", err);
    alert("Unable to copy—please copy manually.");
  }
});

  // -----------------------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------------------

  function wireEvents() {
   
    //Dec 29 
    wireReportViewerEvents();

    // Embed snippet copy
    if (btnCopyEmbed && !btnCopyEmbed._mssBound) {
      btnCopyEmbed.addEventListener("click", (ev) => {
        ev.preventDefault();
        console.log("📋 Copy embed clicked");
        copyEmbedToClipboard();
      });
      btnCopyEmbed._mssBound = true;
    }

// Admin Home
if (btnAdminHome && !btnAdminHome._mssBound) {
  btnAdminHome.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("🏠 Admin Home clicked");
    returnToAdminHome();
  });
  btnAdminHome._mssBound = true;
}

    // Widget/Dashboard tabs
    if (tabWidgetEl) {
      tabWidgetEl.addEventListener("click", () =>
        setActivePreviewTab("widget")
      );
    }
    if (tabDashboardEl) {
      tabDashboardEl.addEventListener("click", () =>
        setActivePreviewTab("dashboard")
      );
    }

    // Open Question Editor
    if (btnWidgetSurvey) {
      btnWidgetSurvey.addEventListener("click", () => {
        let url;
        if (assessmentId) {
          url = `/questions-admin/WidgetSurvey.html?assessmentId=${encodeURIComponent(
            assessmentId
          )}`;
        } else if (ASSESSMENT_ID_FROM_URL) {
          url = `/questions-admin/WidgetSurvey.html?assessmentId=${encodeURIComponent(
            ASSESSMENT_ID_FROM_URL
          )}`;
        } else {
          url = `/questions-admin/WidgetSurvey.html`;
        }
        window.open(url, "_blank");
      });
    }


//Dec 28 
  // Open the AI Prompt Manager
     // Dec 28 — Open the AI Prompt Manager (NEW)
   if (btnPromptManager) {
      btnPromptManager.addEventListener("click", () => {
      if (!CURRENT_SLUG) return;

      
       const url = `/admin-prompt/AIPromptManager.html?slug=${encodeURIComponent(CURRENT_SLUG)}`;
       window.open(url, "_blank");
       });
    }

    // Open Config Admin
    if (btnConfigAdmin && !btnConfigAdmin._mssBound) {
      btnConfigAdmin.addEventListener("click", () => {
        if (!CURRENT_SLUG) return;
        const url = `/config-admin/ConfigAdmin.html?slug=${encodeURIComponent(
          CURRENT_SLUG
        )}`;
        window.open(url, "_blank");
      });
    }


    // Timeframe toggle
    if (timeframeToggleEl) {
      timeframeToggleEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".timeframe-btn");
        if (!btn) return;
        const range = btn.dataset.range;
        if (!range) return;

        Array.from(
          timeframeToggleEl.querySelectorAll(".timeframe-btn")
        ).forEach((b) =>
          b.classList.toggle("active", b.dataset.range === range)
        );
        fetchStats(range);
      });
    }

    // Date validation
    if (filterFromEl) {
      filterFromEl.addEventListener("change", () => {
        validateDateRange();
      });
    }

    if (filterToEl) {
      filterToEl.addEventListener("change", () => {
        validateDateRange();
      });
    }

    // Delete modal buttons
    const deleteBackdrop = document.getElementById("portal-delete-backdrop");
    const deleteCancelBtn = document.getElementById("portal-delete-cancel");
    const deleteConfirmBtn = document.getElementById("portal-delete-confirm");

    if (deleteCancelBtn && deleteBackdrop) {
      deleteCancelBtn.addEventListener("click", () => {
        pendingDeleteIds = [];
        deleteBackdrop.classList.add("hidden");
      });
    }

    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener("click", handleDeleteConfirm);
    }

    // Tests / reports
    if (btnRefreshTests) {
      btnRefreshTests.addEventListener("click", fetchTests);
    }
    if (btnDownloadCsv) {
      btnDownloadCsv.addEventListener("click", downloadCsv);
    }
    if (btnDeleteSelected) {
      btnDeleteSelected.addEventListener("click", onDeleteSelected);
    }


    // School selector
    if (schoolSelectEl) {
      schoolSelectEl.addEventListener("change", onSchoolChanged);
    }

    // Table sort
    wireTableSorting();
  }


// -----------------------------------------------------------------------
// Drop-in replacement: wireReportViewerEvents()
// Fixes:
// 1) Ensures overlay captures clicks (prevents “mouse is behind” issues)
// 2) Wires Copy button for report output (Copy now works)
// 3) Keeps your safe _mssBound pattern (no stacked listeners)
// 4) Adds a small focus assist on open (optional but helpful)
// -----------------------------------------------------------------------

function wireReportViewerEvents() {
  const btnRun = document.getElementById("btnRunReport");
  const btnClose = document.getElementById("btnReportClose");
  const btnX = document.getElementById("reportCloseX");
  const btnDelete = document.getElementById("btnReportDelete");
  const btnCopy = document.getElementById("btnReportCopy");

  const ov = document.getElementById("reportOverlay");
  const modal = ov?.querySelector(".sp-modal"); // correct: reportOverlay uses .sp-modal
  const out = document.getElementById("reportOutput");

  console.log("✅ wireReportViewerEvents running");
  console.log("btnReportDelete exists?", !!btnDelete);

  // ------------------------------------------------------------
  // Defensive: ensure overlay actually intercepts pointer events
  // (prevents “cursor remains on screen behind” symptom)
  // ------------------------------------------------------------
  if (ov) {
    // If CSS is correct, these do nothing; if CSS regressed, they save you.
    ov.style.pointerEvents = "auto";
    ov.style.zIndex = ov.style.zIndex || "9999";
  }

  // Stop clicks inside modal from bubbling to overlay
  if (modal && !modal._mssBound) {
    modal.addEventListener("click", (e) => e.stopPropagation());
    modal._mssBound = true;
  }

  // ------------------------------------------------------------
  // Generate
  // ------------------------------------------------------------
  if (btnRun && !btnRun._mssBound) {
    btnRun.addEventListener("click", generateReport);
    btnRun._mssBound = true;
  }

  // ------------------------------------------------------------
  // Close buttons
  // ------------------------------------------------------------
  if (btnClose && !btnClose._mssBound) {
    btnClose.addEventListener("click", closeReportViewer);
    btnClose._mssBound = true;
  }

  if (btnX && !btnX._mssBound) {
    btnX.addEventListener("click", closeReportViewer);
    btnX._mssBound = true;
  }

  // ------------------------------------------------------------
  // Delete cached report
  // ------------------------------------------------------------
 // Delete button (no confirm)
if (btnDelete && !btnDelete._mssBound) {
  btnDelete.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    deleteCurrentReportFromViewer();
  });
  btnDelete._mssBound = true;
  console.log("✅ btnReportDelete bound");
}

  // ------------------------------------------------------------
  // Copy report output (THIS is why Copy wasn’t working)
  // ------------------------------------------------------------
  if (btnCopy && !btnCopy._mssBound) {
    btnCopy.addEventListener("click", async () => {
      try {
        const text = (out?.innerText || out?.textContent || "").trim();
        if (!text) {
          setReportStatus("Nothing to copy yet.", true);
          return;
        }

        // Prefer Clipboard API
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          // Fallback for non-secure contexts / older browsers
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          ta.style.top = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }

        setReportStatus("Copied ✓");
      } catch (e) {
        setReportStatus(`Copy failed: ${e?.message || "unknown"}`, true);
      }
    });
    btnCopy._mssBound = true;
  }

  // ------------------------------------------------------------
  // Click outside modal closes
  // ------------------------------------------------------------
  if (ov && !ov._mssBound) {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) closeReportViewer();
    });
    ov._mssBound = true;
  }

  // ------------------------------------------------------------
  // Escape closes (only when visible)
  // ------------------------------------------------------------
  if (!document._mssReportEscBound) {
    document.addEventListener("keydown", (e) => {
      const visible = ov && !ov.classList.contains("hidden");
      if (visible && e.key === "Escape") closeReportViewer();
    });
    document._mssReportEscBound = true;
  }

  // ------------------------------------------------------------
  // Optional: ensure focus lands inside the modal when it is open
  // (prevents weird “background focus” behavior)
  // ------------------------------------------------------------
  if (ov && !ov.classList.contains("hidden")) {
    setTimeout(() => btnRun?.focus?.(), 0);
  }
}
  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------

  function initDefaultDateFilters() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (filterToEl) filterToEl.value = todayStr;

    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const yyyy2 = weekAgo.getFullYear();
    const mm2 = String(weekAgo.getMonth() + 1).padStart(2, "0");
    const dd2 = String(weekAgo.getDate()).padStart(2, "0");
    if (filterFromEl) filterFromEl.value = `${yyyy2}-${mm2}-${dd2}`;
  }

async function init() {
    console.log("🔧 SchoolPortal init()");
    wireEvents();
    wireReportViewerEvents();
    initDefaultDateFilters();

    // ✅ Load admin session first; redirects to login if invalid
    const session = await loadAdminSession();
    if (!session) {
      return;
    }

    console.log("[SchoolPortal] Admin session in portal:", {
      ADMIN_EMAIL,
      ADMIN_ID,
    });
    
   if (!ADMIN_SESSION?.isSuper) {
     await ensureSlugFromSingleSchoolOrThrow();
   }
    await loadDashboardOptionsIntoSelect();
    initReportViewMode();

    await fetchSchoolsForAdmin();

    if (!CURRENT_SLUG) {
      console.warn("[SchoolPortal] No CURRENT_SLUG after fetchSchoolsForAdmin");
      return;
    }

    await fetchWidgetMeta();
    await fetchAssessmentMeta();
    await fetchStats("today");
    await fetchTests();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
