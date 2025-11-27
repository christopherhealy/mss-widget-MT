// MSS Widget Core v1.2 — Nov 19 2025 (REGEN Nov 27 2025)
// Supports:
//   • Widget.html      – slider help (MSSHelp overlay)
//   • WidgetMin.html   – inline MIN-help panel (per-question)
//   • WidgetMax.html   – READMAX: always-on full model answer panel
console.log("✅ widget-core.js loaded");

"use strict";

// Simple ID helper
const $ = (id) => document.getElementById(id);

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

// Per-question help cache for WidgetMin + WidgetMax / READMAX
// questionId -> { min: string, max: string }
const HELP_CACHE = {};


/* -----------------------------------------------------------------------
   EPHEMERAL DASHBOARD CACHE (localStorage)
   ----------------------------------------------------------------------- */

/**
 * Cache a lightweight result object for dashboards in localStorage so that
 * dashboards can render even when they cannot reach the backend directly
 * (e.g., Vercel → Render CORS).
 *
 * slug:          school slug (CURRENT_SLUG)
 * submissionId:  numeric id returned by /api/widget/submit
 * mssResultRaw:  MSS JSON from /api/vox (score, transcript, elsa_results…)
 */
function cacheDashboardResult(slug, submissionId, mssResultRaw) {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (!slug || submissionId == null || !mssResultRaw) return;

  try {
    // In some odd shapes we might get { mss: {...} } or { meta: {...} }
    let mss = mssResultRaw;
    if (mss.mss && (mss.mss.elsa_results || typeof mss.mss.score === "number")) {
      mss = mss.mss;
    }
    if (mss.meta && (mss.meta.elsa_results || typeof mss.meta.score === "number")) {
      mss = mss.meta;
    }

    const elsa   = mss.elsa_results || mss.elsa || {};
    const overall =
      typeof mss.score === "number" ? mss.score : null;

    const resultForDash = {
      sessionId: submissionId,
      overall,
      score: overall,
      cefr:
        elsa.cefr_level ||
        mss.cefr_level ||
        mss.cefr ||
        null,
      toefl:
        typeof elsa.toefl_score === "number" ? elsa.toefl_score : null,
      ielts:
        typeof elsa.ielts_score === "number" ? elsa.ielts_score : null,
      pte:
        typeof elsa.pte_score === "number" ? elsa.pte_score : null,
      lengthSec: null, // we can wire a real duration later if we want
      wpm: null,
      transcript: mss.transcript || "",
      note: null,
    };

    const payload = {
      slug,
      submissionId,
      result: resultForDash,
    };

    const key = `mss-dash:${slug}:${submissionId}`;
    localStorage.setItem(key, JSON.stringify(payload));
    localStorage.setItem("mss-dash:last", JSON.stringify(payload));

    console.log("🧺 Cached dashboard result in localStorage:", {
      key,
      payload,
    });
  } catch (err) {
    console.warn("⚠️ cacheDashboardResult error:", err);
  }
}
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

  console.log("🎯 Active widget slug:", CURRENT_SLUG, "| mode:", WIDGET_MODE);

  wireUiEvents();
  bootstrapWidget();
}

