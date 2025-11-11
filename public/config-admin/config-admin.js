// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel);

  // ----- slug + school label -----
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  const schoolSlugEl = qs("#mssAdminSchoolSlug");
  if (schoolSlugEl) {
    schoolSlugEl.textContent = slug;
  }

  // ----- top nav links -----
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

  const formEl = qs("#mssConfigForm");
  const statusEl = qs("#mssAdminStatus");

  // preview modal elements
  const previewBtn = qs("#mssOpenPreview");
  const previewOverlay = qs("#mssPreviewOverlay");
  const previewFrame = qs("#mssPreviewFrame");
  const previewClose = qs("#mssPreviewClose");
  const previewBackdrop = previewOverlay
    ? previewOverlay.querySelector(".mss-admin-overlay-backdrop")
    : null;

  let currentSchoolId = null;
  let currentConfig = {};
  let currentForm = {};
  let currentBilling = {};

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-admin-status" + (cls ? " " + cls : "");
  }

  // ----- load config from server and populate form -----
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

      // --- Brand & text ---
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

      // --- Theme & behaviour ---
      const cfgTheme = qs("#cfgTheme");
      const cfgAllowUpload = qs("#cfgAllowUpload");
      const cfgMinSec = qs("#cfgMinSec");
      const cfgMaxSec = qs("#cfgMaxSec");

      if (cfgTheme) {
        cfgTheme.value = currentConfig.theme || "default";
      }

      if (cfgAllowUpload) {
        cfgAllowUpload.checked = !!(
          currentConfig.Permitupload ?? true
        );
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

      // --- Buttons visibility ---
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
        if (!el) return;
        // default true if not set
        el.checked = show[key] ?? true;
      });

      // --- Labels from form ---
      const labelMap = {
        labelRecord: ["recordButton", "Record your response"],
        labelPrev: ["previousButton", "Previous"],
        labelNext: ["nextButton", "Next"],
        labelStop: ["stopButton", "Stop"],
        labelUpload: ["uploadButton", "Choose an audio file"],
        labelSubmit: ["SubmitForScoringButton", "Submit for scoring"],
        labelNotRecording: ["NotRecordingLabel", "Not recording"],
      };

      Object.entries(labelMap).forEach(([id, [key, fallback]]) => {
        const el = qs("#" + id);
        if (!el) return;
        el.value = currentForm[key] || fallback;
      });

      // --- API & logging ---
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

      // --- Billing ---
      const cfgDailyLimit = qs("#cfgDailyLimit");
      const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
      const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

      if (cfgDailyLimit) {
        cfgDailyLimit.value =
          currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50;
      }
      if (cfgNotifyOnLimit) {
        cfgNotifyOnLimit.checked = currentBilling.notifyOnLimit ?? true;
      }
      if (cfgAutoBlockOnLimit) {
        cfgAutoBlockOnLimit.checked = currentBilling.autoBlockOnLimit ?? true;
      }

      setStatus("Configuration loaded.", "is-ok");
    } catch (err) {
      console.error("loadConfig exception:", err);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ----- save config back to server -----
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
    if (cfgAllowUpload) configOut.Permitupload = cfgAllowUpload.checked;
    if (cfgMinSec) configOut.audioMinSeconds = Number(cfgMinSec.value || 0);
    if (cfgMaxSec) configOut.audioMaxSeconds = Number(cfgMaxSec.value || 0);

    // Buttons visibility
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

    const showOut = { ...(configOut.show || {}) };
    Object.entries(visMap).forEach(([id, key]) => {
      const el = qs("#" + id);
      if (!el) return;
      showOut[key] = el.checked;
    });
    configOut.show = showOut;

    // Labels
    const labelMap = {
      labelRecord: ["recordButton"],
      labelPrev: ["previousButton"],
      labelNext: ["nextButton"],
      labelStop: ["stopButton"],
      labelUpload: ["uploadButton"],
      labelSubmit: ["SubmitForScoringButton"],
      labelNotRecording: ["NotRecordingLabel"],
    };

    Object.entries(labelMap).forEach(([id, [key]]) => {
      const el = qs("#" + id);
      if (!el) return;
      formOut[key] = el.value.trim();
    });

    // API & logging
    const cfgApiBaseUrl = qs("#cfgApiBaseUrl");
    const cfgApiKey = qs("#cfgApiKey");
    const cfgApiSecret = qs("#cfgApiSecret");
    const cfgLoggerEnabled = qs("#cfgLoggerEnabled");
    const cfgLoggerUrl = qs("#cfgLoggerUrl");

    configOut.api = {
      ...(configOut.api || {}),
      baseUrl: cfgApiBaseUrl ? cfgApiBaseUrl.value.trim() : "",
      key: cfgApiKey ? cfgApiKey.value.trim() : "",
      secret: cfgApiSecret ? cfgApiSecret.value.trim() : "",
    };

    configOut.logger = {
      ...(configOut.logger || {}),
      enabled: cfgLoggerEnabled ? cfgLoggerEnabled.checked : false,
      url: cfgLoggerUrl ? cfgLoggerUrl.value.trim() : "",
    };

    // Billing
    const cfgDailyLimit = qs("#cfgDailyLimit");
    const cfgNotifyOnLimit = qs("#cfgNotifyOnLimit");
    const cfgAutoBlockOnLimit = qs("#cfgAutoBlockOnLimit");

    billingOut.dailyLimit = Number(cfgDailyLimit?.value || 0);
    billingOut.notifyOnLimit = !!cfgNotifyOnLimit?.checked;
    billingOut.autoBlockOnLimit = !!cfgAutoBlockOnLimit?.checked;

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

      setStatus("Saved. Re-open preview to see changes.", "is-ok");
      currentConfig = configOut;
      currentForm = formOut;
      currentBilling = billingOut;
    } catch (err) {
      console.error("saveConfig exception:", err);
      setStatus("Network error while saving configuration.", "is-error");
    }
  }

  // ----- preview overlay handlers -----
   // ----- preview overlay handlers -----
  function openPreview() {
    if (!previewOverlay || !previewFrame) return;

    if (!currentSchoolId) {
      alert("Cannot open preview yet: school ID has not loaded.");
      return;
    }

    const base = window.location.origin.replace(/\/+$/, "");
    const url =
      base +
      "/config-admin/widget-preview.html?schoolId=" +
      encodeURIComponent(currentSchoolId);

    previewFrame.src = url;
    previewOverlay.classList.remove("mss-hidden");
  }

  function closePreview() {
    if (!previewOverlay) return;
    previewOverlay.classList.add("mss-hidden");
  }

  if (previewBtn) {
    previewBtn.addEventListener("click", openPreview);
  }
  if (previewClose) {
    previewClose.addEventListener("click", closePreview);
  }
  if (previewBackdrop) {
    previewBackdrop.addEventListener("click", closePreview);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreview();
  });

  // ----- wire form submit + initial load -----
  if (formEl) {
    formEl.addEventListener("submit", saveConfig);
  }

  loadConfig();
})();