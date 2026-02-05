// MSS Ingle Core v1.0 — Feb 1 2026 

console.log("✅ ingle-core.js loaded");

"use strict";

// Simple ID helper
const $ = (id) => document.getElementById(id);
// --- INGLE_STATE must exist globally before any handlers use it ---
const CEFR_LEVELS = ["ALL", "A1", "A2", "B1", "B2", "C1", "C2"];

const INGLE_STATE = {
  feed: { dateKey: null, items: [], lastFetchedAt: 0 },
  filter: { cefr: "ALL", mode: "all" },
  followedHandles: new Set(),
  myLastCefr: null,
};

// Expose for debugging and for any other scripts
window.INGLE_STATE = INGLE_STATE;

/* -----------------------------------------------------------------------
   GLOBAL STATE
   ----------------------------------------------------------------------- */

let FORM = null;
let CONFIG = null;
let SCHOOL_ID = null;
let QUESTIONS = [];

let CURRENT_SLUG = null;
let idx = 0;

let HELP_LEVEL = 0;          // 0 = no help, 1 = min, 2 = max (slider widget)
let SESSION_LOCKED = false;  // when true, no more record/upload for THIS question

// Widget layout mode: "default" or "readmax" (read-and-record with full model answer)
let WIDGET_MODE = "default";

// Dashboard popup (fallback)
let dashboardWindow = null;

// WAV recording state
let audioContext = null;
let micStream = null;
let inputNode = null;
let processor = null;
let recording = false;
let recordingChunks = [];
let t0 = 0;
let tick = null;

// Blob / playback state
let blob = null;
let blobName = null;
let objectUrl = null;

// Duration tracking (seconds) for WPM
let LAST_AUDIO_LENGTH_SEC = null;   // number | null
let LAST_AUDIO_SOURCE = null; // "recording" | "upload_wav" | "upload_mp3" | null

// Per-question help cache for WidgetMin + WidgetMax / READMAX
// questionId -> { min: string, max: string }
const HELP_CACHE = {};


/* -----------------------------------------------------------------------
   BACKEND BASE (Node / Render)
   ----------------------------------------------------------------------- */

// Where are the Node/Render APIs that power /api/widget, /log/submission, etc.?
//  - Localhost: same origin (http://localhost:3000)
//  - Render app: same origin (app + API together)
//  - Vercel static hosting: call Render explicitly
  
  const BACKEND_BASE = (() => {
  const h = window.location.hostname || "";

  // Local dev: Express serves both static + APIs
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local")
  ) {
    return ""; // same origin
  }

  // Vercel: static only → talk to Render backend
  if (h.endsWith(".vercel.app")) {
    return "https://mss-widget-mt.onrender.com";
  }

  // Default: assume same-origin (Render app or other Node host)
  return "";
})();

/* -----------------------------------------------------------------------
   Auto-resize: notify parent page of our height Dec 6
   ----------------------------------------------------------------------- */

function mssNotifyParentOfHeight() {
  try {
    // Only do this if we're actually inside an iframe
    if (window.parent === window) return;

    const doc = document.documentElement;
    if (!doc) return;

    // Use scrollHeight as our best “full content” height
    const height = doc.scrollHeight;
    if (!height || !Number.isFinite(height)) return;

    window.parent.postMessage(
      {
        source: "mss-widget",
        height,
      },
      "*"
    );
  } catch (err) {
    console.warn("[MSS Widget] Unable to post height to parent", err);
  }
}

// Fire once on load and again on resize
window.addEventListener("load", () => {
  mssNotifyParentOfHeight();

  // A short delayed ping in case fonts/layout shift after load
  setTimeout(mssNotifyParentOfHeight, 500);
});

window.addEventListener("resize", () => {
  mssNotifyParentOfHeight();
});

// Optional: watch DOM size changes more closely
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => {
    mssNotifyParentOfHeight();
  });
  ro.observe(document.documentElement);
}

/* -----------------------------------------------------------------------
   API ENDPOINTS
   ----------------------------------------------------------------------- */

const API = {
  // Node / Render widget backend (Bootstrap, logs, help, DB submit)
  BOOTSTRAP: `${BACKEND_BASE}/api/widget`,        // /api/widget/:slug/bootstrap
  LOG: `${BACKEND_BASE}/api/widget/log`,
  HELP: `${BACKEND_BASE}/api/widget/help`,

  // JSON-only DB submit (NOT the MSS scoring call)
  DB_SUBMIT: `${BACKEND_BASE}/api/widget/submit`,

  // CSV / legacy submission logger
  CSV_LOG: `${BACKEND_BASE}/log/submission`,

  // Fallback for scoring if no api.baseUrl/submitUrl are configured.
  // Use BACKEND_BASE so Vercel → Render, localhost/Render → same origin.
  SUBMIT_FALLBACK: `${BACKEND_BASE}/api/widget/submit`,
};

// ---------- Help + variant helpers ----------

// 1) Which widget file are we? (Widget, WidgetMin, WidgetMax, etc.)
function getWidgetVariant() {
  try {
    const path = window.location.pathname || "";
    const file = path.split("/").pop() || "Widget.html";
    // Strip ".html" and return name only
    return file.replace(/\.html$/i, "");
  } catch {
    return "Widget";
  }
}

// 2) Where is help being shown? (slider vs dedicated min/max widget)
function getHelpSurface() {
  const variant = getWidgetVariant().toLowerCase();

  if (variant.includes("min")) return "min_widget";
  if (variant.includes("max")) return "max_widget";

  // default widget with slider
  return "slider";
}

// 3) Final help level at submit time
//    - Dedicated min/max widgets force min/max
//    - Slider uses HELP_LEVEL 0/1/2
function getHelpLevelForSubmit() {
  const variant = getWidgetVariant().toLowerCase();

  // Dedicated variants override slider
  if (variant.includes("min")) return "min";
  if (variant.includes("max")) return "max";

  // Slider-based widget: map HELP_LEVEL 0/1/2
  if (typeof HELP_LEVEL === "number") {
    if (HELP_LEVEL >= 2) return "max";
    if (HELP_LEVEL >= 1) return "min";
  }
  return "none";
}

// 4) Which dashboard is the student seeing?
function getDashboardVariant() {
  try {
    const path = getDashboardPath(); // no body override needed here
    if (!path) return "default";

    const file = (path.split("/").pop() || "").toLowerCase();
    return file.replace(/\.html$/i, "") || "default";
  } catch (e) {
    console.warn("getDashboardVariant error:", e);
    return "default";
  }
}

// Default dashboard if none is configured
const DEFAULT_DASHBOARD_PATH = "/dashboards/Dashboard3.html"; // or 4, your call

function getDashboardPath(bodyDashboardUrl) {
  // 1) ConfigAdmin / DB wins
  if (CONFIG && (CONFIG.dashboardPath || CONFIG.dashboardUrl)) {
    return CONFIG.dashboardPath || CONFIG.dashboardUrl;
  }

  // 2) MSS response fallback (remote or legacy config)
  if (bodyDashboardUrl) return bodyDashboardUrl;

  // 3) Hard-coded default
  return DEFAULT_DASHBOARD_PATH;
}

/* -----------------------------------------------------------------------
   STARTUP
   ----------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  try {
    initWidget();
  } catch (err) {
    console.error("Widget init error:", err);
    setStatus("Widget failed to initialize. Please refresh and try again.");
  }
});

function isLocalHost() {
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local")
  );
}

/* -----------------------------------------------------------------------
   CORE HELPERS
   ----------------------------------------------------------------------- */

function setStatus(msg) {
  const statusEl = $("status");
  if (statusEl) {
    statusEl.textContent = msg || "";
  } else {
    console.log("STATUS:", msg);
  }
}

function logEvent(type, payload) {
  try {
    const data = {
      type,
      slug: CURRENT_SLUG,
      questionId: currentQuestion()?.id || null,
      ts: new Date().toISOString(),
      ...payload,
    };

    const url = API.LOG || "/api/widget/log";

    // Work out if the log URL is same-origin or cross-origin
    let sameOrigin = true;
    try {
      const logUrl = new URL(url, window.location.origin);
      sameOrigin = logUrl.origin === window.location.origin;
    } catch {
      sameOrigin = true; // be permissive; worst case we treat as same-origin
    }

    // ✅ Same-origin → safe to use sendBeacon (no CORS issues)
    if (sameOrigin && navigator.sendBeacon) {
      const b = new Blob([JSON.stringify(data)], {
        type: "application/json",
      });
      navigator.sendBeacon(url, b);
      return;
    }

    // 🌐 Cross-origin (e.g., Vercel → Render) → use fetch with credentials *omitted*
    fetch(url, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      keepalive: true,
    }).catch(() => {
      // Logging is best-effort only – ignore errors
    });
  } catch (err) {
    console.warn("logEvent error:", err);
  }
}