function bootstrapWidget() {
  CURRENT_SLUG = getSlugFromUrlOrRoot();
  console.log("🚀 Bootstrapping widget for slug:", CURRENT_SLUG);
  setStatus("Loading…");

  const url = `${API.BOOTSTRAP}/${encodeURIComponent(
    CURRENT_SLUG
  )}/bootstrap`;

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
        config: CONFIG,
        form: FORM,
      });

      if (!QUESTIONS.length) {
        throw new Error("No questions returned from DB.");
      }

      const hasDbApi =
        CONFIG.api && CONFIG.api.key && CONFIG.api.secret;

      // Local dev fallback: /config/widget
      if (!hasDbApi && isLocalHost()) {
        console.log(
          "🔎 No API creds in DB config; local dev → fetching /config/widget…"
        );
        return fetch("/config/widget")
          .then((r) => {
            if (!r.ok) throw new Error(`/config/widget HTTP ${r.status}`);
            return r.json();
          })
          .then((legacyCfg) => {
            CONFIG.api = CONFIG.api || {};

            if (!CONFIG.api.key && legacyCfg.api?.key) {
              CONFIG.api.key = legacyCfg.api.key;
            }
            if (!CONFIG.api.secret && legacyCfg.api?.secret) {
              CONFIG.api.secret = legacyCfg.api.secret;
            }
            if (!CONFIG.api.baseUrl && legacyCfg.api?.baseUrl) {
              CONFIG.api.baseUrl = legacyCfg.api.baseUrl;
            }

            if (!CONFIG.submitUrl && legacyCfg.submitUrl) {
              CONFIG.submitUrl = legacyCfg.submitUrl;
            }
            if (!CONFIG.dashboardUrl && legacyCfg.dashboardUrl) {
              CONFIG.dashboardUrl = legacyCfg.dashboardUrl;
            }

            console.log("🔑 API KEY (dev fallback):", CONFIG.api?.key);
            console.log("🔐 API SECRET (dev fallback):", CONFIG.api?.secret);
            console.log("🔗 API baseUrl (dev fallback):", CONFIG.api?.baseUrl);
            console.log("📤 submitUrl (dev fallback):", CONFIG.submitUrl);
            console.log("📊 dashboardUrl (dev fallback):", CONFIG.dashboardUrl);

            finishBootstrap();
          })
          .catch((err) => {
            console.warn(
              "Dev /config/widget fallback failed; continuing with DB config:",
              err
            );
            finishBootstrap();
          });
      }

      console.log("🔑 API KEY (DB or fallback):", CONFIG.api?.key);
      console.log("🔐 API SECRET (DB or fallback):", CONFIG.api?.secret);
      console.log("🔗 API baseUrl (DB or fallback):", CONFIG.api?.baseUrl);
      console.log("📤 submitUrl (DB or fallback):", CONFIG.submitUrl);
      console.log("📊 dashboardUrl (DB or fallback):", CONFIG.dashboardUrl);

      finishBootstrap();
    })
    .catch((err) => {
      console.error("Bootstrap error:", err);
      setStatus("We could not load this widget. Please contact your school.");
    });
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
  $("clearFileBtn")?.addEventListener("click", onClearFileClick);

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
    const durationSec = Math.round(durationMs / 1000);

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

