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
    const key = window.localStorage.getItem(ADMIN_KEY_STORAGE);
    // Avoid logging full key
    console.log("[SchoolPortal] getAdminKey →", maskKey(key));
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
async function adminFetch(url, options = {}) {
  const key = getAdminKey();
  const headers = new Headers(options.headers || {});
  if (key) {
    headers.set("x-mss-admin-key", key);
    headers.set("x-admin-key", key); // harmless if unused server-side
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
}

  function getLegacySession() {
    try {
      const raw = window.localStorage.getItem("mssAdminSession");
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

  const DEFAULT_ADMIN_HOME_URL = "/admin/AdminHome.html"; // change if needed

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
      window.localStorage.removeItem(ADMIN_KEY_STORAGE);
      window.localStorage.removeItem("mssAdminSession");
      window.localStorage.removeItem("MSS_ADMIN_SESSION");
      window.localStorage.removeItem("MSS_ADMIN_SESSION_V2");
      window.localStorage.removeItem("MSS_ADMIN_TOKEN");
      window.localStorage.removeItem("MSS_ADMIN_EMAIL");
    } catch (e) {
      console.warn("[SchoolPortal] Error clearing admin session", e);
    }

    window.location.href = ADMIN_LOGIN_URL;
  }

 // ✅ New: load admin session directly from localStorage.mssAdminSession
async function loadAdminSession() {
  const legacy = getLegacySession(); // reads mssAdminSession
  ADMIN_KEY = getAdminKey(); // may be null; ok

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
      select.addEventListener("change", () => {
        const value = select.value;
        if (!value) return;

        const id = select.dataset.id;
        if (!id) {
          select.value = "";
          return;
        }

        const row = tests.find((t) => String(t.id) === String(id));
        if (!row) {
          select.value = "";
          return;
        }

       if (value === "generate_report") {
         showAIReport(row);
       } else if (value === "transcript") {
        showTranscript(row);
       } else if (value === "dashboard") {
         openDashboardPickerForRow(row);
       }
        select.value = "";
      });
    });
  }

  // -----------------------------------------------------------------------
  // Transcript + AI Prompt modals
  // -----------------------------------------------------------------------

  function showPrompt(row) {
    if (!row) return;

    const promptText = buildAIPromptFromRow(row);

    const backdrop = document.getElementById("portal-transcript-backdrop");
    const body = document.getElementById("portal-transcript-body");
    const title = document.getElementById("portal-transcript-title");
    const subtitle = document.getElementById("portal-transcript-subtitle");
    const closeBtn = document.getElementById("portal-transcript-close");
    const okBtn = document.getElementById("portal-transcript-ok");

    if (!backdrop || !body) {
      alert(promptText || "No AI prompt available.");
      return;
    }

    LAST_ROW = row;
    LAST_AI_PROMPT = promptText;

    const submittedAt = row.submitted_at || row.created_at || "";

    if (title) {
      title.textContent =
        "AI Prompt – " + formatShortDateTime(submittedAt || "");
    }

    if (subtitle) {
      subtitle.textContent = row.student_name
        ? row.student_name
        : row.student_email
        ? row.student_email
        : row.student_id
        ? "Student #" + row.student_id
        : "";
    }

    body.textContent = promptText || "No AI prompt available.";

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

    document.addEventListener(
      "keydown",
      function escHandler(e) {
        if (e.key === "Escape") {
          close();
          document.removeEventListener("keydown", escHandler);
        }
      },
      { once: true }
    );
  }

  function showTranscript(row) {
    const transcript = (row && row.transcript_clean) || "";
    const question = (row && row.question) || "";

    const backdrop = document.getElementById("portal-transcript-backdrop");
    const body = document.getElementById("portal-transcript-body");
    const title = document.getElementById("portal-transcript-title");
    const subtitle = document.getElementById("portal-transcript-subtitle");
    const closeBtn = document.getElementById("portal-transcript-close");
    const okBtn = document.getElementById("portal-transcript-ok");

    if (!backdrop || !body) {
      const header = question ? `Question:\n\n${question}\n\n` : "";
      alert(header + (transcript || "No transcript available."));
      return;
    }

    LAST_ROW = row || null;

    const submittedAt = row?.submitted_at || row?.created_at || "";

    if (title) {
      title.textContent =
        "Transcript – " + formatShortDateTime(submittedAt || "");
    }

    if (subtitle) {
      subtitle.textContent = row?.student_name
        ? row.student_name
        : row?.student_email
        ? row.student_email
        : row?.student_id
        ? "Student #" + row.student_id
        : "";
    }

    let bodyText = "";
    if (question) {
      bodyText += "Question\n\n";
      bodyText += question + "\n\n";
    }
    bodyText += transcript || "No transcript available.";

    body.textContent = bodyText;

    if (row) {
      LAST_AI_PROMPT = buildAIPromptFromRow(row);
      console.log("🧠 AI prompt prepared for row", row.id);
    } else {
      LAST_AI_PROMPT = "";
    }

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

    document.addEventListener(
      "keydown",
      function escHandler(e) {
        if (e.key === "Escape") {
          close();
          document.removeEventListener("keydown", escHandler);
        }
      },
      { once: true }
    );
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

  function buildAIPromptFromRow(row) {
    const safe = (v, fallback = "N/A") =>
      v === null || v === undefined || v === "" ? fallback : v;

    const question = safe(row.question, "Not specified");
    const studentId = safe(
      row.student_email || row.studentEmail || row.student_name || row.studentName ||row.student_id,
      "Unknown student"
     );

    const taskScore = safe(row.task_score ?? row.task, "N/A");
    const speedWpm = safe(row.speed_wpm ?? row.speed ?? row.wpm, "N/A");

    const fluency = safe(row.mss_fluency);
    const pron = safe(row.mss_pron);
    const grammar = safe(row.mss_grammar);
    const vocab = safe(row.mss_vocab);

    const mssCefr = safe(row.mss_cefr ?? row.cefr);
    const mssToefl = safe(row.mss_toefl ?? row.toefl);
    const mssIelts = safe(row.mss_ielts ?? row.ielts);
    const mssPte = safe(row.mss_pte ?? row.pte);

    const defaultGoal =
      "reach a level of English that is strong enough for full-time work, admission to a college or university program, and higher scores on tests like TOEFL, IELTS, or PTE.";

    return `
Act as an experienced English tutor speaking directly to a student who has just completed a speaking task on the topic:

"${question}"

The submission belongs to: ${studentId}.

Here are this student's MSS speaking results:

- Speed: ${speedWpm} words per minute
- Fluency: ${fluency} / 100
- Pronunciation: ${pron} / 100
- Grammar: ${grammar} / 100
- Vocabulary: ${vocab} / 100
- Overall level: CEFR ${mssCefr}
- Estimated TOEFL Speaking: ${mssToefl} / 30
- Estimated IELTS Speaking: ${mssIelts} / 9
- Estimated PTE Speaking: ${mssPte} / 100

The student's general goal is to ${defaultGoal}

Please do TWO things:

1) FEEDBACK REPORT  
Write a structured feedback report directly to the student in the second person ("you"), in English.  
Include:
- Relevance of the answer to the question - is it logical and concise?
- A short overall summary (2–3 sentences) of what these results mean.  
- 2–3 clear strengths.  
- 3–5 key areas for improvement, focusing especially on the lowest scores (for example pronunciation, fluency, etc.).  
- Concrete practice suggestions the student can start this week (specific exercises, how often to practice, what to pay attention to).

2) EMAIL TO THE STUDENT  
Write a separate email that a teacher at the school could send to this student.  
The email should:
- Have a short, clear subject line.  
- Greet the student politely.  
- Briefly summarize their current level using simple language (for example: "You are around CEFR ${mssCefr}, which means…").  
- Highlight why it would be helpful for them to work with a professional tutor at the school.  
- Invite them to sign up for lessons, a consultation, or a short trial, and mention that improving their English will help them reach goals like study abroad, job interviews, or passing TOEFL/IELTS/PTE.  
- End with a warm, encouraging closing.

Tone: warm, encouraging, and professional. Be honest about the work needed, but remember that as a teacher you also depend on motivated students signing up for lessons.
`.trim();
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
  // -----------------------------------------------------------------------
  // Event wiring
  // -----------------------------------------------------------------------

  function wireEvents() {
   

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

    // Open Config Admin
    if (btnConfigAdmin) {
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

// -------------------------------------------------------------------------
// Global handler: any button with data-copy-modal copies current modal text
// -------------------------------------------------------------------------

document.addEventListener("click", async function (e) {
  const btn = e.target.closest("[data-copy-modal]");
  if (!btn) return;

  console.log("🔥 COPY BUTTON CLICKED");

  const activeModal =
    document.querySelector(".sp-modal:not(.hidden)") ||
    document.querySelector("#mssPromptModal:not([hidden])");

  if (!activeModal) {
    console.warn("No visible modal.");
    return;
  }

  let textEl =
    activeModal.querySelector("#portal-transcript-body") ||
    activeModal.querySelector("#mssPromptText");

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