function setRecordingUiEnabled(enabled) {
  const recBtn    = $("recBtn");
  const stopBtn   = $("stopBtn");
  const fileInput = $("fileInput");
  const submitBtn = $("submitBtn");

  const disabled = !enabled;

  if (recBtn)    recBtn.disabled    = disabled;
  if (stopBtn)   stopBtn.disabled   = disabled || !recording;
  if (fileInput) fileInput.disabled = disabled;
  if (submitBtn) submitBtn.disabled = disabled || !blob;
}

function getSlugFromUrlOrRoot() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const slugFromQuery = (params.get("slug") || "").trim();
    if (slugFromQuery) return slugFromQuery;
  } catch {
    // ignore
  }

  const root = $("mss-widget-root");
  if (root && root.dataset && root.dataset.schoolSlug) {
    return root.dataset.schoolSlug.trim();
  }

  if (window.mssWidgetSlug) {
    return String(window.mssWidgetSlug).trim();
  }

  return "mss-demo";
}

/* Submit spinner helpers */
function showSubmitProgress() {
  const el = $("submitProgress");
  if (el) el.classList.remove("mss-hidden");
}

function hideSubmitProgress() {
  const el = $("submitProgress");
  if (el) el.classList.add("mss-hidden");
}

/* Dashboard helpers */
function collapseDashboard() {
  const container = $("dashboardContainer");
  if (!container) return;
  container.classList.remove("mss-dashboard-visible", "mss-dashboard-expanded");
  container.classList.add("mss-dashboard-hidden", "mss-dashboard-collapsed");
}

function expandDashboard(url, sessionId) {
  const container = $("dashboardContainer");
  if (!container) return false;

  const bodyEl = $("dashboardBody") || container;

  let iframe = $("dashboardFrame");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "dashboardFrame";
    iframe.title = "MSS Score Results";
    iframe.setAttribute("loading", "lazy");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    bodyEl.appendChild(iframe);
  }

  iframe.src = url;

  container.classList.remove("mss-dashboard-hidden", "mss-dashboard-collapsed");
  container.classList.add("mss-dashboard-visible", "mss-dashboard-expanded");

  try {
    logEvent("dashboard_inline_open", { sessionId, url });
  } catch (_) {}

  return true;
}

/* Dashboard init: keep panel present but collapsed on load */
function initDashboardContainer() {
  const container = $("dashboardContainer");
  if (!container) return;

  container.classList.add("mss-dashboard-hidden", "mss-dashboard-collapsed");

  const closeBtn = $("dashboardCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      collapseDashboard();
      try {
        logEvent("dashboard_closed", {});
      } catch (_) {}
    });
  }
}

/* -----------------------------------------------------------------------
   HELP FETCHING (shared for WidgetMin + WidgetMax)
   ----------------------------------------------------------------------- */

// Fetch min/max help text for a given questionId, cached in HELP_CACHE
async function fetchHelpForQuestion(questionId) {
  const qid = Number(questionId);
  if (!Number.isInteger(qid) || qid <= 0) {
    return { min: "", max: "" };
  }

  if (HELP_CACHE[qid]) {
    return HELP_CACHE[qid];
  }

  try {
    // 🔁 use API.HELP so Vercel → Render works
    const res = await fetch(API.HELP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: CURRENT_SLUG,
        questionId: qid,
        level: 2, // ask server for both min & max
      }),
    });

    if (!res.ok) {
      console.warn("fetchHelpForQuestion HTTP", res.status);
      HELP_CACHE[qid] = { min: "", max: "" };
      return HELP_CACHE[qid];
    }

    const json = await res.json();
    if (!json || json.ok === false) {
      console.warn("fetchHelpForQuestion response error", json);
      HELP_CACHE[qid] = { min: "", max: "" };
      return HELP_CACHE[qid];
    }

    const min =
      (json.minhelp || json.min || "").toString().trim();
    const max =
      (json.maxhelp || json.max || "").toString().trim();

    HELP_CACHE[qid] = { min, max };

    console.log("[HELP] cache set for qid", qid, {
      minLen: min.length,
      maxLen: max.length,
    });

    return HELP_CACHE[qid];
  } catch (err) {
    console.error("fetchHelpForQuestion exception:", err);
    HELP_CACHE[qid] = { min: "", max: "" };
    return HELP_CACHE[qid];
  }
}

/* -----------------------------------------------------------------------
   INIT / BOOTSTRAP
   ----------------------------------------------------------------------- */

function initWidget() {
  const root = $("mss-widget-root");
  if (!root) {
    console.error("No #mss-widget-root found");
    return;
  }

  CURRENT_SLUG = getSlugFromUrlOrRoot();
  root.dataset.schoolSlug = CURRENT_SLUG;

  // NEW: read widget mode from data-widget-mode
  WIDGET_MODE = root.dataset.widgetMode || "default";
  // safety: infer ingle mode from class or slug
  if (WIDGET_MODE === "default" && (root.classList.contains("ingle") || CURRENT_SLUG === "ingle")) {
    WIDGET_MODE = "ingle";
  }

  console.log("🎯 Active widget slug:", CURRENT_SLUG, "| mode:", WIDGET_MODE);

  wireUiEvents();
  bootstrapWidget();
}
function getTaskTokenFromUrl() {
  try {
    const p = new URLSearchParams(window.location.search || "");
    return String(
      p.get("task") ||
      p.get("task_token") ||
      p.get("token") ||
      ""
    ).trim();
  } catch {
    return "";
  }
}