function encodeWav(chunks, sampleRate) {
  let length = 0;
  for (const c of chunks) length += c.length;
  const pcmData = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    pcmData.set(c, offset);
    offset += c.length;
  }

  const buffer = new ArrayBuffer(44 + pcmData.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcmData.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcmData.length * 2, true);

  let idx16 = 44;
  for (let i = 0; i < pcmData.length; i++, idx16 += 2) {
    let s = Math.max(-1, Math.min(1, pcmData[i]));
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

      setNewBlob(file, file.name, null);
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

      setNewBlob(wavBlob, wavName, null);
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
function onClearFileClick() {
  resetRecordingState();
  setStatus("Cleared. You can record or upload a new file.");
}

function onSubmitClick() {
  const q = currentQuestion();
  if (!q) {
    setStatus("There is no question loaded.");
    return;
  }
  if (!blob) {
    setStatus("Please record or upload an answer before submitting.");
    return;
  }

  if (CONFIG && CONFIG.widgetEnabled === false) {
    const msg =
      CONFIG.maintenanceMessage ||
      "This practice widget is currently offline for maintenance.";
    setStatus(msg);
    return;
  }

  showSubmitProgress();

  // Decide where to submit:
  //  1) If CONFIG.api.baseUrl is set → MSS scoring cluster (/api/vox)
  //  2) Else if CONFIG.submitUrl is set → use it as-is (absolute or relative)
  //  3) Else → fall back to our widget backend submit endpoint (API.SUBMIT_FALLBACK)
  let submitUrl;

  if (CONFIG?.api?.baseUrl) {
    const base = CONFIG.api.baseUrl.replace(/\/+$/, "");
    if (/\/api\/vox($|\/|\?)/.test(base)) {
      submitUrl = base;
    } else {
      submitUrl = `${base}/api/vox`;
    }
  } else if (CONFIG?.submitUrl) {
    const s = CONFIG.submitUrl;
    if (/^https?:\/\//i.test(s)) {
      submitUrl = s;
    } else if (s.startsWith("/")) {
      submitUrl = `${BACKEND_BASE || ""}${s}`;
    } else {
      submitUrl = `${BACKEND_BASE || ""}/${s}`;
    }
  } else {
    submitUrl = API.SUBMIT_FALLBACK; // e.g. `${BACKEND_BASE}/api/widget/submit`
  }

  // 🔑 Ensure /api/widget/submit also receives slug as a query param
  try {
    const u = new URL(submitUrl, window.location.origin);

    // match both "/api/widget/submit" and ".../api/widget/submit/"
    if (/\/api\/widget\/submit\/?$/.test(u.pathname)) {
      if (CURRENT_SLUG && !u.searchParams.has("slug")) {
        u.searchParams.set("slug", CURRENT_SLUG);
      }
      submitUrl = u.toString();
    }
  } catch (e) {
    console.warn("Could not normalize submitUrl with slug:", e);
  }

  console.log("📤 Submitting to:", submitUrl, {
    apiBaseUrl: CONFIG?.api?.baseUrl,
    submitUrlConfig: CONFIG?.submitUrl,
    fallback: API.SUBMIT_FALLBACK,
    slug: CURRENT_SLUG,
  });

  const fd = new FormData();

  // Use the real filename if we have one; fall back to answer.wav
  const fileNameForUpload = blobName || "answer.wav";

  console.log("📦 Preparing upload blob:", {
    name: fileNameForUpload,
    type: blob && blob.type,
    size: blob && blob.size,
  });

  fd.append("file", blob, fileNameForUpload);

  // 🔹 NEW: derive a canonical question text + ID once
  const questionId = q.id ?? q.question_id ?? null;
  const questionText = q.question || q.text || q.prompt || "";

  // 🔹 Send BOTH ID and text to the backend (for /api/widget/submit)
  if (questionId != null) {
    fd.append("questionId", String(questionId));   // existing field
    fd.append("question_id", String(questionId));  // DB-style, for safety
  }
  if (questionText) {
    fd.append("question", questionText);
  }

  // ⬇️ still send slug in the body as well (belt + suspenders)
  if (CURRENT_SLUG) fd.append("slug", CURRENT_SLUG);
  if (SCHOOL_ID) fd.append("schoolId", SCHOOL_ID);
  if (CONFIG.assessmentId) fd.append("assessmentId", CONFIG.assessmentId);

  const t0Local = performance.now();
  setStatus("Submitting your answer…");
  logEvent("submit_start", {
    questionId,
    questionText,
  });

    const headers = {};
  if (CONFIG?.api) {
    if (CONFIG.api.key)   headers["API-KEY"]    = CONFIG.api.key;
    if (CONFIG.api.secret) headers["API-SECRET"] = CONFIG.api.secret;
  }

  fetch(submitUrl, {
    method: "POST",
    // Let the browser set Content-Type for FormData
    headers,
    body: fd,
  })

    .then((r) =>
      r
        .json()
        .catch(() => ({}))
        .then((body) => ({ ok: r.ok, status: r.status, body }))
    )
    .then(async (res) => {
      const elapsedSec = ((performance.now() - t0Local) / 1000).toFixed(1);
      console.log("🎯 Submit response from MSS:", res);

      if (!res.ok) {
        console.error("❌ Submit error:", res.status, res.body);
        setStatus("We could not submit your answer. Please try again.");
        hideSubmitProgress();
        logEvent("submit_error", {
          questionId,
          status: res.status,
          body: res.body,
        });
        return;
      }

      const body = res.body || {};
      const msg = body.message || "Answer submitted successfully.";

      // 🔹 Help + variant metadata at submit time
      const help_level = getHelpLevelForSubmit();
      const help_surface = getHelpSurface();
      const widget_variant = getWidgetVariant();
      const dashboard_variant = getDashboardVariant();

      setStatus(`${msg} (in ${elapsedSec}s)`);

      // Are we POSTing directly to /api/widget/submit ?
      const norm = (s) => (s || "").replace(/\/+$/, "");
      const isDirectWidgetSubmit =
        norm(submitUrl) === norm(API.DB_SUBMIT) ||
        /\/api\/widget\/submit\/?$/.test(submitUrl);

      try {
        let submissionId;
        let dashboardUrl;

        if (isDirectWidgetSubmit && body.ok && body.submissionId) {
          // ✅ We already hit our Node submit handler
          submissionId = body.submissionId;
          dashboardUrl = body.dashboardUrl;
          console.log("✅ Direct widget submit stored:", {
            submissionId,
            dashboardUrl,
          });

          // ⚡ Try to cache dashboard data (if body happens to include MSS-like data)
          cacheDashboardResult(CURRENT_SLUG, submissionId, body);
        } else {
          // ✅ MSS scoring cluster → now store in DB via JSON submit

          // (re-use the same canonical text)
          const questionTextForDb = questionText;

          const dbPayload = {
            slug: CURRENT_SLUG,
            question: questionTextForDb,
            question_id: questionId ?? null,  // 🔹 NEW: DB-style ID
            questionId: questionId ?? null,   // 🔹 Keep camelCase for legacy server
            studentId: null,                  // can wire up later
            mss: body,                        // full MSS result payload
            help_level,
            help_surface,
            widget_variant,
            dashboard_variant,
          };

          console.log("📨 Posting MSS result to DB_SUBMIT:", dbPayload);

const dbRes = await fetch(API.DB_SUBMIT, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(dbPayload),
});

const dbJson = await dbRes.json().catch(() => ({}));
if (!dbRes.ok || dbJson.ok === false) {
  console.error("❌ DB_SUBMIT error:", dbRes.status, dbJson);
  setStatus(
    "We scored your answer but could not save it. Please try again later."
  );
  hideSubmitProgress();
  logEvent("submit_db_error", {
    questionId,
    status: dbRes.status,
    body: dbJson,
  });
  return;
}

submissionId = dbJson.submissionId || dbJson.id;
dashboardUrl = dbJson.dashboardUrl;
console.log("✅ Stored via DB_SUBMIT:", {
  submissionId,
  dashboardUrl,
});

// ⚡ Cache the MSS result for dashboards (Vercel, etc.)
cacheDashboardResult(CURRENT_SLUG, submissionId, body);
        }

        // Fallback: make sure we have some dashboard URL
        if (!dashboardUrl) {
          dashboardUrl = getDashboardPath(body.dashboardUrl);
        }

        // Inline dashboard if possible, otherwise popup
        const expanded = expandDashboard(dashboardUrl, submissionId);
        if (!expanded) {
          dashboardWindow = window.open(
            dashboardUrl,
            "_blank",
            "noopener,noreferrer"
          );
          logEvent("dashboard_popup_open", {
            submissionId,
            url: dashboardUrl,
          });
        }

        // Optionally lock session if full help was used
        if (help_level === "max") {
          SESSION_LOCKED = true;
        }

        hideSubmitProgress();
        setRecordingUiEnabled(false);

        logEvent("submit_success", {
          questionId,
          questionText,
          submissionId,
          help_level,
          help_surface,
          widget_variant,
          dashboard_variant,
          elapsedSec,
        });
      } catch (err) {
        console.error("submit success-flow error:", err);
        setStatus(
          "We scored your answer but ran into a problem showing the results."
        );
        hideSubmitProgress();
        logEvent("submit_flow_exception", {
          questionId,
          error: String(err),
        });
      }
    })
    .catch((err) => {
      console.error("Submit fetch error:", err);
      setStatus(
        "Network error while submitting. Please check your connection."
      );
      hideSubmitProgress();
      logEvent("submit_exception", {
        questionId,
        error: String(err),
      });
    });
} // end onSubmitClick
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

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  blob = null;
  blobName = null;

  const tEl = $("timer");
  if (tEl) tEl.textContent = "";

  if ($("fileInput")) $("fileInput").value = "";
  if ($("fileBadge")) $("fileBadge").textContent = "";

  const playerWrap = $("playerWrap");
  const player = $("player");
  const lengthHint = $("lengthHint");
  if (player) player.src = "";
  if (playerWrap) playerWrap.style.display = "none";
  if (lengthHint) lengthHint.textContent = "";

  const submitBtn = $("submitBtn");
  if (submitBtn) submitBtn.disabled = true;
}

function resetPlaybackOnly() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

/* -----------------------------------------------------------------------
   BLOB / PLAYER
   ----------------------------------------------------------------------- */

function setNewBlob(newBlob, name, durationSec) {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
  }

  blob = newBlob;
  blobName = name || "answer.wav";
  objectUrl = URL.createObjectURL(newBlob);

  const playerWrap = $("playerWrap");
  const player = $("player");
  const lengthHint = $("lengthHint");

  if (player) player.src = objectUrl;
  if (playerWrap) playerWrap.style.display = "block";

  if (lengthHint) {
    if (durationSec != null) {
      lengthHint.textContent = `Approximate length: ${durationSec}s. Aim for 30–60 seconds.`;
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
}

/* -----------------------------------------------------------------------
   MISC HELPERS
   ----------------------------------------------------------------------- */

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

/* -----------------------------------------------------------------------
   DEBUG TOGGLE
   ----------------------------------------------------------------------- */

$("toggleDebug")?.addEventListener("click", () => {
  const w = $("debugWrap");
  if (!w) return;
  w.style.display = w.style.display === "block" ? "none" : "block";
});

// EOF — MSS Widget Core v1.2 (Nov 27 2025 REGEN) – WidgetMin + WidgetMax / READMAX with help/dash metadata
