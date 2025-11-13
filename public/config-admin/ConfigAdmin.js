// MSS Widget MT – ConfigAdmin.js – 2025-11-13 11:28 EST


/* -------------------------------------------------------------
   Slug + endpoints (per-slug Postgres via /api/admin/widget/:slug)
------------------------------------------------------------- */

// MSS Widget MT – ConfigAdmin.js – 2025-11-13 11:40 EST

const params = new URLSearchParams(window.location.search);
const SLUG = (params.get("slug") || "mss-demo").trim();
const ADMIN_URL = "/api/admin/widget/" + encodeURIComponent(SLUG);

// Base path for this admin page (e.g. "/config-admin")
const BASE_PATH = window.location.pathname.replace(/\/[^/]*$/, "");

// Local JSON fallbacks live alongside ConfigAdmin.html
const FALLBACK_FORM_URL   = BASE_PATH + "/form.json?ts="   + Date.now();
const FALLBACK_CONFIG_URL = BASE_PATH + "/config.json?ts=" + Date.now();
const FALLBACK_IMAGE_URL  = BASE_PATH + "/image.json?ts="  + Date.now();

/* ========= state ========= */

const state = {
  form: {},
  config: {},
  image: {},
  loadedFrom: null, // "server" | "fallback"
  dirty: false
};

let fileHandle = null; // for optional JSON export re-saves

/* ========= DOM helpers ========= */

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, ok = true) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "" : "#b91c1c";
}

function updateMeta() {
  const meta = $("meta");
  const slugDisplay = $("slugDisplay");
  if (slugDisplay) {
    slugDisplay.textContent = "slug=" + SLUG;
  }
  if (!meta) return;
  const source =
    state.loadedFrom === "server"
      ? "Postgres"
      : state.loadedFrom === "fallback"
      ? "local JSON"
      : "—";
  const ts = new Date().toLocaleString();
  const dirtyFlag = state.dirty ? " • unsaved changes" : "";
  meta.textContent = "Source: " + source + " • " + ts + dirtyFlag;
}

/* ========= defaults / normalization ========= */

function normalizeForm(raw) {
  const f = Object.assign(
    {
      headline: "CEFR Assessment",
      recordButton: "Record your response",
      previousButton: "Previous",
      nextButton: "Next",
      uploadButton: "Choose an audio file",
      stopButton: "Stop",
      poweredByLabel: "Powered by MSS Vox",
      NotRecordingLabel: "Not recording",
      SubmitForScoringButton: "Submit for scoring",
      survey: []
    },
    raw || {}
  );

  // Fix historical typo if present
  if (typeof f.NotRecordingLabel !== "string" && raw && typeof raw.NotRecordingLabeßl === "string") {
    f.NotRecordingLabel = raw.NotRecordingLabeßl;
  }

  if (!Array.isArray(f.survey)) {
    f.survey = [];
  }
  return f;
}

function normalizeConfig(raw) {
  const c = Object.assign(
    {
      editable: {
        headline: true,
        recordButton: true,
        previousButton: true,
        nextButton: true,
        poweredByLabel: true,
        uploadButton: true,
        stopButton: true,
        NotRecordingLabel: true,
        SubmitForScoringButton: true
      },
      theme: "apple",
      api: {
        enabled: true,
        baseUrl: "https://app.myspeakingscore.com",
        key: "",
        secret: "",
        adminKey: ""
      },
      logger: {
        enabled: true,
        url: "https://mss-widget-mt.onrender.com/log/submission"
      },
      Permitupload: true,
      audioMinSeconds: 20,
      audioMaxSeconds: 100,
      brandLogo: null
    },
    raw || {}
  );

  // Ensure nested objects exist
  c.api = Object.assign(
    {
      enabled: true,
      baseUrl: "",
      key: "",
      secret: "",
      adminKey: ""
    },
    c.api || {}
  );
  c.logger = Object.assign(
    {
      enabled: true,
      url: ""
    },
    c.logger || {}
  );
  if (typeof c.audioMinSeconds !== "number") c.audioMinSeconds = Number(c.audioMinSeconds) || 0;
  if (typeof c.audioMaxSeconds !== "number") c.audioMaxSeconds = Number(c.audioMaxSeconds) || 0;
  return c;
}

/* ========= core load logic ========= */