function bootstrapWidget() {
  CURRENT_SLUG = getSlugFromUrlOrRoot();
  console.log("🚀 Bootstrapping widget for slug:", CURRENT_SLUG, "| mode:", WIDGET_MODE);
  setStatus("Loading…");

  // ✅ If Ingle mode, do NOT call /api/widget/:slug/bootstrap
  if (String(WIDGET_MODE || "").toLowerCase() === "ingle") {
    return bootstrapIngle();
  }

  const taskToken = getTaskTokenFromUrl();

  const url = taskToken
    ? `/api/task/${encodeURIComponent(taskToken)}?ts=${Date.now()}`
    : `${API.BOOTSTRAP}/${encodeURIComponent(CURRENT_SLUG)}/bootstrap?ts=${Date.now()}`;

  fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Bootstrap HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      FORM = data.form || {};
      CONFIG = data.config || {};
      SCHOOL_ID = data.schoolId || data.SCHOOL_ID || null;
      QUESTIONS = Array.isArray(data.questions) ? data.questions : [];

      // imageUrl from bootstrap
      if (data.image && data.image.url) {
        CONFIG.imageUrl = data.image.url;
        if (!CONFIG.imageAlt && data.image.alt) {
          CONFIG.imageAlt = data.image.alt;
        }
      } else if (data.imageUrl) {
        CONFIG.imageUrl = data.imageUrl;
      }
      if (data.imageAlt && !CONFIG.imageAlt) {
        CONFIG.imageAlt = data.imageAlt;
      }

      if (data.assessmentId || data.ASSESSMENT_ID) {
        CONFIG.assessmentId = data.assessmentId || data.ASSESSMENT_ID;
      }

      console.log("📦 Bootstrapped:", {
        SCHOOL_ID,
        ASSESSMENT_ID: CONFIG.assessmentId || null,
        questionsCount: QUESTIONS.length,
      });

      if (!QUESTIONS.length) {
        throw new Error("No questions returned from DB.");
      }

      const hasDbApi = CONFIG.api && CONFIG.api.key && CONFIG.api.secret;

      if (!hasDbApi && isLocalHost()) {
        console.log("🔎 No API creds in DB config; local dev → fetching /config/widget…");
        return fetch("/config/widget")
          .then((r) => {
            if (!r.ok) throw new Error(`/config/widget HTTP ${r.status}`);
            return r.json();
          })
          .then((legacyCfg) => {
            CONFIG.api = CONFIG.api || {};
            if (!CONFIG.api.key && legacyCfg.api?.key) CONFIG.api.key = legacyCfg.api.key;
            if (!CONFIG.api.secret && legacyCfg.api?.secret) CONFIG.api.secret = legacyCfg.api.secret;
            if (!CONFIG.api.baseUrl && legacyCfg.api?.baseUrl) CONFIG.api.baseUrl = legacyCfg.api.baseUrl;
            if (!CONFIG.submitUrl && legacyCfg.submitUrl) CONFIG.submitUrl = legacyCfg.submitUrl;
            if (!CONFIG.dashboardUrl && legacyCfg.dashboardUrl) CONFIG.dashboardUrl = legacyCfg.dashboardUrl;
            finishBootstrap();
          })
          .catch((err) => {
            console.warn("Dev /config/widget fallback failed; continuing with DB config:", err);
            finishBootstrap();
          });
      }

      finishBootstrap();
    })
    .catch((err) => {
      console.error("Bootstrap error:", err);
      setStatus("We could not load this widget. Please contact your school.");
    });
}
function bootstrapIngle() {
  // Ingle uses its own question loading (/api/ingles/today),
  
  FORM = FORM || {};
  CONFIG = CONFIG || {};
  CONFIG.api = CONFIG.api || {};

  // Ingle bank school id
  SCHOOL_ID = 9999;

  // Seed a single “current question” so currentQuestion() has something.
  // ingle-core will update window.QUESTIONS when it loads Today/Tomorrow.
  if (!Array.isArray(QUESTIONS) || !QUESTIONS.length) {
    const qText = String(document.getElementById("question")?.textContent || "").trim();
    QUESTIONS = [
      { id: 1, question: qText || "Ingle question (loading…)" }
    ];
  }

  // Local dev: pull Vox API creds from /config/widget (same fallback as normal bootstrap)
  if (isLocalHost()) {
    return fetch("/config/widget")
      .then((r) => (r.ok ? r.json() : null))
      .then((legacyCfg) => {
        if (legacyCfg?.api) {
          if (!CONFIG.api.key && legacyCfg.api.key) CONFIG.api.key = legacyCfg.api.key;
          if (!CONFIG.api.secret && legacyCfg.api.secret) CONFIG.api.secret = legacyCfg.api.secret;
          if (!CONFIG.api.baseUrl && legacyCfg.api.baseUrl) CONFIG.api.baseUrl = legacyCfg.api.baseUrl;
        }
        if (!CONFIG.submitUrl && legacyCfg?.submitUrl) CONFIG.submitUrl = legacyCfg.submitUrl;
        if (!CONFIG.dashboardUrl && legacyCfg?.dashboardUrl) CONFIG.dashboardUrl = legacyCfg.dashboardUrl;

        console.log("🟣 Ingle bootstrap:", {
          SCHOOL_ID,
          hasApi: !!(CONFIG.api && CONFIG.api.key && CONFIG.api.secret),
          apiBaseUrl: CONFIG.api?.baseUrl || null,
        });

        finishBootstrap();
      })
      .catch((err) => {
        console.warn("🟣 Ingle bootstrap: /config/widget failed; continuing:", err);
        finishBootstrap();
      });
  }

  console.log("🟣 Ingle bootstrap (no server config fetch).");
  finishBootstrap();
}
//Dec 25
async function getAudioDurationSecFromFile(fileOrBlob) {
  // Uses <audio> metadata; works well for wav/mp3.
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;

    await new Promise((resolve, reject) => {
      a.onloadedmetadata = () => resolve();
      a.onerror = () => reject(new Error("audio metadata load failed"));
    });

    const d = Number(a.duration);
    return Number.isFinite(d) && d > 0 ? Number(d.toFixed(3)) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
//Dec 6
// Helper: accept either a Blob/File or a blob: URL string
async function ensureFileFromBlobLike(blobLike, fileName) {
  if (blobLike instanceof Blob) {
    return new File([blobLike], fileName, {
      type: blobLike.type || "audio/wav",
    });
  }

  if (typeof blobLike === "string") {
    const res = await fetch(blobLike);
    if (!res.ok) {
      throw new Error("Failed to fetch audio data from blob URL");
    }
    const fetchedBlob = await res.blob();
    return new File([fetchedBlob], fileName, {
      type: fetchedBlob.type || "audio/wav",
    });
  }

  throw new Error("Unsupported recording blob type");
}


function finishBootstrap() {
  applyBrandingFromForm();
  applyFormLabelsFromForm();
  applyConfigTheme();
  initDashboardContainer();
  applyConfigFeatureFlags();

  // honour config.widgetEnabled flag if present
  if (CONFIG && CONFIG.widgetEnabled === false) {
    const root = $("mss-widget-root");
    if (root) root.classList.add("mss-widget-disabled");

    const msg =
      CONFIG.maintenanceMessage ||
      "This practice widget is temporarily unavailable. Please check back later or contact your school.";
    setStatus(msg);

    setRecordingUiEnabled(false);
    SESSION_LOCKED = true;
    return;
  }

  idx = 0;
  renderQuestion();
  setStatus("Ready to record when you are.");

  // Ingle-only: init filter UI if present
try { initFeedFilters(); } catch (e) { console.warn("initFeedFilters failed:", e); }

// If Ingle has a dateKey ready, refresh feed once on load
try {
  const dk = window.__INGLE_DATEKEY;
  if (dk) refreshLiveFeed(dk, 50).catch(()=>{});
} catch {}
}

/* -----------------------------------------------------------------------
   BRANDING / THEME / LABELS
   ----------------------------------------------------------------------- */

function applyBrandingFromForm() {
  const brandEl   = $("brand");
  const poweredEl = $("powered");

  const headline =
    CONFIG?.title ||
    FORM?.headline ||
    FORM?.name ||
    "MySpeakingScore – Speaking Practice";

  const subtitle =
    CONFIG?.subtitle ||
    FORM?.poweredByLabel ||
    FORM?.description ||
    "Get instant feedback on your speaking";

  if (brandEl)   brandEl.textContent = headline;
  if (poweredEl) poweredEl.textContent = subtitle;

  const brandImg =
    $("brandImg") ||
    $("brandLogo") ||
    $("brandLogoImg");

  const brandSrc =
    CONFIG?.imageUrl ||
    CONFIG?.image?.url ||
    CONFIG?.brandDataUrl ||
    CONFIG?.logoDataUrl ||
    CONFIG?.brand?.src ||
    CONFIG?.logo?.src;

  if (brandImg && brandSrc) {
    if (brandImg.tagName === "IMG") {
      brandImg.src = brandSrc;
      brandImg.style.objectFit = "contain";
    } else {
      brandImg.style.backgroundImage = `url(${brandSrc})`;
      brandImg.textContent = "";
    }
  }

  const brandAlt =
    CONFIG?.image?.alt ||
    CONFIG?.brandAlt ||
    CONFIG?.imageAlt ||
    CONFIG?.logoAlt ||
    FORM?.imageAlt ||
    "School logo";

  if (brandImg && brandAlt && brandImg.tagName === "IMG") {
    brandImg.alt = brandAlt;
  }

  console.log("🧷 branding applied:", {
    headline,
    subtitle,
    brandSrc,
    brandAlt,
  });
}

function applyFormLabelsFromForm() {
  if (!FORM) return;

  const prevBtn   = $("prevBtn");
  const nextBtn   = $("nextBtn");
  const recBtn    = $("recBtn");
  const stopBtn   = $("stopBtn");
  const submitBtn = $("submitBtn");
  const recState  = $("recState");

  if (prevBtn && FORM.previousButton) {
    prevBtn.textContent = FORM.previousButton;
  }
  if (nextBtn && FORM.nextButton) {
    nextBtn.textContent = FORM.nextButton;
  }
  if (recBtn && FORM.recordButton) {
    recBtn.textContent = FORM.recordButton;
  }
  if (stopBtn && FORM.stopButton) {
    stopBtn.textContent = FORM.stopButton;
  }
  if (submitBtn && FORM.SubmitForScoringButton) {
    submitBtn.textContent = FORM.SubmitForScoringButton;
  }
  if (recState && FORM.NotRecordingLabel) {
    recState.textContent = FORM.NotRecordingLabel;
  }

  const uploadLabelSpan = document.querySelector(".mss-upload-label span");
  if (uploadLabelSpan && FORM.uploadButton) {
    uploadLabelSpan.textContent = FORM.uploadButton;
  }

  const helpBtn = $("helpBtn");
  if (helpBtn && FORM.questionHelpButton) {
    helpBtn.textContent = FORM.questionHelpButton;
  }
}

function applyConfigTheme() {
  if (!CONFIG) return;
  if (CONFIG.primaryColor || CONFIG.accentColor) {
    const accent = CONFIG.primaryColor || CONFIG.accentColor;
    document.documentElement.style.setProperty("--mss-accent", accent);
  }
}

/**
 * Feature flags that depend on CONFIG:
 * - allowUpload (hide upload row completely when false)
 * - allowRecording (hide recording controls when false)
 */
function applyConfigFeatureFlags() {
  let uploadFlag;
  if (typeof CONFIG?.allowUpload === "boolean") {
    uploadFlag = CONFIG.allowUpload;
  } else if (typeof CONFIG?.Permitupload === "boolean") {
    uploadFlag = CONFIG.Permitupload;
  } else {
    uploadFlag = true;
  }

  const allowUpload    = !!uploadFlag;
  const allowRecording = CONFIG?.allowRecording !== false;

  console.log("📁 upload/record flags:", {
    allowUpload,
    rawAllowUpload: CONFIG?.allowUpload,
    permitUploadLegacy: CONFIG?.Permitupload,
    allowRecording,
  });

  const uploadRow = document.querySelector(".mss-upload-row");
  const fileInput = $("fileInput");
  const clearBtn  = $("clearFileBtn");

  if (uploadRow) {
    uploadRow.style.display = allowUpload ? "" : "none";
  }
  if (fileInput) {
    fileInput.disabled = !allowUpload;
  }
  if (clearBtn) {
    clearBtn.disabled = !allowUpload;
  }

  const recBtn  = $("recBtn");
  const stopBtn = $("stopBtn");

  if (!allowRecording) {
    if (recBtn)  recBtn.style.display  = "none";
    if (stopBtn) stopBtn.style.display = "none";
  } else {
    if (recBtn)  recBtn.style.display  = "";
    if (stopBtn) stopBtn.style.display = "";
  }
}

/* -----------------------------------------------------------------------
   UI EVENT WIRING
   ----------------------------------------------------------------------- */

function wireUiEvents() {
  // Nav
  $("prevBtn")?.addEventListener("click", onPrevQuestion);
  $("nextBtn")?.addEventListener("click", onNextQuestion);

  // Recording
  $("recBtn")?.addEventListener("click", onRecordClick);
  $("stopBtn")?.addEventListener("click", onStopClick);

  // File upload
  $("fileInput")?.addEventListener("change", onUploadChange);

  // Submit
  $("submitBtn")?.addEventListener("click", onSubmitClick);

  // Help slider (baseline widget only – not present in WidgetMin/Max)
  $("helpSlider")?.addEventListener("input", onHelpSliderChange);

  // Help button:
  //  - If WidgetMax panel exists → toggle that
  //  - Else fallback to MSSHelp overlay (Widget.html)
  $("helpBtn")?.addEventListener("click", () => {
    const panel = $("maxHelpPanel");
    if (panel) {
      const isOpen = !panel.classList.contains("mss-hidden");
      if (isOpen) {
        closeMaxHelpPanel();
      } else {
        openMaxHelpPanel();
      }
      return;
    }

    // Legacy MSSHelp overlay (Widget.html with slider)
    if (!window.MSSHelp) return;
    const q = currentQuestion();
    if (!q) return;

    const level = HELP_LEVEL || 1;
    if (window.MSSHelp.setLevel) {
      window.MSSHelp.setLevel(level, {
        slug: CURRENT_SLUG,
        schoolId: SCHOOL_ID,
        questionId: q.id,
        questionIndex: idx + 1,
        totalQuestions: QUESTIONS.length || 1,
        widgetVariant: CONFIG.widgetVariant || "default",
      });
    }
    if (window.MSSHelp.open) {
      window.MSSHelp.open({
        slug: CURRENT_SLUG,
        schoolId: SCHOOL_ID,
        questionId: q.id,
        question: q.question || q.text || "",
        level,
      });
    }
  });

  // Inline Min Help (WidgetMin only – safe no-op if elements don’t exist)
  const minHelpToggle = $("minHelpToggle");
  const minHelpPanel  = $("minHelpPanel");

  if (minHelpToggle && minHelpPanel) {
    minHelpToggle.addEventListener("click", () => {
      const isOpen = !minHelpPanel.classList.contains("mss-hidden");

      if (isOpen) {
        minHelpPanel.classList.add("mss-hidden");
        minHelpPanel.setAttribute("aria-hidden", "true");
        minHelpToggle.textContent =
          FORM?.minHelpToggleLabelShow || "Show help";
      } else {
        minHelpPanel.classList.remove("mss-hidden");
        minHelpPanel.setAttribute("aria-hidden", "false");
        minHelpToggle.textContent =
          FORM?.minHelpToggleLabelHide || "Hide help";
      }
    });
  }
}

/* -----------------------------------------------------------------------
   QUESTION RENDERING / NAV
   ----------------------------------------------------------------------- */

function currentQuestion() {
  if (!QUESTIONS.length) return null;
  return QUESTIONS[Math.max(0, Math.min(idx, QUESTIONS.length - 1))];
}

// Inline MIN-help panel (WidgetMin) – per-question MIN help
function renderMinHelpPanel() {
  const minHelpPanel  = $("minHelpPanel");
  const minHelpBody   = $("minHelpBody");
  const minHelpIntro  = $("minHelpInstructions");
  const minHelpToggle = $("minHelpToggle");

  if (!minHelpPanel || !minHelpBody) return;

  const q = currentQuestion();
  if (!q) return;

  // Instructions from ConfigAdmin (FORM.instructions)
  if (minHelpIntro) {
    const inst = FORM?.instructions || "";
    if (inst) {
      if (/<[a-z][\s\S]*>/i.test(inst)) {
        minHelpIntro.innerHTML = inst;
      } else {
        minHelpIntro.innerHTML = escapeHtml(inst).replace(
          /\r|\n/g,
          "<br>"
        );
      }
    } else {
      minHelpIntro.textContent =
        "Read this short example before you answer.";
    }
  }

  // Start panel collapsed on each new question
  minHelpPanel.classList.add("mss-hidden");
  minHelpPanel.setAttribute("aria-hidden", "true");

  if (minHelpToggle) {
    minHelpToggle.textContent =
      FORM?.minHelpToggleLabelShow || "Show help";
  }

  // Now load per-question MIN help from the backend
  // Prepend any global General Help text from ConfigAdmin
  const globalHelp = (FORM?.helpText || "").toString().trim();

  fetchHelpForQuestion(q.id)
    .then(({ min }) => {
      let html = "";

      if (globalHelp) {
        if (/<[a-z][\s\S]*>/i.test(globalHelp)) {
          html += globalHelp;
        } else {
          html += escapeHtml(globalHelp).replace(/\r\n|\r|\n/g, "<br>");
        }
      }

      if (min) {
        if (html) {
          html += "<hr>";
        }
        if (/<[a-z][\s\S]*>/i.test(min)) {
          html += min;
        } else {
          html += escapeHtml(min).replace(/\r\n|\r|\n/g, "<br>");
        }
      }

      if (!html) {
        html =
          "Try giving a clear, simple answer with one or two examples.";
      }

      minHelpBody.innerHTML = html;
    })
    .catch((err) => {
      console.warn("renderMinHelpPanel help fetch failed:", err);
      minHelpBody.textContent =
        "Try giving a clear, simple answer with one or two examples.";
    });
}


// READMAX variant: always-on full sample answer (Max Help only)
async function renderReadOnlyMaxHelpPanel() {
  const panel   = $("maxHelpPanel");
  const introEl = $("maxHelpIntro");
  const maxEl   = $("maxHelpMax");

  if (!panel || !maxEl) return;

  const q = currentQuestion();
  if (!q) return;

  // Instructions from ConfigAdmin (FORM.instructions)
  if (introEl) {
    const inst = (FORM?.instructions || "").toString().trim();
    if (inst) {
      if (/<[a-z][\s\S]*>/i.test(inst)) {
        introEl.innerHTML = inst;
      } else {
        introEl.innerHTML = escapeHtml(inst).replace(
          /\r\n|\r|\n/g,
          "<br>"
        );
      }
    } else {
      introEl.textContent =
        "You will see one or more speaking questions. Read the prompt carefully, then record or upload your answer.";
    }
  }

  let maxText = "";
  try {
    const help = await fetchHelpForQuestion(q.id);
    maxText = (help.max || "").toString().trim();
  } catch (err) {
    console.warn("renderReadOnlyMaxHelpPanel help fetch failed:", err);
  }

  if (maxText) {
    if (/<[a-z][\s\S]*>/i.test(maxText)) {
      maxEl.innerHTML = maxText;
    } else {
      maxEl.innerHTML = escapeHtml(maxText).replace(
        /\r\n|\r|\n/g,
        "<br>"
      );
    }
  } else {
    maxEl.textContent =
      "Here would be a full sample answer in 4–6 sentences. When you are ready, read it aloud while you record.";
  }
}

// WidgetMax panel (MIN + MAX) — per-question
async function openMaxHelpPanel() {
  const panel    = $("maxHelpPanel");
  const introEl  = $("maxHelpIntro");
  const minEl    = $("maxHelpMin");
  const maxEl    = $("maxHelpMax");

  if (!panel || !minEl || !maxEl) return;

  const q = currentQuestion();
  if (!q) return;

  // Intro from ConfigAdmin (instructions)
  if (introEl) {
    const inst = FORM?.instructions || "";
    if (inst) {
      if (/<[a-z][\s\S]*>/i.test(inst)) {
        introEl.innerHTML = inst;
      } else {
        introEl.innerHTML = escapeHtml(inst).replace(
          /\r|\n/g,
          "<br>"
        );
      }
    } else {
      introEl.textContent =
        "Here is a model answer and some ideas you can use.";
    }
  }

  // Get MIN + MAX help from backend
  let minText = "";
  let maxText = "";
  try {
    const { min, max } = await fetchHelpForQuestion(q.id);
    minText = min;
    maxText = max;
  } catch (err) {
    console.warn("openMaxHelpPanel help fetch failed:", err);
  }

  // Section 1: MIN help (bullet-style summary)
  if (minText) {
    if (/<[a-z][\s\S]*>/i.test(minText)) {
      minEl.innerHTML = minText;
    } else {
      minEl.innerHTML = escapeHtml(minText).replace(
        /\r|\n/g,
        "<br>"
      );
    }
  } else {
    minEl.textContent =
      "Use 3–4 short points. Say what, why and give a short example.";
  }

  // Section 2: MAX help (full 60-second sample)
  if (maxText) {
    if (/<[a-z][\s\S]*>/i.test(maxText)) {
      maxEl.innerHTML = maxText;
    } else {
      maxEl.innerHTML = escapeHtml(maxText).replace(
        /\r|\n/g,
        "<br>"
      );
    }
  } else {
    maxEl.textContent =
      "Here would be a full sample answer in 4–6 sentences, using the same structure as the short points above.";
  }

  // Open the panel
  panel.classList.remove("mss-hidden");
  panel.setAttribute("aria-hidden", "false");

  const closeBtn = $("maxHelpCloseBtn");
  if (closeBtn && !closeBtn._mssBound) {
    closeBtn.addEventListener("click", () => {
      closeMaxHelpPanel();
    });
    closeBtn._mssBound = true;
  }

  logEvent("help_max_open", { questionId: q.id });
}

function closeMaxHelpPanel() {
  const panel = $("maxHelpPanel");
  if (!panel) return;
  panel.classList.add("mss-hidden");
  panel.setAttribute("aria-hidden", "true");
  logEvent("help_max_close", { questionId: currentQuestion()?.id || null });
}

function isMaxHelpOpen() {
  const panel = $("maxHelpPanel");
  return panel && !panel.classList.contains("mss-hidden");
}

function renderQuestion() {
  const q = currentQuestion();
  const questionEl = $("question");

  const rawText = q ? q.question || q.text || "" : "";

  if (questionEl) {
    if (/<[a-z][\s\S]*>/i.test(rawText)) {
      questionEl.innerHTML = rawText;
    } else if (rawText.includes("\n")) {
      const paras = rawText
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p>${escapeHtml(p)}</p>`)
        .join("");
      questionEl.innerHTML = paras || "";
    } else {
      questionEl.textContent = rawText;
    }
  }

  if ($("counter")) {
    const total = QUESTIONS.length || 1;
    $("counter").textContent = `QUESTION ${idx + 1} OF ${total}`;
  }

  // reset state for new question
  SESSION_LOCKED = false;
  HELP_LEVEL = 0;

  const slider = $("helpSlider");
  if (slider) slider.value = 0;

  const label = $("helpLabel");
  if (label) label.textContent = "no help";

  if (window.MSSHelp?.hide) {
    window.MSSHelp.hide();
  }

  // WidgetMin (if present)
  renderMinHelpPanel();

  // WidgetMax READMODE: always show max help panel with full model answer
  const maxPanel = $("maxHelpPanel");
  if (maxPanel) {
    if (WIDGET_MODE === "readmax") {
      maxPanel.classList.remove("mss-hidden");
      maxPanel.setAttribute("aria-hidden", "false");
      renderReadOnlyMaxHelpPanel();
    } else {
      // other layouts: start closed
      maxPanel.classList.add("mss-hidden");
      maxPanel.setAttribute("aria-hidden", "true");
    }
  }

  resetRecordingState();
  setRecordingUiEnabled(true);
}

function onPrevQuestion() {
  if (idx > 0) {
    idx--;
    collapseDashboard();
    renderQuestion();
    logEvent("nav_prev", { idx });
  }
}

function onNextQuestion() {
  if (idx < QUESTIONS.length - 1) {
    idx++;
    collapseDashboard();
    renderQuestion();
    logEvent("nav_next", { idx });
  }
}
function isLocalhost() {
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1"
  );
}

// Best-effort: try to find the Actor JWT wherever mss_client stores it.
// (Adjust keys if yours differ.)
function getActorTokenMaybe() {
  try {
    // If your mss_client exposes something, prefer it.
    if (window.mss_client?.getActorToken) return window.mss_client.getActorToken();
    if (window.mssClient?.getActorToken) return window.mssClient.getActorToken();
  } catch {}

  // Common storage fallbacks (pick up what exists)
  const keysToTry = [
    "mss_actor_jwt",
    "mss_actor_jwt_v1",
    "MSS_ACTOR_JWT",
    "actor_jwt",
  ];

  for (const k of keysToTry) {
    try {
      const v = localStorage.getItem(k);
      if (v && v.length > 20) return v;
    } catch {}
  }
  return "";
}
/* -----------------------------------------------------------------------
   HELP SLIDER (baseline Widget only)
   ----------------------------------------------------------------------- */

function onHelpSliderChange(evt) {
  const val = Number(evt.target.value || 0);
  HELP_LEVEL = val;

  const label = $("helpLabel");
  if (label) {
    label.textContent =
      val === 0 ? "no help" : val === 1 ? "a little help" : "lots of help";
  }

  console.log("[Help] slider -> level", HELP_LEVEL);
  logEvent("help_slider", { level: HELP_LEVEL });

  if (!window.MSSHelp) return;
  const q = currentQuestion();
  if (!q) return;

  if (HELP_LEVEL === 0) {
    window.MSSHelp.setLevel(0);
    return;
  }

  window.MSSHelp.setLevel(HELP_LEVEL, {
    slug: CURRENT_SLUG,
    schoolId: SCHOOL_ID,
    questionId: q.id,
    questionIndex: idx + 1,
    totalQuestions: QUESTIONS.length,
    widgetVariant: CONFIG.widgetVariant || "default",
  });
}

/* -----------------------------------------------------------------------
   RECORDING (WAV)
   ----------------------------------------------------------------------- */

async function onRecordClick() {
  try {
    if (SESSION_LOCKED) {
      setStatus(
        "This answer has been submitted with full help. Choose another question to record again."
      );
      return;
    }
    if (CONFIG && CONFIG.widgetEnabled === false) {
      const msg =
        CONFIG.maintenanceMessage ||
        "This practice widget is currently offline for maintenance.";
      setStatus(msg);
      return;
    }
    if (recording) return;

    resetPlaybackOnly();

    if (!audioContext) {
      audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
    }

    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    inputNode = audioContext.createMediaStreamSource(micStream);

    const bufferSize = 4096;
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    recordingChunks = [];
    recording = true;
    t0 = performance.now();

    processor.onaudioprocess = (e) => {
      if (!recording) return;
      const input = e.inputBuffer.getChannelData(0);
      recordingChunks.push(new Float32Array(input));
    };

    inputNode.connect(processor);
    processor.connect(audioContext.destination);

    startTimer();
    updateRecUi(true);
    setRecordingUiEnabled(true);

    setStatus("Recording… speak now.");
    logEvent("record_start", { questionId: currentQuestion()?.id });
  } catch (err) {
    console.error("Record error:", err);
    setStatus("We could not access your microphone.");
  }
}

function onStopClick() {
  if (!recording) return;
  recording = false;
  stopTimer();
  updateRecUi(false);

  try {
    if (processor) {
      processor.disconnect();
      processor.onaudioprocess = null;
      processor = null;
    }
    if (inputNode) {
      inputNode.disconnect();
      inputNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }

    const durationMs = performance.now() - t0;
    const durationSec = Number((durationMs / 1000).toFixed(3));

    if (!recordingChunks.length) {
      setStatus("No audio captured. Please try again.");
      return;
    }

    const wavBlob = encodeWav(
      recordingChunks,
      audioContext?.sampleRate || 44100
    );
    setNewBlob(wavBlob, "answer.wav", durationSec);

    setStatus(
      `Recording stopped (${durationSec}s). You can listen and submit your answer.`
    );
    logEvent("record_stop", {
      questionId: currentQuestion()?.id,
      durationSec,
    });
  } catch (err) {
    console.error("Stop record error:", err);
    setStatus("We had trouble finishing the recording.");
  }
}

function updateRecUi(isRecording) {
  const recDot   = $("recDot");
  const recState = $("recState");
  const recBtn   = $("recBtn");
  const stopBtn  = $("stopBtn");

  if (recDot) recDot.classList.toggle("on", !!isRecording);
  if (recState)
    recState.textContent = isRecording
      ? "Recording…"
      : (FORM?.NotRecordingLabel || "Not recording");
  if (recBtn) recBtn.disabled = !!isRecording;
  if (stopBtn) stopBtn.disabled = !isRecording;
}

// Replaces old encodeWav/writeString
function encodeWav(chunks, inputSampleRate, targetSampleRate = 16000) {
  // Merge Float32 chunks into one big buffer
  let length = 0;
  for (const c of chunks) length += c.length;
  const pcmData = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    pcmData.set(c, offset);
    offset += c.length;
  }

  // If needed, resample to 16 kHz (or whatever targetSampleRate is)
  let outData = pcmData;
  let sampleRate = inputSampleRate;

  if (inputSampleRate && targetSampleRate && inputSampleRate !== targetSampleRate) {
    const sampleRateRatio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(pcmData.length / sampleRateRatio);
    outData = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const idx = Math.floor(i * sampleRateRatio);
      outData[i] = pcmData[idx] || 0;
    }

    sampleRate = targetSampleRate;
  }

  // Allocate WAV buffer (16-bit mono PCM)
  const buffer = new ArrayBuffer(44 + outData.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + outData.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);      // PCM chunk size
  view.setUint16(20, 1, true);       // audio format = PCM
  view.setUint16(22, 1, true);       // channels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = sampleRate * blockAlign
  view.setUint16(32, 2, true);       // blockAlign = 2 (16-bit mono)
  view.setUint16(34, 16, true);      // bitsPerSample = 16
  writeString(view, 36, "data");
  view.setUint32(40, outData.length * 2, true);

  // PCM samples
  let idx16 = 44;
  for (let i = 0; i < outData.length; i++, idx16 += 2) {
    let s = Math.max(-1, Math.min(1, outData[i]));
    view.setInt16(idx16, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: "audio/wav" });
}


function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/* -----------------------------------------------------------------------
   FILE UPLOAD
   ----------------------------------------------------------------------- */

// FILE UPLOAD (WAV or MP3 → always send WAV to backend)
async function onUploadChange(evt) {
  if (SESSION_LOCKED) {
    setStatus(
      "This answer has been submitted with full help. Choose another question to upload again."
    );
    evt.target.value = "";
    return;
  }

  if (CONFIG && CONFIG.widgetEnabled === false) {
    const msg =
      CONFIG.maintenanceMessage ||
      "This practice widget is currently offline for maintenance.";
    setStatus(msg);
    evt.target.value = "";
    return;
  }

  const input = evt.target;
  const file =
    input && input.files && input.files.length ? input.files[0] : null;
  if (!file) return;

  // Stop any in-progress recording state
  stopTimer();
  updateRecUi(false);

  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (inputNode) {
    inputNode.disconnect();
    inputNode = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  // Decide how to handle the file
  const lowerName = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const looksWav =
    type === "audio/wav" ||
    type === "audio/x-wav" ||
    lowerName.endsWith(".wav");
  const looksMp3 =
    type === "audio/mpeg" ||
    type === "audio/mp3" ||
    lowerName.endsWith(".mp3");

  try {
    if (looksWav) {
      // ✅ Native WAV, safe to send as-is
      console.log("📥 Selected WAV upload:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });

      const dur = await getAudioDurationSecFromFile(file);
      LAST_AUDIO_SOURCE = "upload_wav";
      setNewBlob(file, file.name, dur);
      setStatus(`File selected: ${file.name}. You can listen and submit it.`);
    } else if (looksMp3) {
      // ✅ MP3 → decode → re-encode as WAV using existing encodeWav()
      console.log("📥 Selected MP3 upload, converting to WAV:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });

      setStatus("Processing your audio file…");

      const arrayBuffer = await file.arrayBuffer();

      if (!audioContext) {
        audioContext = new (window.AudioContext ||
          window.webkitAudioContext)();
      }

      // Safari still sometimes uses callback form, so support both
      const audioBuffer = await new Promise((resolve, reject) => {
        const done = (buf) => resolve(buf);
        const fail = (err) => reject(err);

        // Try promise form first
        const result = audioContext.decodeAudioData(arrayBuffer, done, fail);
        if (result && typeof result.then === "function") {
          result.then(resolve).catch(reject);
        }
      });

      const dur = Number.isFinite(audioBuffer.duration) ?  Number(audioBuffer.duration.toFixed(3)) : null;

      const channelData = audioBuffer.getChannelData(0); // mono
      const pcm = new Float32Array(channelData.length);
      pcm.set(channelData);

      const wavBlob = encodeWav([pcm], audioBuffer.sampleRate);
      const wavName =
        file.name.replace(/\.[^.]+$/, "") + ".wav";

      console.log("🎧 MP3 converted to WAV:", {
        originalName: file.name,
        wavName,
        type: wavBlob.type,
        size: wavBlob.size,
      });

      LAST_AUDIO_SOURCE = "upload_mp3";
       setNewBlob(wavBlob, wavName, dur);
       setStatus(
        `File processed: ${wavName}. You can listen and submit it.`
      );
    } else {
      console.warn("Rejected unsupported audio upload:", {
        name: file.name,
        type: file.type,
        size: file.size,
      });
      setStatus(
        "Please upload a WAV or MP3 audio file, or record directly in the browser."
      );
      input.value = "";
      return;
    }

    // Log successful selection
    logEvent("upload_select", {
      questionId: currentQuestion()?.id,
      fileName: blobName || file.name,
      size: blob ? blob.size : file.size,
      type: blob ? blob.type : file.type,
    });
  } catch (err) {
    console.error("Upload/convert error:", err);
    setStatus(
      "We had trouble reading that audio file. Please try another WAV or MP3, or record directly in the browser."
    );
    input.value = "";
  }
}
//DEV - let's remove this when we are ready to go online
function isLocalhost() {
  const h = String(location.hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1";
}

// Replace with your real storage (mss_client, localStorage, etc.)
function getActorTokenMaybe() {
  try {
    return String(window.__MSS_ACTOR_TOKEN || "").trim();
  } catch {
    return "";
  }
}
async function onSubmitClick() {
  const submitBtn = document.getElementById("submitBtn");
  if (submitBtn && submitBtn.dataset.submitting === "1") return;
  if (submitBtn) submitBtn.dataset.submitting = "1";

  const fail = (msg) => { setStatus(msg); };

  try {
    // ---------- question context ----------
    const q = currentQuestion?.();
    if (!q) return fail("There is no question loaded.");

    const dateKey = String(window.__INGLE_DATEKEY || "").trim() || null;
    if (!dateKey) return fail("Internal error: missing dateKey. Refresh and try again.");

    const question_pk =
      Number(window.__INGLE_TODAY_PK) ||
      Number(q.question_pk) ||
      Number(q.question_id) ||
      (Number.isFinite(Number(q.id)) ? Number(q.id) : null) ||
      null;

    if (!question_pk) return fail("Internal error: missing question_pk. Refresh and try again.");

    const questionText =
      String(document.getElementById("question")?.textContent || "").trim() ||
      String(q.question || q.text || q.prompt || "").trim() ||
      null;

    // ---------- audio ----------
    const activeBlob = blob || window.__INGLE_BLOB || null;
    const activeBlobName = blobName || window.__INGLE_BLOB_NAME || "answer.wav";
    if (!activeBlob) return fail("Please record or upload an answer before submitting.");

    // local playback URL for immediate UI
    let localBlobUrl = "";
    try { localBlobUrl = URL.createObjectURL(activeBlob); } catch (_) {}

    // ---------- identity (DEV only for now) ----------
    const emailEl = document.getElementById("ingleEmail");
    const email = emailEl ? String(emailEl.value || "").trim().toLowerCase() : "";

    // handle: use local-part if email, else anon. Always store/display WITHOUT "@"
    const handleRaw = (email ? email.split("@")[0] : "anon") || "anon";
    const handle = String(handleRaw).trim().replace(/^@+/, "") || "anon";

    // ---------- length_sec ----------
    const length_sec =
      (typeof LAST_AUDIO_LENGTH_SEC === "number" && Number.isFinite(LAST_AUDIO_LENGTH_SEC) && LAST_AUDIO_LENGTH_SEC > 0)
        ? Math.round(LAST_AUDIO_LENGTH_SEC)
        : (typeof window.LAST_AUDIO_LENGTH_SEC === "number" && Number.isFinite(window.LAST_AUDIO_LENGTH_SEC) && window.LAST_AUDIO_LENGTH_SEC > 0)
          ? Math.round(window.LAST_AUDIO_LENGTH_SEC)
          : null;

    // ---------- endpoints ----------
    const SCORE_URL = (() => {
      // if config supplies it, honor it
      const base = (CONFIG?.api?.baseUrl || "").trim();
      if (base) {
        const b = base.replace(/\/+$/, "");
        return /\/api\/vox($|\/|\?)/.test(b) ? b : `${b}/api/vox`;
      }

      // default by hostname (avoid Vercel rewrite for multipart uploads)
      const host = String(location.hostname || "");
      if (host === "eslsuccess.club" || host === "www.eslsuccess.club") {
        return "https://api.eslsuccess.club/api/vox";
      }

      // localhost / dev
      return `${BACKEND_BASE}/api/vox`;
    })();

    // ---------- UI ----------
    showSubmitProgress?.();
    const t0 = performance.now();
    setStatus("Submitting your answer…");

    // ---------- 1) SCORE ----------
    const fd = new FormData();
    const fileForUpload = await ensureFileFromBlobLike(activeBlob, activeBlobName);
    fd.append("file", fileForUpload, fileForUpload.name);
    if (length_sec != null) fd.append("length_sec", String(length_sec));
    if (questionText) fd.append("question", questionText);

    const scoreHeaders = {};
    if (CONFIG?.api?.key) scoreHeaders["API-KEY"] = CONFIG.api.key;
    if (CONFIG?.api?.secret) scoreHeaders["x-api-secret"] = CONFIG.api.secret;

    const scoreRes = await fetch(SCORE_URL, { method: "POST", headers: scoreHeaders, body: fd });
    const mss = await scoreRes.json().catch(() => ({}));
    if (!scoreRes.ok) {
      const friendly = buildFriendlySubmitError?.(scoreRes.status, mss) || "Scoring failed. Please try again.";
      return fail(friendly);
    }

    // Immediate score UI (even before saving)
    try { safeUpdateScoreUIImmediately?.(mss, localBlobUrl, handle); } catch (_) {}

    // Keep “my last” in global state for filter snap (if used)
    try {
      const myCefr = getCefrFromMss?.(mss);
      if (myCefr && window.INGLE_STATE) window.INGLE_STATE.myLastCefr = myCefr;
    } catch (_) {}

    // ---------- 2) UPLOAD AUDIO (PoC: disk) ----------
    let audio_key = null;
    let publicAudioUrl = null;

    try {
      const upFd = new FormData();
      const fileForUpload2 = await ensureFileFromBlobLike(activeBlob, activeBlobName);
      upFd.append("file", fileForUpload2, fileForUpload2.name);

      const upHeaders = {};
      const actorToken2 = getActorTokenMaybe?.();
      if (actorToken2) {
        upHeaders["Authorization"] = `Bearer ${actorToken2}`;
      } else {
        if (isLocalhost?.() && email) upHeaders["x-ingle-dev-email"] = email;
      }

      const upRes = await fetch("/api/ingles/submit-audio", {
        method: "POST",
        headers: upHeaders, // do NOT set content-type
        body: upFd,
      });

      const up = await upRes.json().catch(() => ({}));
      if (!upRes.ok || up.ok === false) {
        console.error("❌ /submit-audio failed:", upRes.status, up);
        return fail("Scored — but we could not upload your audio for playback.");
      }

      audio_key = up.audio_key || null;
      publicAudioUrl = up.audioUrl || null;
    } catch (e) {
      console.error("❌ /submit-audio exception:", e);
      return fail("Scored — but audio upload failed (network).");
    }

    // ---------- 3) SAVE ----------
    const payload = {
      question_pk,
      question: questionText,
      length_sec: length_sec ?? null,
      mss,
      audio_key,        // ✅ critical for public playback
      dateKey,          // ✅ ensure server has it even if it recomputes
      handle,           // ✅ normalized (no @)
    };

    const saveHeaders = { "Content-Type": "application/json" };

    const actorToken = getActorTokenMaybe?.();
    if (actorToken) {
      saveHeaders["Authorization"] = `Bearer ${actorToken}`;
    } else {
      if (isLocalhost?.() && email) saveHeaders["x-ingle-dev-email"] = email;
    }

    const saveRes = await fetch("/api/ingles/submit", {
      method: "POST",
      headers: saveHeaders,
      body: JSON.stringify(payload),
    });

    const saved = await saveRes.json().catch(() => ({}));
    if (!saveRes.ok || saved.ok === false) {
      console.error("❌ /api/ingles/submit error:", saveRes.status, saved);
      if (saveRes.status === 401) return fail("Scored — but you must sign in to save (or use a dev email on localhost).");
      return fail("Scored — but we could not save your result. Please try again later.");
    }

    // ---------- 4) SUCCESS ----------
    const elapsedSec = ((performance.now() - t0) / 1000).toFixed(1);
    const cefr = getCefrFromMss?.(mss) || saved.cefr || null;

    setStatus(
      `Saved — CEFR ${cefr || "estimated"} (${elapsedSec}s). ` +
      `Check tomorrow’s question when you’re ready.`
    );

    // refresh feed (DB truth, includes public audioUrl)
    refreshLiveFeed?.(dateKey).catch((e) => console.warn("feed refresh failed:", e));

    // ---------- 5) DISPATCH (include counters if server returns them) ----------
    const stats = saved.stats || saved.counters || null;

    try {
      window.dispatchEvent(
        new CustomEvent("ingle:scored", {
          detail: {
            mss,
            handle,
            dateKey,
            submissionId: saved.submissionId || saved.id || null,

            // playback
            localBlobUrl,
            publicAudioUrl,
            audio_key,

            // counters (if present)
            streak: stats?.current_streak ?? saved.current_streak ?? null,
            total:  stats?.total_recordings ?? saved.total_recordings ?? null,
            followers: saved.followers_count ?? stats?.followers_count ?? null,
            following: saved.following_count ?? stats?.following_count ?? null,
          },
        })
      );
    } catch (e) {
      console.warn("ingle:scored dispatch failed:", e);
    }

    // (optional) disable recording UI after successful save
    try { setRecordingUiEnabled?.(false); } catch (_) {}
  } catch (err) {
    console.error("Submit flow exception:", err);
    fail("Network error while submitting. Please check your connection.");
  } finally {
    hideSubmitProgress?.();
    if (submitBtn) submitBtn.dataset.submitting = "0";
  }
} //end of onSubmitClick

/** Minimal safe UI updater so score shows instantly even if other hooks fail */
function safeUpdateScoreUIImmediately(mss, localBlobUrl, handle) {
  try {
    // 1) Show “Your result” immediately (implement however your UI expects)
    if (typeof renderMyResult === "function") {
      renderMyResult(mss, { handle, localBlobUrl });
    } else {
      // very minimal fallback:
      const cefr = getCefrFromMss?.(mss) || mss?.mss_cefr || mss?.cefr || mss?.elsa_results?.cefr_level || "";
      const el = document.getElementById("yourResult");
      if (el) el.textContent = cefr ? `Your CEFR estimate is ${cefr}.` : `Scored.`;
    }

    // 2) If you have a local playback element, attach it now
    const audio = document.getElementById("localPlayback");
    if (audio && localBlobUrl) {
      audio.src = localBlobUrl;
      audio.load?.();
    }
  } catch (e) {
    console.warn("safeUpdateScoreUIImmediately failed:", e);
  }
} 
//Dec 8 to handle error messages
function extractSubmitErrorMessage(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  // Common patterns: { message, error, body: "..." } or nested { body: { message } }
  if (payload.message) return String(payload.message);
  if (payload.error) return String(payload.error);

  if (payload.body) {
    const inner = payload.body;
    if (typeof inner === "string") return inner;
    if (inner.message) return String(inner.message);
    if (inner.error) return String(inner.error);
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

/**
 * Map raw backend / Vox errors (including "Input X contains NaN")
 * to student-friendly status messages.
 */
function buildFriendlySubmitError(status, body) {
  const raw = extractSubmitErrorMessage(body);
  const lower = raw.toLowerCase();

  // NaN / ML pipeline issues
  if (lower.includes("nan")) {
    return (
      "We couldn’t score that attempt. Please record again – " +
      "sometimes the scoring engine has trouble with certain audio."
    );
  }

  // Validation / bad request
  if (status === 400) {
    return (
      "We weren’t able to score this recording. Please try again " +
      "with a clear answer of about 30–60 seconds."
    );
  }

  // Server problems
  if (status >= 500) {
    return (
      "The scoring service is temporarily unavailable. " +
      "Please wait a moment and try again."
    );
  }

  // Fallback
  return "We could not submit your answer. Please try again.";
}
/* -----------------------------------------------------------------------
   TIMERS / RESET
   ----------------------------------------------------------------------- */

function startTimer() {
  const tEl = $("timer");
  if (!tEl) return;

  tEl.textContent = "0:00";
  if (tick) clearInterval(tick);

  tick = setInterval(() => {
    const elapsedMs = performance.now() - t0;
    const totalSec = Math.floor(elapsedMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    tEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 250);
}

function stopTimer() {
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
}

function resetRecordingState() {
  stopTimer();
  updateRecUi(false);

  recordingChunks = [];
  recording = false;

  if (processor) {
    try { processor.disconnect(); } catch {}
    processor = null;
  }
  if (inputNode) {
    try { inputNode.disconnect(); } catch {}
    inputNode = null;
  }
  if (micStream) {
    try { micStream.getTracks().forEach((t) => t.stop()); } catch {}
    micStream = null;
  }

  if (objectUrl) {
    try { URL.revokeObjectURL(objectUrl); } catch {}
    objectUrl = null;
  }

  blob = null;
  blobName = null;
  window.__INGLE_BLOB = null;
  window.__INGLE_BLOB_NAME = null;
  window.__INGLE_HAS_AUDIO = false;

  LAST_AUDIO_LENGTH_SEC = null;
  window.LAST_AUDIO_LENGTH_SEC = null;
  LAST_AUDIO_SOURCE = null;
  
  window.__INGLE_AUDIO_URL = null;

  const tEl = $("timer");
  if (tEl) tEl.textContent = "";

  if ($("fileInput")) $("fileInput").value = "";
  if ($("fileBadge")) $("fileBadge").textContent = "";

  const playerWrap = $("playerWrap");
  const player = $("player");
  const lengthHint = $("lengthHint");

  if (player) {
    try { player.pause(); } catch {}
    try { player.removeAttribute("src"); } catch {}
    try { player.load(); } catch {}
  }
  if (playerWrap) playerWrap.style.display = "none";
  if (lengthHint) lengthHint.textContent = "";

  const submitBtn = $("submitBtn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.submitting = "0";
  }
}

function resetPlaybackOnly() {
  if (objectUrl) {
    try { URL.revokeObjectURL(objectUrl); } catch {}
    objectUrl = null;
  }
  // also clear player src if you call this while keeping blob
  const player = $("player");
  const playerWrap = $("playerWrap");
  if (player) {
    try { player.pause(); } catch {}
    try { player.removeAttribute("src"); } catch {}
    try { player.load(); } catch {}
  }
  if (playerWrap) playerWrap.style.display = "none";
}

function setNewBlob(newBlob, name, durationSec) {
  // revoke previous object URL
  if (objectUrl) {
    try { URL.revokeObjectURL(objectUrl); } catch {}
    objectUrl = null;
  }

  blob = newBlob;
  blobName = name || "answer.wav";
  window.__INGLE_BLOB = blob;
  window.__INGLE_BLOB_NAME = blobName;
  window.__INGLE_HAS_AUDIO = true;

  // ✅ Persist duration (seconds) globally for submit/WPM
  if (typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0) {
    LAST_AUDIO_LENGTH_SEC = durationSec;
  } else {
    LAST_AUDIO_LENGTH_SEC = null;
  }

  // create fresh object URL for playback
  objectUrl = URL.createObjectURL(newBlob);

  const playerWrap = $("playerWrap");
  const player = $("player");
  const lengthHint = $("lengthHint");

  if (player) {
    player.src = objectUrl;
    try { player.load(); } catch {}
  }

  // ✅ show only when we actually have audio
  if (playerWrap) playerWrap.style.display = "";

  if (lengthHint) {
    if (LAST_AUDIO_LENGTH_SEC != null) {
      lengthHint.textContent =
        `Approximate length: ${Math.round(LAST_AUDIO_LENGTH_SEC)}s. Aim for 30–60 seconds.`;
    } else {
      const sec = Math.round(newBlob.size / 16000); // rough guess
      lengthHint.textContent = `Approximate length: ~${sec}s. Aim for 30–60 seconds.`;
    }
  }

  if ($("fileBadge")) {
    const sizeKb = (newBlob.size / 1024).toFixed(1);
    $("fileBadge").textContent = `${blobName} (${sizeKb} KB)`;
  }

  const submitBtn = $("submitBtn");
  if (submitBtn) submitBtn.disabled = false;

    // ✅ publish for other scripts (ingle.js) + submit
    window.__INGLE_BLOB = blob;
    window.__INGLE_BLOB_NAME = blobName;
    window.__INGLE_AUDIO_URL = objectUrl;
    window.LAST_AUDIO_LENGTH_SEC = LAST_AUDIO_LENGTH_SEC;
}
/* -----------------------------------------------------------------------
   MISC HELPERS
   ----------------------------------------------------------------------- */
function getCefrFromMss(mss) {
  if (!mss || typeof mss !== "object") return null;

  // Common patterns we’ve seen in MSS / Vox / Elsa payloads
  const candidates = [
    mss.cefr,
    mss.mss_cefr,
    mss.cefr_level,
    mss?.elsa_results?.cefr_level,
    mss?.elsa_results?.cefr,
    mss?.speechrater?.cefr,
    mss?.scores?.cefr,
    mss?.result?.cefr,
  ];

  for (const v of candidates) {
    const s = String(v || "").trim();
    if (!s) continue;

    // Normalize "b1" -> "B1", "C 1" -> "C1"
    const norm = s.toUpperCase().replace(/\s+/g, "");
    if (/^(A1|A2|B1|B2|C1|C2)$/.test(norm)) return norm;
  }

  return null;
}

/* -----------------------------------------------------------------------
   FEED FILTER BAR (CEFR slider + show all / followed)
   Requires these DOM ids (add to HTML if missing):
     - feedFilters (wrap) [optional]
     - cefrSlider (range 0..6)
     - cefrPill
     - modeAll (button)
     - modeFollowed (button)
     - resetFilters (button)
   And your feed container:
     - liveFeed
   ----------------------------------------------------------------------- */

function initFeedFilters() {
  const slider = $("cefrSlider");
  const pill   = $("cefrPill");

  if (!slider || !pill) {
    // UI not present yet — safe no-op
    return;
  }

  // slider: 0..6
  slider.min = "0";
  slider.max = "6";
  slider.step = "1";

  // default position = last known
  const defaultCefr =
    INGLE_STATE.myLastCefr ||
    (pill.textContent || "").trim().toUpperCase() ||
    "ALL";

  setCefrFilter(defaultCefr);

  slider.addEventListener("input", () => {
    const idx = Number(slider.value || 0);
    const level = CEFR_LEVELS[idx] || "ALL";
    setCefrFilter(level);
  });

  $("modeAll")?.addEventListener("click", () => setModeFilter("all"));
  $("modeFollowed")?.addEventListener("click", () => setModeFilter("followed"));

  $("resetFilters")?.addEventListener("click", () => {
    slider.value = "0";
    setCefrFilter("ALL");
  });
}

function setCefrFilter(level) {
  const L = String(level || "").trim().toUpperCase();
  INGLE_STATE.filter.cefr = CEFR_LEVELS.includes(L) ? L : "ALL";

  const pill = $("cefrPill");
  if (pill) pill.textContent = INGLE_STATE.filter.cefr;

  const slider = $("cefrSlider");
  if (slider) {
    const idx = Math.max(0, CEFR_LEVELS.indexOf(INGLE_STATE.filter.cefr));
    slider.value = String(idx >= 0 ? idx : 0);
  }

  renderIngleFeedFromState();
}

function setModeFilter(mode) {
  INGLE_STATE.filter.mode = mode === "followed" ? "followed" : "all";

  const bAll = $("modeAll");
  const bFol = $("modeFollowed");
  if (bAll && bFol) {
    bAll.classList.toggle("isActive", INGLE_STATE.filter.mode === "all");
    bFol.classList.toggle("isActive", INGLE_STATE.filter.mode === "followed");
  }

  renderIngleFeedFromState();
}

function getFilteredFeedItems() {
  const cefr = INGLE_STATE.filter.cefr;
  const mode = INGLE_STATE.filter.mode;

  return (INGLE_STATE.feed.items || []).filter((it) => {
    const itCefr = String(it.cefr || "").trim().toUpperCase();
    const okCefr = (cefr === "ALL") || (itCefr === cefr);

    const h = String(it.handle || "").trim().toLowerCase();
    const okFollow =
      (mode === "all") || INGLE_STATE.followedHandles.has(h);

    return okCefr && okFollow;
  });
}

function renderIngleFeedFromState() {
  const host = $("liveFeed");
  if (!host) return;

  const items = getFilteredFeedItems();

  // if you already have a nice renderer, prefer it
  if (typeof renderLiveFeed === "function") {
    renderLiveFeed(items);
    return;
  }

  // minimal fallback renderer (includes 🇨🇦 flag for now)
  host.innerHTML = items
    .map((it) => {
      const handle = String(it.handle || "anon").trim();
      const cefr = String(it.cefr || "").trim();
      const len = it.length_sec ? `${it.length_sec}s` : "";

      // TEMP: hard-code 🇨🇦 as requested (later use it.country_code)
      const flag = "🇨🇦";

      // NEW: public playback URL (server must return this)
      const audioUrl = (it.audioUrl || it.audio_url || "").toString().trim();

      // Render audio only if we have a URL
      const audioHtml = audioUrl
        ? `
          <div class="a">
            <audio controls preload="none" src="${escapeAttr(audioUrl)}"></audio>
          </div>
        `
        : `<div class="a a-empty"></div>`;

      return `
        <div class="feedRow">
          <div class="col1">
            <span class="h">${flag} @${escapeHtml(handle)}</span>
          </div>

          <div class="col2">
            <span class="c">${escapeHtml(cefr)}</span>
          </div>

          <div class="col3">
            <span class="l">${escapeHtml(len)}</span>
          </div>

          <div class="col4">
            ${audioHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

async function refreshLiveFeed(dateKey, limit = 20) {
  const dk = String(dateKey || "").trim();
  if (!dk) return;

  const url = `/api/ingles/feed?date=${encodeURIComponent(dk)}&limit=${encodeURIComponent(limit)}&ts=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(data?.error || `feed_http_${res.status}`);
  }

  const items = Array.isArray(data.items) ? data.items : [];

  // ✅ store in state (unfiltered)
  INGLE_STATE.feed.dateKey = dk;
  INGLE_STATE.feed.items = items;
  INGLE_STATE.feed.lastFetchedAt = Date.now();

  // ✅ render filtered view
  renderIngleFeedFromState();
}

window.refreshLiveFeed = refreshLiveFeed;
// optional: expose it so other scripts can call it
window.refreshLiveFeed = refreshLiveFeed;

function escapeAttr(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(str) {
  // Simple, safe HTML escaping for text-based help/question content
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function flagEmojiFromCountryCode(cc) {
  const s = String(cc || "").trim().toUpperCase();
  if (s.length !== 2) return "🏳️";
  const A = 0x1F1E6;
  const code0 = s.charCodeAt(0) - 65;
  const code1 = s.charCodeAt(1) - 65;
  if (code0 < 0 || code0 > 25 || code1 < 0 || code1 > 25) return "🏳️";
  return String.fromCodePoint(A + code0, A + code1);
}
/* -----------------------------------------------------------------------
   DEBUG TOGGLE
   ----------------------------------------------------------------------- */

$("toggleDebug")?.addEventListener("click", () => {
  const w = $("debugWrap");
  if (!w) return;
  w.style.display = w.style.display === "block" ? "none" : "block";
});

// EOF — MSS Ingle Core v1.0 Feb 2 2026
