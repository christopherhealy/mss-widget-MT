// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel);

  // ----- read slug from URL -----
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();
  const schoolSlugEl = qs("#mssAdminSchoolSlug");
  if (schoolSlugEl) schoolSlugEl.textContent = slug;

  // ----- wire top nav links -----
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
    // Placeholder for future reports UI
    tabReports.href = makeUrl("/reports/");
    tabReports.classList.add("is-disabled");
  }

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

  // ----- populate form from server data -----
  async function loadConfig() {
    try {
      setStatus("Loading configuration…", "is-working");
      const url = `/api/admin/widget/${encodeURIComponent(slug)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
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

      // ---- Brand / text ----
      qs("#cfgHeadline").value = currentForm.headline || "CEFR Assessment";
      qs("#cfgPoweredBy").value =
        currentForm.poweredByLabel || "Powered by MSS Vox";
      qs("#cfgEditableHeadline").checked = !!(
        currentConfig.editable?.headline ?? true
      );

      // ---- Theme & behaviour ----
      qs("#cfgTheme").value = currentConfig.theme || "apple";

      qs("#cfgAllowUpload").checked = !!(
        currentConfig.Permitupload ?? true
      );

      qs("#cfgMinSec").value =
        currentConfig.audioMinSeconds != null
          ? currentConfig.audioMinSeconds
          : 20;
      qs("#cfgMaxSec").value =
        currentConfig.audioMaxSeconds != null
          ? currentConfig.audioMaxSeconds
          : 100;

      const show = currentConfig.show || {};
      qs("#showHeadline").checked = show.headline ?? true;
      qs("#showRecordButton").checked = show.recordButton ?? true;
      qs("#showPrevButton").checked = show.prevButton ?? true;
      qs("#showNextButton").checked = show.nextButton ?? true;
      qs("#showStopButton").checked = show.stopButton ?? true;
      qs("#showUploadButton").checked = show.uploadButton ?? true;
      qs("#showPoweredByLabel").checked = show.poweredByLabel ?? true;
      qs("#showNotRecordingLabel").checked = show.notRecordingLabel ?? true;
      qs("#showSubmitButton").checked = show.submitButton ?? true;

      // ---- Labels from form ----
      qs("#labelRecord").value =
        currentForm.recordButton || "Record your response";
      qs("#labelPrev").value = currentForm.previousButton || "Previous";
      qs("#labelNext").value = currentForm.nextButton || "Next";
      qs("#labelStop").value = currentForm.stopButton || "Stop";
      qs("#labelUpload").value =
        currentForm.uploadButton || "Choose an audio file";
      qs("#labelSubmit").value =
        currentForm.SubmitForScoringButton || "Submit for scoring";
      qs("#labelNotRecording").value =
        currentForm.NotRecordingLabel || "Not recording";

      // ---- API & logging ----
      const api = currentConfig.api || {};
      qs("#cfgApiBaseUrl").value = api.baseUrl || "";
      qs("#cfgApiKey").value = api.key || "";
      qs("#cfgApiSecret").value = api.secret || "";

      const logger = currentConfig.logger || {};
      qs("#cfgLoggerEnabled").checked = !!logger.enabled;
      qs("#cfgLoggerUrl").value = logger.url || "";

      // ---- Billing ----
      qs("#cfgDailyLimit").value =
        currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50;
      qs("#cfgNotifyOnLimit").checked =
        currentBilling.notifyOnLimit ?? true;
      qs("#cfgAutoBlockOnLimit").checked =
        currentBilling.autoBlockOnLimit ?? true;

      setStatus("Configuration loaded.", "is-ok");
      buildPreview();
    } catch (err) {
      console.error("loadConfig exception:", err);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ----- build live preview iframe using embed.js + schoolId -----
  function buildPreview() {
    if (!previewIframe || !currentSchoolId) return;
    const base = window.location.origin.replace(/\/+$/, "");

    const snippetLines = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      "<head>",
      '  <meta charset="UTF-8" />',
      "  <title>Widget preview</title>",
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      `  <link rel="stylesheet" href="${base}/themes/MSSStylesheet.css?v=1" />`,
      "</head>",
      "<body>",
      '  <div id="mss-widget-container" style="padding:32px;"></div>',
      // avoid literal </script> inside JS string
      `  <script src="${base}/embed.js" data-school-id="${currentSchoolId}"></` +
        "script>",
      "</body>",
      "</html>",
    ];

    previewIframe.srcdoc = snippetLines.join("\n");
  }

  // ----- collect + save configuration back to server -----
  async function saveConfig(e) {
    e.preventDefault();

    const configOut = { ...(currentConfig || {}) };
    const formOut = { ...(currentForm || {}) };
    const billingOut = { ...(currentBilling || {}) };

    // Brand / text
    formOut.headline = qs("#cfgHeadline").value.trim();
    formOut.poweredByLabel = qs("#cfgPoweredBy").value.trim();
    configOut.editable = {
      ...(configOut.editable || {}),
      headline: qs("#cfgEditableHeadline").checked,
    };

    // Theme & behaviour
    configOut.theme = qs("#cfgTheme").value;
    configOut.Permitupload = qs("#cfgAllowUpload").checked;
    configOut.audioMinSeconds = Number(qs("#cfgMinSec").value || 0);
    configOut.audioMaxSeconds = Number(qs("#cfgMaxSec").value || 0);

    configOut.show = {
      headline: qs("#showHeadline").checked,
      recordButton: qs("#showRecordButton").checked,
      prevButton: qs("#showPrevButton").checked,
      nextButton: qs("#showNextButton").checked,
      stopButton: qs("#showStopButton").checked,
      uploadButton: qs("#showUploadButton").checked,
      poweredByLabel: qs("#showPoweredByLabel").checked,
      notRecordingLabel: qs("#showNotRecordingLabel").checked,
      submitButton: qs("#showSubmitButton").checked,
    };

    // Labels
    formOut.recordButton = qs("#labelRecord").value.trim();
    formOut.previousButton = qs("#labelPrev").value.trim();
    formOut.nextButton = qs("#labelNext").value.trim();
    formOut.stopButton = qs("#labelStop").value.trim();
    formOut.uploadButton = qs("#labelUpload").value.trim();
    formOut.SubmitForScoringButton =
      qs("#labelSubmit").value.trim();
    formOut.NotRecordingLabel =
      qs("#labelNotRecording").value.trim();

    // API & logging
    configOut.api = {
      ...(configOut.api || {}),
      baseUrl: qs("#cfgApiBaseUrl").value.trim(),
      key: qs("#cfgApiKey").value.trim(),
      secret: qs("#cfgApiSecret").value.trim(),
    };

    configOut.logger = {
      ...(configOut.logger || {}),
      enabled: qs("#cfgLoggerEnabled").checked,
      url: qs("#cfgLoggerUrl").value.trim(),
    };

    // Billing
    billingOut.dailyLimit = Number(qs("#cfgDailyLimit").value || 0);
    billingOut.notifyOnLimit = qs("#cfgNotifyOnLimit").checked;
    billingOut.autoBlockOnLimit = qs("#cfgAutoBlockOnLimit").checked;

    const payload = {
      config: configOut,
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

  // Initial load
  loadConfig();
})();