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

  // ----- top nav buttons -----
  const btnQuestions = qs("#mssAdminBtnQuestions");
  const btnReports = qs("#mssAdminBtnReports");

  if (btnQuestions) {
    btnQuestions.addEventListener("click", () => {
      window.location.href =
        "/questions-admin/?slug=" + encodeURIComponent(slug);
    });
  }

  if (btnReports) {
    // For now, just keep it disabled / no-op
    btnReports.disabled = true;
  }

  const formEl = qs("#mssConfigForm");
  const statusEl = qs("#mssAdminStatus");

  // Branding elements
  const logoImgEl = qs("#mssBrandLogoImg");
  const logoStatusEl = qs("#mssBrandLogoStatus");
  const logoFileEl = qs("#mssBrandLogoFile");

  // "Open widget" button
  const openWidgetBtn = qs("#mssOpenWidget");

  let currentSchoolId = null;
  let currentConfig = {};
  let currentForm = {};
  let currentBilling = {};
  let pendingLogoDataUrl = null; // data: URL for logo upload

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-admin-status" + (cls ? " " + cls : "");
  }

  // ----- Collapsible sections -----
  function initCollapsibles() {
    const toggles = document.querySelectorAll(".mss-admin-toggle");
    toggles.forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".mss-admin-card");
        if (!card) return;
        const collapsed = card.classList.toggle("is-collapsed");
        btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
        btn.textContent = collapsed ? "Expand" : "Collapse";
      });
    });
  }

  // ----- Load logo from server -----
  async function loadLogo() {
    if (!logoImgEl || !logoStatusEl) return;
    logoStatusEl.textContent = "Checking for logo…";
    logoImgEl.style.display = "none";

    try {
      const url =
        "/api/widget/" +
        encodeURIComponent(slug) +
        "/image/widget-logo";
      const res = await fetch(url);
      if (!res.ok) {
        logoStatusEl.textContent = "No logo uploaded yet.";
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      logoImgEl.src = objUrl;
      logoImgEl.style.display = "block";
      logoStatusEl.textContent = "Current logo";
    } catch (err) {
      console.error("loadLogo error:", err);
      logoStatusEl.textContent = "Could not load logo.";
      logoImgEl.style.display = "none";
    }
  }

  // ----- read config from server and populate form -----
  async function loadConfig() {
    try {
      setStatus("Loading configuration…", "is-working");
      const url = "/api/admin/widget/" + encodeURIComponent(slug);
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

      // --- Theme & timing / upload ---
      const cfgTheme = qs("#cfgTheme");
      const cfgAllowUpload = qs("#cfgAllowUpload");
      const cfgMinSec = qs("#cfgMinSec");
      const cfgMaxSec = qs("#cfgMaxSec");

      if (cfgTheme) cfgTheme.value = currentConfig.theme || "default";

      if (cfgAllowUpload) {
        cfgAllowUpload.checked = !!(currentConfig.Permitupload ?? true);
      }

      if (cfgMinSec) {
        cfgMinSec.value =
          currentConfig.audioMinSeconds != null
            ? currentConfig.audioMinSeconds
            : 30;
      }
      if (cfgMaxSec) {
        cfgMaxSec.value =
          currentConfig.audioMaxSeconds != null
            ? currentConfig.audioMaxSeconds
            : 61;
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

      // Load logo once config is known
      loadLogo();
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
      const url = "/api/admin/widget/" + encodeURIComponent(slug);
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

      // Config saved OK → now handle logo if needed
      if (pendingLogoDataUrl) {
        try {
          const logoRes = await fetch(
            "/api/admin/widget/" + encodeURIComponent(slug) + "/logo",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataUrl: pendingLogoDataUrl }),
            }
          );
          const logoBody = await logoRes.json().catch(() => ({}));
          if (!logoRes.ok || !logoBody.ok) {
            setStatus(
              logoBody.message ||
                logoBody.error ||
                "Configuration saved, but logo upload failed.",
              "is-error"
            );
            console.error("logo upload error:", logoBody);
          } else {
            pendingLogoDataUrl = null;
            setStatus("Configuration and logo saved.", "is-ok");
            loadLogo();
          }
        } catch (err) {
          console.error("logo upload exception:", err);
          setStatus(
            "Configuration saved, but logo upload failed.",
            "is-error"
          );
        }
      } else {
        setStatus("Configuration saved.", "is-ok");
      }

      currentConfig = configOut;
      currentForm = formOut;
      currentBilling = billingOut;
    } catch (err) {
      console.error("saveConfig exception:", err);
      setStatus("Network error while saving configuration.", "is-error");
    }
  }

  // ----- logo file selection → preview & stage for upload -----
  function initLogoUpload() {
    if (!logoFileEl) return;
    logoFileEl.addEventListener("change", () => {
      const file = logoFileEl.files && logoFileEl.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        if (logoStatusEl) {
          logoStatusEl.textContent = "Please choose an image file.";
        }
        logoFileEl.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        pendingLogoDataUrl = reader.result;
        if (logoImgEl && typeof reader.result === "string") {
          logoImgEl.src = reader.result;
          logoImgEl.style.display = "block";
        }
        if (logoStatusEl) {
          logoStatusEl.textContent =
            "Logo ready. It will be uploaded when you click Save.";
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // ----- Open widget in new tab -----
  function initOpenWidget() {
    if (!openWidgetBtn) return;
    openWidgetBtn.addEventListener("click", () => {
      const url =
        "/Widget.html?slug=" + encodeURIComponent(slug) + "&from=admin";
      window.open(url, "_blank", "noopener");
    });
  }

  // ----- wire form submit + initial load -----
  if (formEl) {
    formEl.addEventListener("submit", saveConfig);
  }

  initCollapsibles();
  initLogoUpload();
  initOpenWidget();
  loadConfig();
})();