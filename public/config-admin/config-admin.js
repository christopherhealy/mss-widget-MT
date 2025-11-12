// public/config-admin/config-admin.js
console.log("✅ config-admin.js loaded");

(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------- slug ----------
  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();
  const schoolSlugEl = $("#mssAdminSchoolSlug");
  if (schoolSlugEl) schoolSlugEl.textContent = slug;

  // ---------- nav buttons ----------
  const btnQuestions = $("#mssAdminBtnQuestions");
  const btnReports = $("#mssAdminBtnReports");
  if (btnQuestions) {
    btnQuestions.addEventListener("click", () => {
      // This path should serve your WidgetSurvey Questions Admin
      window.location.href = "/questions-admin/?slug=" + encodeURIComponent(slug);
    });
  }
  if (btnReports) btnReports.disabled = true; // future

  // ---------- form + status ----------
  const formEl = $("#mssConfigForm");
  const statusEl = $("#mssAdminStatus");
  const setStatus = (msg, cls) => {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-admin-status" + (cls ? " " + cls : "");
  };

  // ---------- logo controls ----------
  const logoImgEl = $("#mssBrandLogoImg");
  const logoStatusEl = $("#mssBrandLogoStatus");
  const logoFileEl = $("#mssBrandLogoFile");
  let pendingLogoDataUrl = null;

  async function loadLogo() {
    if (!logoImgEl || !logoStatusEl) return;
    logoStatusEl.textContent = "Checking for logo…";
    logoImgEl.style.display = "none";
    try {
      const url = "/api/widget/" + encodeURIComponent(slug) + "/image/widget-logo";
      const res = await fetch(url);
      if (!res.ok) {
        logoStatusEl.textContent = "No logo uploaded yet.";
        return;
      }
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      logoImgEl.src = obj;
      logoImgEl.style.display = "block";
      logoStatusEl.textContent = "Current logo";
    } catch (e) {
      console.error("loadLogo:", e);
      logoStatusEl.textContent = "Could not load logo.";
    }
  }

  function initLogoUpload() {
    if (!logoFileEl) return;
    logoFileEl.addEventListener("change", () => {
      const file = logoFileEl.files && logoFileEl.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        logoStatusEl && (logoStatusEl.textContent = "Please choose an image file.");
        logoFileEl.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        pendingLogoDataUrl = String(reader.result || "");
        if (logoImgEl) {
          logoImgEl.src = pendingLogoDataUrl;
          logoImgEl.style.display = "block";
        }
        logoStatusEl && (logoStatusEl.textContent = "Logo ready. It will upload on Save.");
      };
      reader.readAsDataURL(file);
    });
  }

  // ---------- collapsibles (default: collapsed with chevrons) ----------
  function initCollapsibles() {
    // Collapse all on init
    document.querySelectorAll(".mss-admin-card").forEach((card) => {
      card.classList.add("is-collapsed");
    });
    document.querySelectorAll(".mss-admin-toggle").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
      btn.innerHTML = '<span class="mss-chevron" aria-hidden="true">▸</span> Expand';
      btn.addEventListener("click", () => {
        const card = btn.closest(".mss-admin-card");
        if (!card) return;
        const nowCollapsed = card.classList.toggle("is-collapsed");
        const chev = btn.querySelector(".mss-chevron");
        btn.setAttribute("aria-expanded", nowCollapsed ? "false" : "true");
        if (nowCollapsed) {
          btn.lastChild && (btn.lastChild.textContent = " Expand");
          if (chev) chev.textContent = "▸";
        } else {
          btn.lastChild && (btn.lastChild.textContent = " Collapse");
          if (chev) chev.textContent = "▾";
        }
      });
    });
  }

  // ---------- open widget ----------
  const openWidgetBtn = $("#mssOpenWidget");
  function initOpenWidget() {
    if (!openWidgetBtn) return;
    openWidgetBtn.addEventListener("click", () => {
      const url = "/Widget.html?slug=" + encodeURIComponent(slug) + "&from=admin";
      window.open(url, "_blank", "noopener");
    });
  }

  // ---------- state ----------
  let currentSchoolId = null;
  let currentConfig = {};
  let currentForm = {};
  let currentBilling = {};

  // ---------- load config ----------
  async function loadConfig() {
    try {
      setStatus("Loading configuration…", "is-working");
      const url = "/api/admin/widget/" + encodeURIComponent(slug);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        setStatus(body.message || body.error || "Could not load configuration.", "is-error");
        console.error("loadConfig error:", body);
        return;
      }

      currentSchoolId = body.schoolId;
      currentConfig = body.config || {};
      currentForm = body.form || {};
      currentBilling = body.billing || {};

      // --- Brand & text
      $("#cfgHeadline") && ($("#cfgHeadline").value = currentForm.headline || "CEFR Assessment");
      $("#cfgPoweredBy") &&
        ($("#cfgPoweredBy").value = currentForm.poweredByLabel || "Powered by MSS Vox");
      $("#cfgEditableHeadline") &&
        ($("#cfgEditableHeadline").checked = !!(currentConfig.editable?.headline ?? true));

      // --- Theme & timing / upload
      $("#cfgTheme") && ($("#cfgTheme").value = currentConfig.theme || "default");
      $("#cfgAllowUpload") &&
        ($("#cfgAllowUpload").checked = !!(currentConfig.Permitupload ?? true));
      $("#cfgMinSec") &&
        ($("#cfgMinSec").value =
          currentConfig.audioMinSeconds != null ? currentConfig.audioMinSeconds : 30);
      $("#cfgMaxSec") &&
        ($("#cfgMaxSec").value =
          currentConfig.audioMaxSeconds != null ? currentConfig.audioMaxSeconds : 61);

      // --- Buttons visibility
      const show = currentConfig.show || {};
      const vis = {
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
      Object.entries(vis).forEach(([id, key]) => {
        const el = $("#" + id);
        if (el) el.checked = show[key] ?? true;
      });

      // --- Labels
      const labels = {
        labelRecord: ["recordButton", "Record your response"],
        labelPrev: ["previousButton", "Previous"],
        labelNext: ["nextButton", "Next"],
        labelStop: ["stopButton", "Stop"],
        labelUpload: ["uploadButton", "Choose an audio file"],
        labelSubmit: ["SubmitForScoringButton", "Submit for scoring"],
        labelNotRecording: ["NotRecordingLabel", "Not recording"],
      };
      Object.entries(labels).forEach(([id, [key, defVal]]) => {
        const el = $("#" + id);
        if (el) el.value = currentForm[key] || defVal;
      });

      // --- API & logging
      const api = currentConfig.api || {};
      const logger = currentConfig.logger || {};
      $("#cfgApiBaseUrl") && ($("#cfgApiBaseUrl").value = api.baseUrl || "");
      $("#cfgApiKey") && ($("#cfgApiKey").value = api.key || "");
      $("#cfgApiSecret") && ($("#cfgApiSecret").value = api.secret || "");
      $("#cfgLoggerEnabled") && ($("#cfgLoggerEnabled").checked = !!logger.enabled);
      $("#cfgLoggerUrl") && ($("#cfgLoggerUrl").value = logger.url || "");

      // --- Billing
      $("#cfgDailyLimit") &&
        ($("#cfgDailyLimit").value =
          currentBilling.dailyLimit != null ? currentBilling.dailyLimit : 50);
      $("#cfgNotifyOnLimit") &&
        ($("#cfgNotifyOnLimit").checked = currentBilling.notifyOnLimit ?? true);
      $("#cfgAutoBlockOnLimit") &&
        ($("#cfgAutoBlockOnLimit").checked = currentBilling.autoBlockOnLimit ?? true);

      setStatus("Configuration loaded.", "is-ok");
      loadLogo();
    } catch (e) {
      console.error("loadConfig exception:", e);
      setStatus("Network error while loading configuration.", "is-error");
    }
  }

  // ---------- save config ----------
  async function saveConfig(e) {
    e.preventDefault();

    const cfgOut = { ...(currentConfig || {}) };
    const formOut = { ...(currentForm || {}) };
    const billOut = { ...(currentBilling || {}) };

    // Brand / text
    formOut.headline = ($("#cfgHeadline")?.value || "").trim();
    formOut.poweredByLabel = ($("#cfgPoweredBy")?.value || "").trim();
    cfgOut.editable = {
      ...(cfgOut.editable || {}),
      headline: !!$("#cfgEditableHeadline")?.checked,
    };

    // Theme / timings / upload
    cfgOut.theme = $("#cfgTheme")?.value || "default";
    cfgOut.Permitupload = !!$("#cfgAllowUpload")?.checked;
    cfgOut.audioMinSeconds = Number($("#cfgMinSec")?.value || 0);
    cfgOut.audioMaxSeconds = Number($("#cfgMaxSec")?.value || 0);

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
    const showOut = { ...(cfgOut.show || {}) };
    Object.entries(visMap).forEach(([id, key]) => {
      const el = $("#" + id);
      if (el) showOut[key] = !!el.checked;
    });
    cfgOut.show = showOut;

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
    Object.entries(labelMap).forEach(([id, key]) => {
      const el = $("#" + id);
      if (el) formOut[key] = (el.value || "").trim();
    });

    // API / logging
    cfgOut.api = {
      ...(cfgOut.api || {}),
      baseUrl: ($("#cfgApiBaseUrl")?.value || "").trim(),
      key: ($("#cfgApiKey")?.value || "").trim(),
      secret: ($("#cfgApiSecret")?.value || "").trim(),
    };
    cfgOut.logger = {
      ...(cfgOut.logger || {}),
      enabled: !!$("#cfgLoggerEnabled")?.checked,
      url: ($("#cfgLoggerUrl")?.value || "").trim(),
    };

    // Billing
    billOut.dailyLimit = Number($("#cfgDailyLimit")?.value || 0);
    billOut.notifyOnLimit = !!$("#cfgNotifyOnLimit")?.checked;
    billOut.autoBlockOnLimit = !!$("#cfgAutoBlockOnLimit")?.checked;

    const payload = { config: cfgOut, form: formOut, billing: billOut };

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
        setStatus(body.message || body.error || "Failed to save configuration.", "is-error");
        console.error("saveConfig error:", body);
        return;
      }

      if (pendingLogoDataUrl) {
        try {
          const lres = await fetch(
            "/api/admin/widget/" + encodeURIComponent(slug) + "/logo",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dataUrl: pendingLogoDataUrl }),
            }
          );
          const lbody = await lres.json().catch(() => ({}));
          if (!lres.ok || !lbody.ok) {
            setStatus(
              lbody.message || lbody.error || "Configuration saved, logo upload failed.",
              "is-error"
            );
          } else {
            pendingLogoDataUrl = null;
            setStatus("Configuration and logo saved.", "is-ok");
            loadLogo();
          }
        } catch (e) {
          console.error("logo upload exception:", e);
          setStatus("Configuration saved, logo upload failed.", "is-error");
        }
      } else {
        setStatus("Configuration saved.", "is-ok");
      }

      currentConfig = cfgOut;
      currentForm = formOut;
      currentBilling = billOut;
    } catch (e) {
      console.error("saveConfig exception:", e);
      setStatus("Network error while saving configuration.", "is-error");
    }
  }

  // ---------- wire up ----------
  if (formEl) formEl.addEventListener("submit", saveConfig);
  initCollapsibles();
  initLogoUpload();
  initOpenWidget();
  loadConfig();
})();