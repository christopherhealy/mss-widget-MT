// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel); 

  // ----- slug + header -----
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  const schoolSlugEl = qs("#mssAdminSchoolSlug");
  if (schoolSlugEl) schoolSlugEl.textContent = slug;

  // ----- top nav wiring -----
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
    tabReports.classList.add("mss-admin-tab--disabled");
  }

  // ----- DOM refs -----
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

  // ----- load config from server -----
  async function loadConfig() {
    try {
      setStatus("Loading configuration…", "is-working");

      const res = await fetch(
        `/api/admin/widget/${encodeURIComponent(slug)}`,
        { headers: { Accept: "application/json" } }
      );
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

      // ---------- Brand & text ----------
      const cfgHeadline = qs("#cfgHeadline");
      const cfgPoweredBy = qs("#cfgPoweredBy");
      const cfgEditableHeadline = qs("#cfgEditableHeadline");

      if (cfgHeadline) {
        cfgHeadline.value = currentForm.headline || "CEFR Assessment";
      }
      if (cfgPoweredBy) {
        cfgPoweredBy.value =
          currentForm.poweredByLabel || "Powered by MSS Vox";
      }
      if (cfgEditableHeadline) {
        cfgEditableHeadline.checked = !!(
          currentConfig.editable?.headline ?? true
        );
      }

      // ---------- Theme & behaviour ----------
      const cfgTheme = qs("#cfgTheme");
      const cfgAllowUpload = qs("#cfgAllowUpload");
      const cfgMinSec = qs("#cfgMinSec");
      const cfgMaxSec = qs("#cfgMaxSec");

      if (cfgTheme) {
        cfgTheme.value = currentConfig.theme || "mss-default";
      }
      if (cfgAllowUpload) {
        cfgAllowUpload.checked =
          currentConfig.allowUpload ?? currentConfig.Permitupload ?? true;
      }
      if (cfgMinSec) {
        cfgMinSec.value =
          currentConfig.audioMinSeconds != null
            ? currentConfig.audioMinSeconds
            : 20;
      }
      if (cfgMaxSec) {
        cfgMaxSec.value =
          currentConfig.audioMaxSeconds != null
            ? currentConfig.audioMaxSeconds
            : 100;
      }

      // ---------- Visibility toggles ----------
      const show = currentConfig.show || {};

      const visMap = {
        showHeadline: "headline",
        showRecordButton: "recordButton",
        showPrevButton: "prevButton",
        showNextButton: "nextButton",
        showStopButton: "stopButton",
        showUploadButton: "uploadButton",
        showPoweredByLabel: "poweredByLabel",
        showNotRecordingLabel: "notRecordingLabel",
        showSubmitButton: "submitButton",
      };

      Object.entries(visMap).forEach(([id, key]) => {
        const el = qs("#" + id);
        if (el) el.checked = show[key] ?? true;
      });

      // ---------- Text labels ----------
      const labelDefaults = {
        recordButton: "Record your response",
        previousButton: "Previous",
        nextButton: "Next",
        stopButton: "Stop",
        uploadButton: "Choose an audio file",
        SubmitForScoringButton: "Submit for scoring",
        NotRecordingLabel: "Not recording",
      };

      const labelMap = {
        labelRecord: "recordButton",
        labelPrev: "previousButton",
        labelNext: "nextButton",
        labelStop: "stopButton",
        labelUpload: "uploadButton",
        labelSubmit: "SubmitForScoringButton",
        labelNotRecording: "NotRecordingLabel",
      };

      Object.entries(labelMap).forEach(([inputId, formKey]) => {
        const el = qs("#" + inputId);
        if (!el) return;
        const val =
          currentForm[formKey] != null
            ? currentForm[formKey]
            : labelDefaults[formKey] || "";
        el.value = val;
      });

      // ---------- API & logging ----------
      const api = currentConfig.api || {};
      const logger = currentConfig.logger || {};

      const cfgApiBaseUrl = qs("#cfgApiBaseUrl");
      const cfgApiKey = qs("#cfgApiKey");
      const cfgApiSecret = qs("#cfgApiSecret");
      const cfgLoggerEnabled = qs("#cfgLoggerEnabled");
      const cfgLoggerUrl = qs("#cfgLoggerUrl");

      if (cfgApiBaseUrl) cfgApiBaseUrl.value = api.baseUrl || "";
      if (cfgApiKey) cfgApiKey.value = api.key || "";
      if (cfgApiSecret) cfgApiSecret.value = api.secret || "";
      if (cfgLoggerEnabled) cfgLoggerEnabled.checked = !!logger.enabled;
      if (cfgLoggerUrl) cfgLoggerUrl.value = logger.url || "";

      // ---------- Billing ----------
      const cfgDailyLimit = qs("#cfgDailyLimit");
      const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
      const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

      if (cfgDailyLimit) {
        cfgDailyLimit.value =
          currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50;
      }
      if (cfgNotifyOnLimit) {
        cfgNotifyOnLimit.checked =
          currentBilling.notifyOnLimit ?? true;
      }
      if (cfgAutoBlockOnLimit) {
        cfgAutoBlockOnLimit.checked =
          currentBilling.autoBlockOnLimit ?? true;
      }

      setStatus("Configuration loaded.", "is-ok");
      buildPreview();
    } catch (err) {
      console.error("loadConfig exception:", err);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ----- build widget preview in the iframe -----
  function buildPreview() {
    if (!previewIframe || !currentSchoolId) return;

    const base = window.location.origin.replace(/\/+$/, "");

    // Html for the iframe – uses embed.js just like a real school site.
    const html = [
      "<!DOCTYPE html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8" />',
      "  <title>Widget preview</title>",
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <link rel="stylesheet" href="${base}/themes/MSSStylesheet.css?v=1" />`,
      "</head>",
      "<body>",
      '  <div id="mss-widget-container" style="padding:24px;"></div>',
      "  <script>",
      `    window.mssWidgetSchoolId = ${JSON.stringify(currentSchoolId)};`,
      "  </" + "script>",
      `  <script src="${base}/embed.js" data-school-id="${currentSchoolId}"></` +
        "script>",
      "</body>",
      "</html>",
    ].join("\n");

    previewIframe.srcdoc = html;
  }

  // ----- save config back to server -----
  async function saveConfig(ev) {
    ev.preventDefault();

    const configOut = { ...(currentConfig || {}) };
    const formOut = { ...(currentForm || {}) };
    const billingOut = { ...(currentBilling || {}) };

    // Brand & text
    const cfgHeadline = qs("#cfgHeadline");
    const cfgPoweredBy = qs("#cfgPoweredBy");
    const cfgEditableHeadline = qs("#cfgEditableHeadline");

    formOut.headline = (cfgHeadline?.value || "").trim();
    formOut.poweredByLabel = (cfgPoweredBy?.value || "").trim();
    configOut.editable = {
      ...(configOut.editable || {}),
      headline: !!(cfgEditableHeadline && cfgEditableHeadline.checked),
    };

    // Theme & behaviour
    const cfgTheme = qs("#cfgTheme");
    const cfgAllowUpload = qs("#cfgAllowUpload");
    const cfgMinSec = qs("#cfgMinSec");
    const cfgMaxSec = qs("#cfgMaxSec");

    if (cfgTheme) configOut.theme = cfgTheme.value;
    configOut.allowUpload = !!(cfgAllowUpload && cfgAllowUpload.checked);
    configOut.audioMinSeconds = Number(cfgMinSec?.value || 0);
    configOut.audioMaxSeconds = Number(cfgMaxSec?.value || 0);

    // Visibility
    const visMap = {
      showHeadline: "headline",
      showRecordButton: "recordButton",
      showPrevButton: "prevButton",
      showNextButton: "nextButton",
      showStopButton: "stopButton",
      showUploadButton: "uploadButton",
      showPoweredByLabel: "poweredByLabel",
      showNotRecordingLabel: "notRecordingLabel",
      showSubmitButton: "submitButton",
    };

    configOut.show = configOut.show || {};
    Object.entries(visMap).forEach(([id, key]) => {
      const el = qs("#" + id);
      if (el) configOut.show[key] = !!el.checked;
    });

    // Labels
    const labelMap = {
      labelRecord: "recordButton",
      labelPrev: "previousButton",
      labelNext: "nextButton",
      labelStop: "stopButton",
      labelUpload: "uploadButton",
      labelSubmit: "SubmitForScoringButton",
      labelNotRecording: "NotRecordingLabel",
    };

    Object.entries(labelMap).forEach(([inputId, formKey]) => {
      const el = qs("#" + inputId);
      if (!el) return;
      formOut[formKey] = el.value.trim();
    });

    // API & logging
    const cfgApiBaseUrl = qs("#cfgApiBaseUrl");
    const cfgApiKey = qs("#cfgApiKey");
    const cfgApiSecret = qs("#cfgApiSecret");
    const cfgLoggerEnabled = qs("#cfgLoggerEnabled");
    const cfgLoggerUrl = qs("#cfgLoggerUrl");

    configOut.api = {
      ...(configOut.api || {}),
      baseUrl: (cfgApiBaseUrl?.value || "").trim(),
      key: (cfgApiKey?.value || "").trim(),
      secret: (cfgApiSecret?.value || "").trim(),
    };

    configOut.logger = {
      ...(configOut.logger || {}),
      enabled: !!(cfgLoggerEnabled && cfgLoggerEnabled.checked),
      url: (cfgLoggerUrl?.value || "").trim(),
    };

    // Billing
    const cfgDailyLimit = qs("#cfgDailyLimit");
    const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
    const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

    billingOut.dailyLimit = Number(cfgDailyLimit?.value || 0);
    billingOut.notifyOnLimit = !!(cfgNotifyOnLimit && cfgNotifyOnLimit.checked);
    billingOut.autoBlockOnLimit = !!(
      cfgAutoBlockOnLimit && cfgAutoBlockOnLimit.checked
    );

    const payload = { config: configOut, form: formOut, billing: billingOut };

    try {
      setStatus("Saving…", "is-working");

      const res = await fetch(
        `/api/admin/widget/${encodeURIComponent(slug)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        setStatus(
          body.message || body.error || "Failed to save configuration.",
          "is-error"
        );
        console.error("saveConfig error:", body);
        return;
      }

      setStatus("Saved. Preview updated.", "is-ok");
      currentConfig = configOut;
      currentForm = formOut;
      currentBilling = billingOut;

      buildPreview();
    } catch (err) {
      console.error("saveConfig exception:", err);
      setStatus("Network error while saving configuration.", "is-error");
    }
  }

  if (formEl) {
    formEl.addEventListener("submit", saveConfig);
  }

  // Kick off initial load
  loadConfig();
})();
