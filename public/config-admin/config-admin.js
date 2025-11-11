// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel);

  // ----- basic slug wiring -----
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  const schoolSlugEl = qs("#mssAdminSchoolSlug");
  if (schoolSlugEl) schoolSlugEl.textContent = slug;

  // ----- top nav -----
  const makeUrl = (path) => `${path}?slug=${encodeURIComponent(slug)}`;

  const tabConfig = qs("#mssAdminTabConfig");
  const tabQuestions = qs("#mssAdminTabQuestions");
  const tabReports = qs("#mssAdminTabReports");

  if (tabConfig) {
    tabConfig.href = makeUrl("/config-admin/");
    tabConfig.classList.add("is-active");
  }
  if (tabQuestions) {
    tabQuestions.href = makeUrl("/questions-admin/");
  }
  if (tabReports) {
    tabReports.href = makeUrl("/reports/");
    tabReports.classList.add("is-disabled"); // placeholder
  }

  // ----- key elements -----
  const formEl = qs("#mssConfigForm");
  const statusEl = qs("#mssAdminStatus");
  const previewIframe = qs("#mssWidgetPreview");

  let currentSchoolId = null;
  let currentConfig = {};
  let currentForm = {};
  let currentBilling = {};

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-admin-status" + (cls ? " " + cls : "");
  }

  // ---------- LOAD CONFIG FROM SERVER ----------
  async function loadConfig() {
    try {
      setStatus("Loading configuration…", "is-working");

      const url = `/api/admin/widget/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        setStatus(
          body.message || body.error || "Could not load configuration.",
          "is-error"
        );
        console.error("loadConfig error:", body);
        return;
      }

      currentSchoolId = body.schoolId;
      currentConfig = body.config || {};
      currentForm = body.form || {};
      currentBilling = body.billing || {};

      const editable = currentConfig.editable || {};
      const show = currentConfig.show || {};
      const api = currentConfig.api || {};
      const logger = currentConfig.logger || {};

      // ----- Brand / text -----
      const elHeadline = qs("#cfgHeadline");
      if (elHeadline) {
        elHeadline.value = currentForm.headline || "CEFR Assessment";
      }

      const elPoweredBy = qs("#cfgPoweredBy");
      if (elPoweredBy) {
        elPoweredBy.value =
          currentForm.poweredByLabel || "Powered by MSS Vox";
      }

      const elEditableHeadline = qs("#cfgEditableHeadline");
      if (elEditableHeadline) {
        elEditableHeadline.checked =
          editable.headline !== undefined ? !!editable.headline : true;
      }

      // ----- Theme & behaviour -----
      const elTheme = qs("#cfgTheme");
      if (elTheme) {
        elTheme.value = currentConfig.theme || "default";
      }

      const elAllowUpload = qs("#cfgAllowUpload");
      if (elAllowUpload) {
        elAllowUpload.checked =
          currentConfig.Permitupload !== undefined
            ? !!currentConfig.Permitupload
            : true;
      }

      const elMin = qs("#cfgMinSec");
      if (elMin) {
        elMin.value =
          currentConfig.audioMinSeconds != null
            ? currentConfig.audioMinSeconds
            : 20;
      }

      const elMax = qs("#cfgMaxSec");
      if (elMax) {
        elMax.value =
          currentConfig.audioMaxSeconds != null
            ? currentConfig.audioMaxSeconds
            : 100;
      }

      // ----- Buttons visibility -----
      const mapShow = [
        ["#showHeadline", "headline"],
        ["#showRecordButton", "recordButton"],
        ["#showPrevButton", "prevButton"],
        ["#showNextButton", "nextButton"],
        ["#showStopButton", "stopButton"],
        ["#showUploadButton", "uploadButton"],
        ["#showPoweredByLabel", "poweredByLabel"],
        ["#showNotRecordingLabel", "notRecordingLabel"],
        ["#showSubmitButton", "submitButton"],
      ];

      mapShow.forEach(([selector, key]) => {
        const el = qs(selector);
        if (!el) return;
        el.checked = show[key] !== undefined ? !!show[key] : true;
      });

      // ----- Labels -----
      const labelMap = [
        ["#labelRecord", "recordButton", "Record your response"],
        ["#labelPrev", "previousButton", "Previous"],
        ["#labelNext", "nextButton", "Next"],
        ["#labelStop", "stopButton", "Stop"],
        ["#labelUpload", "uploadButton", "Choose an audio file"],
        ["#labelSubmit", "SubmitForScoringButton", "Submit for scoring"],
        ["#labelNotRecording", "NotRecordingLabel", "Not recording"],
      ];

      labelMap.forEach(([selector, key, fallback]) => {
        const el = qs(selector);
        if (!el) return;
        el.value = currentForm[key] || fallback;
      });

      // ----- API & logging -----
      const elBase = qs("#cfgApiBaseUrl");
      if (elBase) elBase.value = api.baseUrl || "";

      const elKey = qs("#cfgApiKey");
      if (elKey) elKey.value = api.key || "";

      const elSecret = qs("#cfgApiSecret");
      if (elSecret) elSecret.value = api.secret || "";

      const elLoggerEnabled = qs("#cfgLoggerEnabled");
      if (elLoggerEnabled) elLoggerEnabled.checked = !!logger.enabled;

      const elLoggerUrl = qs("#cfgLoggerUrl");
      if (elLoggerUrl) elLoggerUrl.value = logger.url || "";

      // ----- Billing -----
      const elDaily = qs("#cfgDailyLimit");
      if (elDaily) {
        elDaily.value =
          currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50;
      }

      const elNotify = qs("#cfgNotifyOnLimit");
      if (elNotify) {
        elNotify.checked =
          currentBilling.notifyOnLimit !== undefined
            ? !!currentBilling.notifyOnLimit
            : true;
      }

      const elAutoBlock = qs("#cfgAutoBlockOnLimit");
      if (elAutoBlock) {
        elAutoBlock.checked =
          currentBilling.autoBlockOnLimit !== undefined
            ? !!currentBilling.autoBlockOnLimit
            : true;
      }

      setStatus("Configuration loaded.", "is-ok");
      buildPreview();
    } catch (err) {
      console.error("loadConfig exception:", err);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ---------- BUILD PREVIEW ----------
  function buildPreview() {
    if (!previewIframe || !currentSchoolId) return;

    const base = window.location.origin.replace(/\/+$/, "");

    const html = [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8" />',
      "  <title>Widget preview</title>",
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <link rel="stylesheet" href="${base}/themes/MSSStylesheet.css?v=1" />`,
      // The widget itself loads its own theme CSS based on config;
      // this extra stylesheet just keeps the background nice.
      "</head>",
      '<body style="margin:0;padding:24px;background:#f5f5fb;">',
      '  <div id="mss-widget-container"></div>',
      // split closing tag to avoid ending the surrounding script
      `  <script src="${base}/embed.js" data-school-id="${currentSchoolId}"></` +
        "script>",
      "</body>",
      "</html>",
    ].join("\n");

    previewIframe.srcdoc = html;
  }

  // ---------- SAVE CONFIG BACK TO SERVER ----------
  async function saveConfig(e) {
    e.preventDefault();

    const cfgOut = { ...(currentConfig || {}) };
    const formOut = { ...(currentForm || {}) };
    const billingOut = { ...(currentBilling || {}) };

    // Brand / text
    const elHeadline = qs("#cfgHeadline");
    if (elHeadline) formOut.headline = elHeadline.value.trim();

    const elPoweredBy = qs("#cfgPoweredBy");
    if (elPoweredBy) formOut.poweredByLabel = elPoweredBy.value.trim();

    const elEditableHeadline = qs("#cfgEditableHeadline");
    cfgOut.editable = {
      ...(cfgOut.editable || {}),
      headline: elEditableHeadline ? elEditableHeadline.checked : true,
    };

    // Theme & behaviour
    const elTheme = qs("#cfgTheme");
    if (elTheme) cfgOut.theme = elTheme.value;

    const elAllowUpload = qs("#cfgAllowUpload");
    if (elAllowUpload) cfgOut.Permitupload = elAllowUpload.checked;

    const elMin = qs("#cfgMinSec");
    const elMax = qs("#cfgMaxSec");
    cfgOut.audioMinSeconds = elMin ? Number(elMin.value || 0) : 0;
    cfgOut.audioMaxSeconds = elMax ? Number(elMax.value || 0) : 0;

    // Buttons visibility
    cfgOut.show = {
      headline: qs("#showHeadline")?.checked ?? true,
      recordButton: qs("#showRecordButton")?.checked ?? true,
      prevButton: qs("#showPrevButton")?.checked ?? true,
      nextButton: qs("#showNextButton")?.checked ?? true,
      stopButton: qs("#showStopButton")?.checked ?? true,
      uploadButton: qs("#showUploadButton")?.checked ?? true,
      poweredByLabel: qs("#showPoweredByLabel")?.checked ?? true,
      notRecordingLabel: qs("#showNotRecordingLabel")?.checked ?? true,
      submitButton: qs("#showSubmitButton")?.checked ?? true,
    };

    // Labels
    const labelMap = [
      ["#labelRecord", "recordButton"],
      ["#labelPrev", "previousButton"],
      ["#labelNext", "nextButton"],
      ["#labelStop", "stopButton"],
      ["#labelUpload", "uploadButton"],
      ["#labelSubmit", "SubmitForScoringButton"],
      ["#labelNotRecording", "NotRecordingLabel"],
    ];

    labelMap.forEach(([selector, key]) => {
      const el = qs(selector);
      if (!el) return;
      formOut[key] = el.value.trim();
    });

    // API & logging
    cfgOut.api = {
      ...(cfgOut.api || {}),
      baseUrl: qs("#cfgApiBaseUrl")?.value.trim() || "",
      key: qs("#cfgApiKey")?.value.trim() || "",
      secret: qs("#cfgApiSecret")?.value.trim() || "",
    };

    cfgOut.logger = {
      ...(cfgOut.logger || {}),
      enabled: !!qs("#cfgLoggerEnabled")?.checked,
      url: qs("#cfgLoggerUrl")?.value.trim() || "",
    };

    // Billing
    billingOut.dailyLimit = Number(qs("#cfgDailyLimit")?.value || 0);
    billingOut.notifyOnLimit = !!qs("#cfgNotifyOnLimit")?.checked;
    billingOut.autoBlockOnLimit = !!qs("#cfgAutoBlockOnLimit")?.checked;

    const payload = {
      config: cfgOut,
      form: formOut,
      billing: billingOut,
    };

    try {
      setStatus("Saving…", "is-working");

      const url = `/api/admin/widget/${encodeURIComponent(slug)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        setStatus(
          body.message || body.error || "Failed to save configuration.",
          "is-error"
        );
        console.error("saveConfig error:", body);
        return;
      }

      currentConfig = cfgOut;
      currentForm = formOut;
      currentBilling = billingOut;

      setStatus("Saved. Preview updated.", "is-ok");
      buildPreview();
    } catch (err) {
      console.error("saveConfig exception:", err);
      setStatus("Network error while saving configuration.", "is-error");
    }
  }

  // wire up form + initial load
  if (formEl) {
    formEl.addEventListener("submit", saveConfig);
  }

  loadConfig();
})();