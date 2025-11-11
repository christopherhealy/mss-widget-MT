// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel); 

  // ----- read slug from URL -----
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  // Show slug in header
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

   // ----- build widget preview iframe -----
  function buildPreview() {
    if (!previewIframe) return;

    const base = window.location.origin.replace(/\/+$/, "");
    // Load the real widget page for this school inside the iframe
    const url = `${base}/Widget.html?slug=${encodeURIComponent(currentSlug)}`;

    // Simple: just point the iframe at the widget page
    previewIframe.src = url;
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
      const cfgHeadline = qs("#cfgHeadline");
      const cfgPoweredBy = qs("#cfgPoweredBy");
      const cfgEditableHeadline = qs("#cfgEditableHeadline");

      if (cfgHeadline)
        cfgHeadline.value = currentForm.headline || "CEFR Assessment";
      if (cfgPoweredBy)
        cfgPoweredBy.value =
          currentForm.poweredByLabel || "Powered by MSS Vox";
      if (cfgEditableHeadline)
        cfgEditableHeadline.checked = !!(
          currentConfig.editable?.headline ?? true
        );

      // ---- Theme & behaviour ----
      const cfgTheme = qs("#cfgTheme");
      const cfgAllowUpload = qs("#cfgAllowUpload");
      const cfgMinSec = qs("#cfgMinSec");
      const cfgMaxSec = qs("#cfgMaxSec");

      if (cfgTheme) cfgTheme.value = currentConfig.theme || "apple";
      if (cfgAllowUpload)
        cfgAllowUpload.checked = !!(currentConfig.Permitupload ?? true);

      if (cfgMinSec)
        cfgMinSec.value =
          currentConfig.audioMinSeconds != null
            ? currentConfig.audioMinSeconds
            : 20;
      if (cfgMaxSec)
        cfgMaxSec.value =
          currentConfig.audioMaxSeconds != null
            ? currentConfig.audioMaxSeconds
            : 100;

      const show = currentConfig.show || {};
      const showHeadline = qs("#showHeadline");
      const showRecordButton = qs("#showRecordButton");
      const showPrevButton = qs("#showPrevButton");
      const showNextButton = qs("#showNextButton");
      const showStopButton = qs("#showStopButton");
      const showUploadButton = qs("#showUploadButton");
      const showPoweredByLabel = qs("#showPoweredByLabel");
      const showNotRecordingLabel = qs("#showNotRecordingLabel");
      const showSubmitButton = qs("#showSubmitButton");

      if (showHeadline) showHeadline.checked = show.headline ?? true;
      if (showRecordButton)
        showRecordButton.checked = show.recordButton ?? true;
      if (showPrevButton) showPrevButton.checked = show.prevButton ?? true;
      if (showNextButton) showNextButton.checked = show.nextButton ?? true;
      if (showStopButton) showStopButton.checked = show.stopButton ?? true;
      if (showUploadButton)
        showUploadButton.checked = show.uploadButton ?? true;
      if (showPoweredByLabel)
        showPoweredByLabel.checked = show.poweredByLabel ?? true;
      if (showNotRecordingLabel)
        showNotRecordingLabel.checked = show.notRecordingLabel ?? true;
      if (showSubmitButton)
        showSubmitButton.checked = show.submitButton ?? true;

      // ---- Labels from form ----
      const labelRecord = qs("#labelRecord");
      const labelPrev = qs("#labelPrev");
      const labelNext = qs("#labelNext");
      const labelStop = qs("#labelStop");
      const labelUpload = qs("#labelUpload");
      const labelSubmit = qs("#labelSubmit");
      const labelNotRecording = qs("#labelNotRecording");

      if (labelRecord)
        labelRecord.value =
          currentForm.recordButton || "Record your response";
      if (labelPrev) labelPrev.value = currentForm.previousButton || "Previous";
      if (labelNext) labelNext.value = currentForm.nextButton || "Next";
      if (labelStop) labelStop.value = currentForm.stopButton || "Stop";
      if (labelUpload)
        labelUpload.value =
          currentForm.uploadButton || "Choose an audio file";
      if (labelSubmit)
        labelSubmit.value =
          currentForm.SubmitForScoringButton || "Submit for scoring";
      if (labelNotRecording)
        labelNotRecording.value =
          currentForm.NotRecordingLabel || "Not recording";

      // ---- API & logging ----
      const api = currentConfig.api || {};
      const cfgApiBaseUrl = qs("#cfgApiBaseUrl");
      const cfgApiKey = qs("#cfgApiKey");
      const cfgApiSecret = qs("#cfgApiSecret");

      if (cfgApiBaseUrl) cfgApiBaseUrl.value = api.baseUrl || "";
      if (cfgApiKey) cfgApiKey.value = api.key || "";
      if (cfgApiSecret) cfgApiSecret.value = api.secret || "";

      const logger = currentConfig.logger || {};
      const cfgLoggerEnabled = qs("#cfgLoggerEnabled");
      const cfgLoggerUrl = qs("#cfgLoggerUrl");

      if (cfgLoggerEnabled) cfgLoggerEnabled.checked = !!logger.enabled;
      if (cfgLoggerUrl) cfgLoggerUrl.value = logger.url || "";

      // ---- Billing ----
      const cfgDailyLimit = qs("#cfgDailyLimit");
      const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
      const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

      if (cfgDailyLimit)
        cfgDailyLimit.value =
          currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50;
      if (cfgNotifyOnLimit)
        cfgNotifyOnLimit.checked = currentBilling.notifyOnLimit ?? true;
      if (cfgAutoBlockOnLimit)
        cfgAutoBlockOnLimit.checked =
          currentBilling.autoBlockOnLimit ?? true;

      setStatus("Configuration loaded.", "is-ok");
      buildPreview();
    } catch (err) {
      console.error("loadConfig exception:", err);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ----- collect + save configuration back to server -----
  async function saveConfig(e) {
    e.preventDefault();

    const configOut = { ...(currentConfig || {}) };
    const formOut = { ...(currentForm || {}) };
    const billingOut = { ...(currentBilling || {}) };

    // Brand / text
    const cfgHeadline = qs("#cfgHeadline");
    const cfgPoweredBy = qs("#cfgPoweredBy");
    const cfgEditableHeadline = qs("#cfgEditableHeadline");

    if (cfgHeadline) formOut.headline = cfgHeadline.value.trim();
    if (cfgPoweredBy) formOut.poweredByLabel = cfgPoweredBy.value.trim();

    configOut.editable = {
      ...(configOut.editable || {}),
      headline: cfgEditableHeadline ? cfgEditableHeadline.checked : true,
    };

    // Theme & behaviour
    const cfgTheme = qs("#cfgTheme");
    const cfgAllowUpload = qs("#cfgAllowUpload");
    const cfgMinSec = qs("#cfgMinSec");
    const cfgMaxSec = qs("#cfgMaxSec");

    if (cfgTheme) configOut.theme = cfgTheme.value;
    if (cfgAllowUpload)
      configOut.Permitupload = cfgAllowUpload.checked;
    if (cfgMinSec)
      configOut.audioMinSeconds = Number(cfgMinSec.value || 0);
    if (cfgMaxSec)
      configOut.audioMaxSeconds = Number(cfgMaxSec.value || 0);

    const show = {};
    const showHeadline = qs("#showHeadline");
    const showRecordButton = qs("#showRecordButton");
    const showPrevButton = qs("#showPrevButton");
    const showNextButton = qs("#showNextButton");
    const showStopButton = qs("#showStopButton");
    const showUploadButton = qs("#showUploadButton");
    const showPoweredByLabel = qs("#showPoweredByLabel");
    const showNotRecordingLabel = qs("#showNotRecordingLabel");
    const showSubmitButton = qs("#showSubmitButton");

    show.headline = showHeadline ? showHeadline.checked : true;
    show.recordButton = showRecordButton
      ? showRecordButton.checked
      : true;
    show.prevButton = showPrevButton ? showPrevButton.checked : true;
    show.nextButton = showNextButton ? showNextButton.checked : true;
    show.stopButton = showStopButton ? showStopButton.checked : true;
    show.uploadButton = showUploadButton
      ? showUploadButton.checked
      : true;
    show.poweredByLabel = showPoweredByLabel
      ? showPoweredByLabel.checked
      : true;
    show.notRecordingLabel = showNotRecordingLabel
      ? showNotRecordingLabel.checked
      : true;
    show.submitButton = showSubmitButton
      ? showSubmitButton.checked
      : true;

    configOut.show = show;

    // Labels
    const labelRecord = qs("#labelRecord");
    const labelPrev = qs("#labelPrev");
    const labelNext = qs("#labelNext");
    const labelStop = qs("#labelStop");
    const labelUpload = qs("#labelUpload");
    const labelSubmit = qs("#labelSubmit");
    const labelNotRecording = qs("#labelNotRecording");

    if (labelRecord)
      formOut.recordButton = labelRecord.value.trim();
    if (labelPrev)
      formOut.previousButton = labelPrev.value.trim();
    if (labelNext)
      formOut.nextButton = labelNext.value.trim();
    if (labelStop) formOut.stopButton = labelStop.value.trim();
    if (labelUpload)
      formOut.uploadButton = labelUpload.value.trim();
    if (labelSubmit)
      formOut.SubmitForScoringButton = labelSubmit.value.trim();
    if (labelNotRecording)
      formOut.NotRecordingLabel = labelNotRecording.value.trim();

    // API & logging
    const cfgApiBaseUrl = qs("#cfgApiBaseUrl");
    const cfgApiKey = qs("#cfgApiKey");
    const cfgApiSecret = qs("#cfgApiSecret");

    configOut.api = {
      ...(configOut.api || {}),
      baseUrl: cfgApiBaseUrl ? cfgApiBaseUrl.value.trim() : "",
      key: cfgApiKey ? cfgApiKey.value.trim() : "",
      secret: cfgApiSecret ? cfgApiSecret.value.trim() : "",
    };

    const cfgLoggerEnabled = qs("#cfgLoggerEnabled");
    const cfgLoggerUrl = qs("#cfgLoggerUrl");

    configOut.logger = {
      ...(configOut.logger || {}),
      enabled: cfgLoggerEnabled ? cfgLoggerEnabled.checked : false,
      url: cfgLoggerUrl ? cfgLoggerUrl.value.trim() : "",
    };

    // Billing
    const cfgDailyLimit = qs("#cfgDailyLimit");
    const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
    const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

    billingOut.dailyLimit = cfgDailyLimit
      ? Number(cfgDailyLimit.value || 0)
      : 0;
    billingOut.notifyOnLimit = cfgNotifyOnLimit
      ? cfgNotifyOnLimit.checked
      : true;
    billingOut.autoBlockOnLimit = cfgAutoBlockOnLimit
      ? cfgAutoBlockOnLimit.checked
      : true;

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