async function loadAll() {
  setStatus("Loading configuration…");
  try {
    console.log("[ConfigAdmin] loading for slug=", SLUG, "via", ADMIN_URL);
    const r = await fetch(ADMIN_URL, {
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    if (!r.ok) throw new Error("admin read failed: " + r.status);
    const body = (await r.json().catch(function () { return {}; })) || {};
    const formObj =
      body && typeof body === "object" && (body.form || body) ? body.form || body : {};
    const configObj =
      body && typeof body === "object" && body.config && typeof body.config === "object"
        ? body.config
        : {};
    const imageObj =
      body && typeof body === "object" && body.image && typeof body.image === "object"
        ? body.image
        : {};

    applyLoaded(
      {
        form: formObj,
        config: configObj,
        image: imageObj
      },
      "server"
    );
    console.log("[ConfigAdmin] loaded from server", ADMIN_URL);
    setStatus("Loaded from server (Postgres)");
    return;
  } catch (err) {
    console.error("[ConfigAdmin] admin load failed; trying local JSON fallbacks", err);
  }

  // Only if admin fails, try static JSONs
  try {
    const [formRes, configRes, imageRes] = await Promise.allSettled([
      fetch(FALLBACK_FORM_URL, { cache: "no-store" }),
      fetch(FALLBACK_CONFIG_URL, { cache: "no-store" }),
      fetch(FALLBACK_IMAGE_URL, { cache: "no-store" })
    ]);

    let form = {};
    let config = {};
    let image = {};

    if (formRes.status === "fulfilled" && formRes.value.ok) {
      form = (await formRes.value.json().catch(function () { return {}; })) || {};
    }
    if (configRes.status === "fulfilled" && configRes.value.ok) {
      config = (await configRes.value.json().catch(function () { return {}; })) || {};
    }
    if (imageRes.status === "fulfilled" && imageRes.value.ok) {
      image = (await imageRes.value.json().catch(function () { return {}; })) || {};
    }

    applyLoaded({ form, config, image }, "fallback");
    console.log("[ConfigAdmin] loaded from local JSON fallbacks");
    setStatus("Loaded from local JSON fallbacks (form/config/image)", false);
  } catch (err2) {
    console.error("[ConfigAdmin] fallback load failed", err2);
    setStatus("Failed to load from server and local JSON", false);
  }
}

function applyLoaded(payload, source) {
  const form = normalizeForm(payload.form || {});
  const config = normalizeConfig(payload.config || {});
  const image = payload.image || {};

  if (!config.brandLogo && typeof image.brandDataUrl === "string") {
    config.brandLogo = image.brandDataUrl;
  }

  state.form = form;
  state.config = config;
  state.image = image;
  state.loadedFrom = source || null;
  state.dirty = false;

  populateFields();
  updatePreview();
  updateMeta();
  updateQuestionSummary();
}

/* ========= populate/read form ========= */

function populateFields() {
  const f = state.form;
  const c = state.config;

  if ($("cfgHeadline")) $("cfgHeadline").value = f.headline || "";
  if ($("cfgPoweredBy")) $("cfgPoweredBy").value = f.poweredByLabel || "";

  if ($("cfgApiEnabled")) $("cfgApiEnabled").checked = !!(c.api && c.api.enabled);
  if ($("cfgApiBaseUrl")) $("cfgApiBaseUrl").value = (c.api && c.api.baseUrl) || "";
  if ($("cfgApiKey")) $("cfgApiKey").value = (c.api && c.api.key) || "";
  if ($("cfgApiSecret")) $("cfgApiSecret").value = (c.api && c.api.secret) || "";
  if ($("cfgAdminKey")) $("cfgAdminKey").value = (c.api && c.api.adminKey) || "";

  if ($("cfgLoggerEnabled")) $("cfgLoggerEnabled").checked = !!(c.logger && c.logger.enabled);
  if ($("cfgLoggerUrl")) $("cfgLoggerUrl").value = (c.logger && c.logger.url) || "";
  if ($("cfgPermitUpload")) $("cfgPermitUpload").checked = !!c.Permitupload;

  if ($("cfgAudioMin")) $("cfgAudioMin").value = c.audioMinSeconds || 0;
  if ($("cfgAudioMax")) $("cfgAudioMax").value = c.audioMaxSeconds || 0;
  if ($("cfgTheme")) $("cfgTheme").value = c.theme || "apple";

  if ($("cfgRecordLabel")) $("cfgRecordLabel").value = f.recordButton || "";
  if ($("cfgPrevLabel")) $("cfgPrevLabel").value = f.previousButton || "";
  if ($("cfgNextLabel")) $("cfgNextLabel").value = f.nextButton || "";
  if ($("cfgUploadLabel")) $("cfgUploadLabel").value = f.uploadButton || "";
  if ($("cfgStopLabel")) $("cfgStopLabel").value = f.stopButton || "";
  if ($("cfgNotRecordingLabel")) $("cfgNotRecordingLabel").value = f.NotRecordingLabel || "";
  if ($("cfgSubmitLabel")) $("cfgSubmitLabel").value = f.SubmitForScoringButton || "";
}

function markDirty() {
  state.dirty = true;
  updateMeta();
}

/* ========= field bindings ========= */

function bindFields() {
  const bindings = [
    { id: "cfgHeadline", path: ["form", "headline"], type: "text" },
    { id: "cfgPoweredBy", path: ["form", "poweredByLabel"], type: "text" },
    { id: "cfgApiEnabled", path: ["config", "api", "enabled"], type: "bool" },
    { id: "cfgApiBaseUrl", path: ["config", "api", "baseUrl"], type: "text" },
    { id: "cfgApiKey", path: ["config", "api", "key"], type: "text" },
    { id: "cfgApiSecret", path: ["config", "api", "secret"], type: "text" },
    { id: "cfgAdminKey", path: ["config", "api", "adminKey"], type: "text" },
    { id: "cfgLoggerEnabled", path: ["config", "logger", "enabled"], type: "bool" },
    { id: "cfgLoggerUrl", path: ["config", "logger", "url"], type: "text" },
    { id: "cfgPermitUpload", path: ["config", "Permitupload"], type: "bool" },
    { id: "cfgAudioMin", path: ["config", "audioMinSeconds"], type: "number" },
    { id: "cfgAudioMax", path: ["config", "audioMaxSeconds"], type: "number" },
    { id: "cfgTheme", path: ["config", "theme"], type: "text" },
    { id: "cfgRecordLabel", path: ["form", "recordButton"], type: "text" },
    { id: "cfgPrevLabel", path: ["form", "previousButton"], type: "text" },
    { id: "cfgNextLabel", path: ["form", "nextButton"], type: "text" },
    { id: "cfgUploadLabel", path: ["form", "uploadButton"], type: "text" },
    { id: "cfgStopLabel", path: ["form", "stopButton"], type: "text" },
    { id: "cfgNotRecordingLabel", path: ["form", "NotRecordingLabel"], type: "text" },
    { id: "cfgSubmitLabel", path: ["form", "SubmitForScoringButton"], type: "text" }
  ];

  bindings.forEach(function (b) {
    const el = $(b.id);
    if (!el) return;

    const handler = function () {
      let value;
      if (b.type === "bool") {
        value = !!el.checked;
      } else if (b.type === "number") {
        const num = Number(el.value);
        value = Number.isFinite(num) ? num : 0;
      } else {
        value = el.value;
      }

      let target = state;
      for (let i = 0; i < b.path.length - 1; i++) {
        const key = b.path[i];
        if (!target[key] || typeof target[key] !== "object") {
          target[key] = {};
        }
        target = target[key];
      }
      target[b.path[b.path.length - 1]] = value;
      markDirty();
      updatePreview();
      updateQuestionSummary();
    };

    const eventType = b.type === "bool" ? "change" : "input";
    el.addEventListener(eventType, handler);
  });

  const logoInput = $("cfgBrandLogoInput");
  if (logoInput) {
    logoInput.addEventListener("change", handleLogoChange);
  }
}

/* ========= logo upload ========= */

function handleLogoChange(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    setStatus("Logo must be an image (PNG/JPG)", false);
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    const dataUrl = e.target && e.target.result ? String(e.target.result) : null;
    if (!dataUrl) return;
    state.config.brandLogo = dataUrl;
    if (!state.image) state.image = {};
    state.image.brandDataUrl = dataUrl;
    markDirty();
    updatePreview();
    setStatus("Logo updated (unsaved)");
  };
  reader.onerror = function () {
    setStatus("Failed to read logo file", false);
  };
  reader.readAsDataURL(file);
}

/* ========= preview + summary ========= */

function updatePreview() {
  const f = state.form;
  const c = state.config;

  const headline = f.headline || "CEFR Assessment";
  const powered = f.poweredByLabel || "Powered by MSS Vox";
  const recordLabel = f.recordButton || "Record your response";
  const stopLabel = f.stopButton || "Stop";
  const nextLabel = f.nextButton || "Next";
  const uploadLabel = f.uploadButton || "Choose an audio file";
  const submitLabel = f.SubmitForScoringButton || "Submit for scoring";
  const notRecLabel = f.NotRecordingLabel || "Not recording";

  const q =
    Array.isArray(f.survey) && f.survey.length
      ? f.survey[0]
      : "Sample question: What is on your bucket list?";

  if ($("previewHeadline")) $("previewHeadline").textContent = headline;
  if ($("previewPowered")) $("previewPowered").textContent = powered;
  if ($("previewQuestion")) $("previewQuestion").textContent = q;
  if ($("previewRecordBtn")) $("previewRecordBtn").textContent = recordLabel;
  if ($("previewStopBtn")) $("previewStopBtn").textContent = stopLabel;
  if ($("previewNextBtn")) $("previewNextBtn").textContent = nextLabel;
  if ($("previewUploadBtn")) $("previewUploadBtn").textContent = uploadLabel;
  if ($("previewSubmitBtn")) $("previewSubmitBtn").textContent = submitLabel;
  if ($("previewNotRecording")) $("previewNotRecording").textContent = notRecLabel;

  const logoEl = $("previewLogo");
  if (logoEl) {
    const logo = c.brandLogo || (state.image && state.image.brandDataUrl) || "";
    if (logo) {
      logoEl.src = logo;
      logoEl.style.visibility = "visible";
    } else {
      logoEl.removeAttribute("src");
      logoEl.style.visibility = "hidden";
    }
  }
}

function updateQuestionSummary() {
  const el = $("questionSummary");
  if (!el) return;
  const f = state.form;
  const count = Array.isArray(f.survey) ? f.survey.length : 0;
  if (!count) {
    el.textContent = "No questions found in this widget’s survey.";
    return;
  }
  const sample = f.survey[0];
  el.textContent =
    count +
    " question" +
    (count === 1 ? "" : "s") +
    ". First question: " +
    (typeof sample === "string" ? sample.slice(0, 160) + (sample.length > 160 ? "…" : "") : "");
}

/* ========= export helper (optional) ========= */

async function saveToFilePicker(jsonObj, suggestedName = "widget-config.json") {
  const blob = new Blob([JSON.stringify(jsonObj, null, 2)], {
    type: "application/json"
  });

  if (!("showSaveFilePicker" in window)) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.setAttribute("download", suggestedName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
    return "download";
  }

  try {
    if (fileHandle) {
      const perm = await fileHandle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        const w1 = await fileHandle.createWritable();
        await w1.write(blob);
        await w1.close();
        return "saved";
      }
    }
    fileHandle = await window.showSaveFilePicker({
      suggestedName: suggestedName,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    const w2 = await fileHandle.createWritable();
    await w2.write(blob);
    await w2.close();
    return "saved";
  } catch (e) {
    console.warn("[ConfigAdmin] Save canceled/failed:", e);
    return "canceled";
  }
}

/* ========= save logic ========= */

async function saveToServer() {
  const payload = {
    form: state.form,
    config: state.config
  };

  // Include image block if we have logo data
  const logo =
    (state.config && state.config.brandLogo) ||
    (state.image && state.image.brandDataUrl) ||
    null;
  if (logo) {
    payload.image = { brandDataUrl: logo };
  }

  setStatus("Saving to server…");
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (state.config && state.config.api && state.config.api.adminKey) {
      headers["X-ADMIN-KEY"] = String(state.config.api.adminKey);
    }

    const res = await fetch(ADMIN_URL, {
      method: "PUT",
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    console.log("[ConfigAdmin] saved to", ADMIN_URL, "for slug", SLUG);
    setStatus("Saved to server (Postgres)");
    state.dirty = false;
    updateMeta();
    return "server";
  } catch (err) {
    console.error("[ConfigAdmin] Remote save failed, falling back to file:", err);
    setStatus("Server save failed, exporting JSON instead", false);
    const r = await saveToFilePicker(payload, "widget-config-" + SLUG + ".json");
    if (r === "saved" || r === "download") {
      setStatus("Exported JSON locally (" + r + ")", false);
    } else {
      setStatus("Export canceled", false);
    }
    return r;
  }
}

async function exportJsonBundle() {
  const payload = {
    form: state.form,
    config: state.config,
    image: {
      brandDataUrl:
        (state.config && state.config.brandLogo) ||
        (state.image && state.image.brandDataUrl) ||
        null
    }
  };
  const r = await saveToFilePicker(payload, "widget-config-" + SLUG + ".json");
  if (r === "saved" || r === "download") {
    setStatus("Exported JSON (" + r + ")", true);
  } else {
    setStatus("Export canceled", false);
  }
}

/* ========= wiring ========= */

function wireButtons() {
  const saveBtn = $("saveBtn");
  const reloadBtn = $("reloadBtn");
  const openWidgetBtn = $("openWidgetBtn");
  const exportBtn = $("exportBtn");

  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      saveToServer();
    });
  }
  if (reloadBtn) {
    reloadBtn.addEventListener("click", function () {
      loadAll();
    });
  }
  if (openWidgetBtn) {
    openWidgetBtn.addEventListener("click", function () {
      const url = "Widget.html?slug=" + encodeURIComponent(SLUG);
      window.open(url, "_blank", "noopener");
    });
  }
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      exportJsonBundle();
    });
  }
}

/* ========= init ========= */

function init() {
  wireButtons();
  bindFields();
  updateMeta();
  loadAll();
}

window.addEventListener("DOMContentLoaded", init);
