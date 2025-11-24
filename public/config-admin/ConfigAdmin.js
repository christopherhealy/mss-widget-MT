// /config-admin/ConfigAdmin.js — Admin + Image Upload + Dashboards + Widgets
// Regen Nov 24 2025 – uses settings.{config,form,image} in Postgres
// Canonical keys: config.widgetPath, config.dashboardPath, config.afterDashboard.*
console.log("✅ ConfigAdmin.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const slugLabel = $("slugLabel");
  const saveBtn   = $("saveBtn");
  const statusEl  = $("status");

  // Dashboard + widget selectors
  const dashboardTemplateSelect = $("dashboardTemplate");
  const dashboardPreviewFrame   = $("dashboardPreview");
  const widgetTemplateSelect    = $("widgetTemplate");

  // Image / branding elements
  const imgFileInput          = $("img-file");
  const imgUploadBtn          = $("img-uploadBtn");
  const imgUploadStatus       = $("img-uploadStatus");
  const imgPreview            = $("img-preview");
  const imgPreviewPlaceholder = $("img-previewPlaceholder");

  // After-dashboard fields
  const afterSignupUrlInput   = $("afterDashboard-signupUrl");
  const afterCtaMessageInput  = $("afterDashboard-ctaMessage");

  let SLUG = null;

  // Single source of truth for admin state
  const STATE = {
    config: {},
    form: {},
    image: {},
  };

  let dirty = false;

  // Default values if DB is empty
  const DEFAULTS = {
    config: {
      title: "MySpeakingScore – Speaking Practice",
      subtitle: "Get instant feedback on your speaking",
      themeCss: "themes/MSSStylesheet.css",
      primaryColor: "#1d4ed8",
      allowUpload: true,
      allowRecording: true,
      // ✅ canonical defaults (paths, not full URLs)
      widgetPath: "/widgets/Widget.html",
      dashboardPath: "/dashboards/Dashboard3.html",
      // ✅ new after-dashboard config
      afterDashboard: {
        signupUrl: "",
        ctaMessage: "",
      },
    },
    form: {
      previousButton: "Previous",
      nextButton: "Next",
      recordButton: "Record your response",
      stopButton: "Stop",
      uploadButton: "Choose an audio file",
      SubmitForScoringButton: "Submit for scoring",
      readyStatus: "Ready to record when you are.",
      questionHelpButton: "Question Help",
      NotRecordingLabel: "Not recording",
      helpNoneLabel: "no help",
      helpSomeLabel: "a little help",
      helpMaxLabel: "lots of help",
      instructions:
        "You will see one or more speaking questions. Read the prompt carefully, then record or upload your answer.",
      helpText:
        "Speak clearly and naturally. Aim for 30–60 seconds when you respond.",
    },
    image: {
      url: "",
      alt: "Widget image",
    },
  };

  /* ------------------------------------------------------------------ */
  /* INIT                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    console.log("[ConfigAdmin] init() starting");
    const params = new URLSearchParams(window.location.search);
    SLUG = params.get("slug") || "mss-demo";

    if (slugLabel) slugLabel.textContent = SLUG;

    wireFormEvents();
    wireAfterDashboardEvents();
    wireSave();
    wireImageUpload();
    wireDashboardSelector();
    wireWidgetSelector();

    // Load DB settings first, THEN load dashboards & widgets list
    loadFromServer()
      .catch((err) => {
        console.warn("[ConfigAdmin] loadFromServer error, using defaults", err);
      })
      .finally(() => {
        console.log("[ConfigAdmin] loading dashboards + widgets lists");
        loadDashboardTemplates();
        loadWidgetTemplates();
      });
  }

  /* ------------------------------------------------------------------ */
  /* LOAD FROM SERVER                                                   */
  /* ------------------------------------------------------------------ */

  async function loadFromServer() {
    setStatus("Loading settings from server…");

    try {
      const res = await fetch(`/api/admin/widget/${encodeURIComponent(SLUG)}`);
      if (!res.ok) {
        if (res.status === 404) {
          console.warn("No settings found for slug, using defaults only.");
          STATE.config = { ...DEFAULTS.config };
          STATE.form   = { ...DEFAULTS.form };
          STATE.image  = { ...DEFAULTS.image };
          hydrateFormFromState();
          setPristine();
          setStatus("No DB record found; using defaults. Save to create.");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const settings = data.settings || {};

      // Merge with defaults
      const rawConfig = settings.config || {};
      const rawForm   = settings.form || {};
      const rawImage  = settings.image || {};

      // 🔁 Legacy field migration: widgetUrl/dashboardUrl → widgetPath/dashboardPath
      const migratedConfig = { ...rawConfig };

      if (!migratedConfig.widgetPath && migratedConfig.widgetUrl) {
        migratedConfig.widgetPath = migratedConfig.widgetUrl;
      }
      if (!migratedConfig.dashboardPath && migratedConfig.dashboardUrl) {
        migratedConfig.dashboardPath = migratedConfig.dashboardUrl;
      }

      STATE.config = {
        ...DEFAULTS.config,
        ...migratedConfig,
        // shallow-merge afterDashboard so defaults exist even if DB only has some keys
        afterDashboard: {
          ...(DEFAULTS.config.afterDashboard || {}),
          ...(migratedConfig.afterDashboard || {}),
        },
      };
      STATE.form = {
        ...DEFAULTS.form,
        ...rawForm,
      };
      STATE.image = {
        ...DEFAULTS.image,
        ...rawImage,
      };

      hydrateFormFromState();
      setPristine();
      setStatus("Loaded from Postgres.");
      console.log("[ConfigAdmin] Loaded settings from DB:", STATE);
    } catch (err) {
      console.error("Error loading settings", err);
      setStatus(
        "Error loading settings from server. Check console / network.",
        true
      );
      throw err;
    }
  }

  /* ------------------------------------------------------------------ */
  /* HYDRATE FORM                                                       */
  /* ------------------------------------------------------------------ */

  function hydrateFormFromState() {
    const allFields = document.querySelectorAll("[data-section][data-key]");

    allFields.forEach((el) => {
      const section = el.getAttribute("data-section");
      const key     = el.getAttribute("data-key");
      const type    = el.getAttribute("data-type");

      const sectionObj = STATE[section] || {};
      const value      = sectionObj[key];

      if (type === "checkbox" || el.type === "checkbox") {
        el.checked = !!value;
      } else if (el.tagName === "TEXTAREA" ||
                 el.tagName === "INPUT" ||
                 el.tagName === "SELECT") {
        el.value = value != null ? String(value) : "";
      }
    });

    // Dashboard select reflects STATE.config.dashboardPath (with legacy fallback)
    if (dashboardTemplateSelect) {
      const url =
        STATE.config.dashboardPath ||
        STATE.config.dashboardUrl ||
        DEFAULTS.config.dashboardPath;
      dashboardTemplateSelect.value = url;
      updateDashboardPreview();
    }

    // Widget select reflects STATE.config.widgetPath (with legacy fallback)
    if (widgetTemplateSelect) {
      const wurl =
        STATE.config.widgetPath ||
        STATE.config.widgetUrl ||
        DEFAULTS.config.widgetPath;
      widgetTemplateSelect.value = wurl;
    }

    // After-dashboard fields
    const after = STATE.config.afterDashboard || {};
    if (afterSignupUrlInput) {
      afterSignupUrlInput.value = after.signupUrl || "";
    }
    if (afterCtaMessageInput) {
      afterCtaMessageInput.value = after.ctaMessage || "";
    }

    syncUploadFieldVisibility();
    refreshImagePreview();
  }

  /* ------------------------------------------------------------------ */
  /* FORM EVENTS + DIRTY STATE                                          */
  /* ------------------------------------------------------------------ */

  function wireFormEvents() {
    const allFields = document.querySelectorAll("[data-section][data-key]");

    allFields.forEach((el) => {
      const eventType = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventType, () => {
        applyFieldToState(el);
        setDirty();
      });
    });
  }

  function wireAfterDashboardEvents() {
    if (afterSignupUrlInput) {
      afterSignupUrlInput.addEventListener("input", () => {
        STATE.config.afterDashboard =
          STATE.config.afterDashboard || { ...(DEFAULTS.config.afterDashboard || {}) };
        STATE.config.afterDashboard.signupUrl = afterSignupUrlInput.value;
        setDirty();
      });
    }

    if (afterCtaMessageInput) {
      afterCtaMessageInput.addEventListener("input", () => {
        STATE.config.afterDashboard =
          STATE.config.afterDashboard || { ...(DEFAULTS.config.afterDashboard || {}) };
        STATE.config.afterDashboard.ctaMessage = afterCtaMessageInput.value;
        setDirty();
      });
    }
  }

  function applyFieldToState(el) {
    const section = el.getAttribute("data-section");
    const key     = el.getAttribute("data-key");
    const type    = el.getAttribute("data-type");

    if (!section || !key) return;

    if (type === "checkbox" || el.type === "checkbox") {
      STATE[section][key] = !!el.checked;
    } else if (el.type === "number") {
      const n = el.value.trim();
      STATE[section][key] = n === "" ? null : Number(n);
    } else {
      STATE[section][key] = el.value;
    }

    if (section === "config" && key === "allowUpload") {
      syncUploadFieldVisibility();
    }
    if (section === "image" && key === "url") {
      refreshImagePreview();
    }
  }

  function setDirty() {
    dirty = true;
    if (saveBtn) saveBtn.disabled = false;
    setStatus("Changes not saved.");
  }

  function setPristine() {
    dirty = false;
    if (saveBtn) saveBtn.disabled = true;
  }

  /* ------------------------------------------------------------------ */
  /* SAVE TO SERVER                                                     */
  /* ------------------------------------------------------------------ */

  function wireSave() {
    if (!saveBtn) return;
    saveBtn.addEventListener("click", onSaveClick);
  }

  async function onSaveClick() {
    if (!dirty) return;

    saveBtn.disabled = true;
    setStatus("Saving to Postgres…");

    try {
      // 🔹 make a copy so we can normalise widget/dashboard paths
      const cfg = { ...(STATE.config || {}) };

      if (cfg.widgetUrl && !cfg.widgetPath) {
        cfg.widgetPath = cfg.widgetUrl;
      }
      if (cfg.widgetPath && !cfg.widgetUrl) {
        cfg.widgetUrl = cfg.widgetPath;
      }

      if (cfg.dashboardUrl && !cfg.dashboardPath) {
        cfg.dashboardPath = cfg.dashboardUrl;
      }
      if (cfg.dashboardPath && !cfg.dashboardUrl) {
        cfg.dashboardUrl = cfg.dashboardPath;
      }

      // Ensure afterDashboard exists & is a flat object with just the keys we care about
      const after = cfg.afterDashboard || {};
      cfg.afterDashboard = {
        signupUrl: (after.signupUrl || "").trim(),
        ctaMessage: (after.ctaMessage || "").trim(),
      };

      const payload = {
        config: cfg,
        form:   STATE.form  || {},
        image:  STATE.image || {},
      };

      const res = await fetch(
        `/api/admin/widget/${encodeURIComponent(SLUG)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data.ok) {
        console.warn("Save returned non-ok payload:", data);
      }

      setPristine();
      setStatus("Saved. Widget will use updated settings on next load.");
    } catch (err) {
      console.error("Error saving settings", err);
      saveBtn.disabled = false;
      setStatus("Error saving settings. See console / network.", true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* STATUS HELPER                                                      */
  /* ------------------------------------------------------------------ */

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  /* ------------------------------------------------------------------ */
  /* DASHBOARD TEMPLATE SELECTOR + PREVIEW                              */
  /* ------------------------------------------------------------------ */

  function wireDashboardSelector() {
    if (!dashboardTemplateSelect) return;

    dashboardTemplateSelect.addEventListener("change", () => {
      const value =
        dashboardTemplateSelect.value || DEFAULTS.config.dashboardPath;
      STATE.config.dashboardPath = value;
      setDirty();
      updateDashboardPreview();
    });
  }

  function updateDashboardPreview() {
    if (!dashboardTemplateSelect || !dashboardPreviewFrame) return;

    const value =
      dashboardTemplateSelect.value || DEFAULTS.config.dashboardPath;

    const previewUrl =
      value + (value.includes("?") ? "&preview=1" : "?preview=1");

    dashboardPreviewFrame.src = previewUrl;
  }

  async function loadDashboardTemplates() {
    if (!dashboardTemplateSelect) return;

    try {
      const res = await fetch("/api/admin/dashboards");
      if (!res.ok) throw new Error(`dashboards HTTP ${res.status}`);

      const data = await res.json();
      const list = Array.isArray(data.dashboards) ? data.dashboards : [];

      // Start from state/default, but migrate legacy "/Dashboard.html"
      let current =
        STATE.config.dashboardPath ||
        STATE.config.dashboardUrl ||
        DEFAULTS.config.dashboardPath;

      if (current === "/Dashboard.html") {
        current = DEFAULTS.config.dashboardPath;
        STATE.config.dashboardPath = current;
      }

      dashboardTemplateSelect.innerHTML = "";
      const seen = new Set();

      function addDashboard(pathOrObj) {
        if (!pathOrObj) return;

        let url, filename;

        if (typeof pathOrObj === "string") {
          url = pathOrObj.startsWith("/") ? pathOrObj : `/${pathOrObj}`;
          filename = url.split("/").pop() || url;
        } else {
          url = pathOrObj.url || pathOrObj.file;
          if (!url) return;
          if (!url.startsWith("/")) url = `/${url}`;
          filename = pathOrObj.file || url.split("/").pop() || url;
        }

        // 🚫 Hide any template dashboards
        if (filename.toLowerCase().endsWith("_template.html")) return;
        // Only show /dashboards/*
        if (!url.startsWith("/dashboards/")) return;

        if (seen.has(url)) return;
        seen.add(url);

        const opt = document.createElement("option");
        opt.value = url;
        opt.textContent = filename;
        dashboardTemplateSelect.appendChild(opt);
      }

      list.forEach(addDashboard);

      // Ensure default exists in list
      addDashboard(DEFAULTS.config.dashboardPath);

      // Ensure current is present, if it passes filters
      if (current && !seen.has(current)) {
        addDashboard(current);
      }

      // Set selection
      dashboardTemplateSelect.value = current;
      if (!dashboardTemplateSelect.value && seen.size) {
        dashboardTemplateSelect.selectedIndex = 0;
        STATE.config.dashboardPath = dashboardTemplateSelect.value;
      }

      updateDashboardPreview();
    } catch (err) {
      console.warn("Could not load dashboards; using default", err);

      dashboardTemplateSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = DEFAULTS.config.dashboardPath;
      opt.textContent = DEFAULTS.config.dashboardPath.split("/").pop();
      dashboardTemplateSelect.appendChild(opt);

      dashboardTemplateSelect.value =
        STATE.config.dashboardPath || DEFAULTS.config.dashboardPath;
      updateDashboardPreview();
    }
  }

  /* ------------------------------------------------------------------ */
  /* WIDGET TEMPLATE SELECTOR                                           */
  /* ------------------------------------------------------------------ */

  function wireWidgetSelector() {
    if (!widgetTemplateSelect) return;

    widgetTemplateSelect.addEventListener("change", () => {
      const value =
        widgetTemplateSelect.value || DEFAULTS.config.widgetPath;
      STATE.config.widgetPath = value;
      setDirty();
    });
  }

  async function loadWidgetTemplates() {
    if (!widgetTemplateSelect) {
      console.log("[ConfigAdmin] widgetTemplateSelect not found");
      return;
    }

    console.log("[ConfigAdmin] loadWidgetTemplates() starting");

    try {
      const res = await fetch("/api/admin/widgets");
      if (!res.ok) throw new Error(`widgets HTTP ${res.status}`);

      const data = await res.json();

      const list =
        Array.isArray(data)
          ? data
          : Array.isArray(data.widgets)
          ? data.widgets
          : Array.isArray(data.files)
          ? data.files
          : [];

      console.log("[ConfigAdmin] /api/admin/widgets →", list);

      const defaultWidgetPath =
        DEFAULTS.config.widgetPath || "/widgets/Widget.html";
      const current =
        STATE.config.widgetPath ||
        STATE.config.widgetUrl ||
        defaultWidgetPath;

      widgetTemplateSelect.innerHTML = "";
      const seen = new Set();

      function addWidget(nameOrPath) {
        if (!nameOrPath) return;
        const filename = nameOrPath.split("/").pop();
        const url = `/widgets/${filename}`;
        if (seen.has(url)) return;
        seen.add(url);

        const opt = document.createElement("option");
        opt.value = url;
        opt.textContent = filename;
        widgetTemplateSelect.appendChild(opt);
      }

      list.forEach(addWidget);
      addWidget("Widget.html"); // ensure baseline exists

      if (current && !seen.has(current) && current.endsWith(".html")) {
        const opt = document.createElement("option");
        opt.value = current;
        opt.textContent = current.split("/").pop() || current;
        widgetTemplateSelect.appendChild(opt);
        seen.add(current);
      }

      let target = current;
      if (!seen.has(target)) {
        target = "/widgets/Widget.html";
      }

      widgetTemplateSelect.value = target;
      if (!widgetTemplateSelect.value && widgetTemplateSelect.options.length) {
        widgetTemplateSelect.selectedIndex = 0;
        STATE.config.widgetPath = widgetTemplateSelect.value;
      } else {
        STATE.config.widgetPath = widgetTemplateSelect.value || target;
      }

      console.log(
        "[ConfigAdmin] widgetTemplateSelect final value:",
        widgetTemplateSelect.value
      );
    } catch (err) {
      console.warn("Could not load widgets; using default", err);

      widgetTemplateSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = DEFAULTS.config.widgetPath || "/widgets/Widget.html";
      opt.textContent = "Widget.html";
      widgetTemplateSelect.appendChild(opt);

      widgetTemplateSelect.value =
        STATE.config.widgetPath ||
        DEFAULTS.config.widgetPath ||
        "/widgets/Widget.html";
      STATE.config.widgetPath = widgetTemplateSelect.value;
    }
  }

  /* ------------------------------------------------------------------ */
  /* UPLOAD LABEL VISIBILITY + IMAGE PREVIEW                            */
  /* ------------------------------------------------------------------ */

  function syncUploadFieldVisibility() {
    const uploadInput = $("form-uploadButton");
    if (!uploadInput) return;

    const fieldWrapper = uploadInput.closest(".field");
    const allow = !!(STATE.config && STATE.config.allowUpload);

    if (fieldWrapper) {
      if (allow) {
        fieldWrapper.classList.remove("hidden");
      } else {
        fieldWrapper.classList.add("hidden");
      }
    }
    uploadInput.disabled = !allow;
  }

  function refreshImagePreview() {
    if (!imgPreview || !imgPreviewPlaceholder) return;

    const url = (STATE.image && STATE.image.url) || "";
    if (url) {
      imgPreview.src = url;
      imgPreview.style.display = "block";
      imgPreviewPlaceholder.style.display = "none";
    } else {
      imgPreview.src = "";
      imgPreview.style.display = "none";
      imgPreviewPlaceholder.style.display = "inline";
    }
  }

  /* ------------------------------------------------------------------ */
  /* IMAGE UPLOAD                                                       */
  /* ------------------------------------------------------------------ */

  function wireImageUpload() {
    if (!imgUploadBtn || !imgFileInput) return;

    imgUploadBtn.addEventListener("click", () => {
      imgFileInput.click();
    });

    imgFileInput.addEventListener("change", async () => {
      const file = imgFileInput.files && imgFileInput.files[0];
      if (!file) return;

      if (imgPreview && imgPreviewPlaceholder) {
        const localUrl = URL.createObjectURL(file);
        imgPreview.src = localUrl;
        imgPreview.style.display = "block";
        imgPreviewPlaceholder.style.display = "none";
      }

      if (imgUploadStatus) imgUploadStatus.textContent = "Uploading…";

      try {
        const formData = new FormData();
        formData.append("image", file);

        const res = await fetch(
          `/api/admin/widget/${encodeURIComponent(SLUG)}/image-upload`,
          {
            method: "POST",
            body: formData,
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.ok || !data.url) {
          throw new Error("Upload response missing url");
        }

        STATE.image = STATE.image || {};
        STATE.image.url = data.url;

        refreshImagePreview();
        setDirty();

        if (imgUploadStatus) {
          imgUploadStatus.textContent = "Image uploaded. Don't forget to Save.";
        }
      } catch (err) {
        console.error("Image upload error", err);
        if (imgUploadStatus) {
          imgUploadStatus.textContent = "Upload failed. See console.";
        }
      }
    });
  }

  // Kick things off
  document.addEventListener("DOMContentLoaded", init);
})();