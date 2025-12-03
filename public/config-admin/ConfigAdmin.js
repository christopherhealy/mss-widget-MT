// /config-admin/ConfigAdmin.js — Admin + Image Upload + Dashboards + Widgets
// Single-school mode + School rename + optional multi-school selector
// Uses settings.{config,form,image} in Postgres
// Canonical keys: config.widgetPath, config.dashboardPath, config.afterDashboard.*
// Dec 3 refresh - working on Vercel functionality

console.log("✅ ConfigAdmin.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Header + School Settings
  const slugLabel        = $("slugLabel");
  const currentSlugLabel = $("currentSlugLabel");   // rename panel label
  const schoolNameInput  = $("schoolNameInput");    // rename panel input
  const schoolRenameBtn  = $("schoolRenameBtn");    // rename panel button
  const schoolSelector   = $("schoolSelector");     // optional multi-school selector

  const saveBtn  = $("saveBtn");
  const statusEl = $("status");

  let SLUG  = null;
  let dirty = false;

  const STATE = {
    config: {},   // widget + dashboard config
    form:   {},
    image:  {},
  };

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
  const afterSignupUrlInput  = $("afterDashboard-signupUrl");
  const afterCtaMessageInput = $("afterDashboard-ctaMessage");

  // Default values if DB is empty
  const DEFAULTS = {
    config: {
      title: "MySpeakingScore – Speaking Practice",
      subtitle: "Get instant feedback on your speaking",
      themeCss: "themes/MSSStylesheet.css",
      primaryColor: "#1d4ed8",
      allowUpload: true,
      allowRecording: true,
      // canonical defaults (paths, not full URLs)
      widgetPath: "/widgets/Widget.html",
      dashboardPath: "/dashboards/Dashboard3.html",
      // after-dashboard config
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
  /* STATUS HELPER                                                      */
  /* ------------------------------------------------------------------ */

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", !!isError);
  }

  /* ------------------------------------------------------------------ */
  /* ADMIN API BASE + URL HELPERS                                       */
  /* ------------------------------------------------------------------ */

  // Decide which origin to call for admin APIs
  // - Local dev + Render full-stack → same origin
  // - Vercel front-end             → call Render backend
  function getAdminApiBase() {
    const origin = window.location.origin || "";

    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.includes("mss-widget-mt.onrender.com")
    ) {
      return "";
    }

    if (origin.includes("mss-widget-mt.vercel.app")) {
      return "https://mss-widget-mt.onrender.com";
    }

    return "";
  }

  const ADMIN_API_BASE = getAdminApiBase();

  function absolutizeImageUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path; // already absolute

    // If it's just a filename, treat as /uploads/filename
    let p = path;
    if (!p.startsWith("/")) {
      p = `/uploads/${p}`;
    }

    // If ADMIN_API_BASE is empty, this resolves to same-origin
    return `${ADMIN_API_BASE}${p}`;
  }

  /* ------------------------------------------------------------------ */
  /* SLUG / SCHOOL HELPERS                                              */
  /* ------------------------------------------------------------------ */

  function updateSlugUi(slug, name) {
    SLUG = slug;
    if (slugLabel)        slugLabel.textContent = slug || "—";
    if (currentSlugLabel) currentSlugLabel.textContent = slug || "—";

    if (schoolNameInput && name) {
      schoolNameInput.value = name;
    }

    // Keep the selector in sync if present
    if (schoolSelector && slug) {
      const opt = schoolSelector.querySelector(`option[value="${slug}"]`);
      if (opt) schoolSelector.value = slug;
    }
  }

  function updateSlugInUrl(slug) {
    if (!slug) return;
    try {
      const url    = new URL(window.location.href);
      const params = url.searchParams;
      params.set("slug", slug);
      url.search = params.toString();
      window.history.replaceState({}, "", url.toString());
    } catch (e) {
      console.warn("[ConfigAdmin] Could not update URL slug", e);
    }
  }

  /* ------------------------------------------------------------------ */
  /* SCHOOL RENAME                                                      */
  /* ------------------------------------------------------------------ */

  async function onSchoolRenameClick() {
    if (!SLUG) return;
    if (!schoolNameInput) return;

    const newName = (schoolNameInput.value || "").trim();
    if (!newName) {
      alert("Please enter a new school name.");
      return;
    }

    const oldSlug = SLUG;

    try {
      setStatus("Renaming school…");

      const res = await fetch(
        `${ADMIN_API_BASE}/api/admin/school/${encodeURIComponent(SLUG)}/rename`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newName }),
        }
      );

      const data = await res.json();
      if (!data.ok) {
        console.error("Rename failed:", data);
        setStatus("Rename failed.");
        return;
      }

      // Backend should return { ok: true, slug, name } (and optionally school)
      const newSlug =
        data.slug || (data.school && data.school.slug) || SLUG;
      const name =
        data.name || (data.school && data.school.name) || newName;

      // Update UI + global slug
      updateSlugUi(newSlug, name);
      updateSlugInUrl(newSlug);

      // If selector exists, update the current option text/value
      if (schoolSelector) {
        const opt =
          schoolSelector.querySelector(`option[value="${oldSlug}"]`) ||
          schoolSelector.selectedOptions[0];

        if (opt) {
          opt.value = newSlug;
          opt.textContent = name || newSlug;
          schoolSelector.value = newSlug;
        }
      }

      setStatus("School name & slug updated.");
    } catch (err) {
      console.error("onSchoolRenameClick error:", err);
      setStatus("Error renaming school.");
    }
  }

  /* ------------------------------------------------------------------ */
  /* MULTI-SCHOOL SELECTOR (OPTIONAL)                                   */
  /* ------------------------------------------------------------------ */

  async function loadSchoolsForSelector() {
    if (!schoolSelector) return;

    try {
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/schools`);
      if (!res.ok) {
        console.warn(
          "[ConfigAdmin] /api/admin/schools returned",
          res.status
        );
        return;
      }

      const data = await res.json();
      const list =
        Array.isArray(data)
          ? data
          : Array.isArray(data.schools)
          ? data.schools
          : [];

      if (!list.length) return;

      schoolSelector.innerHTML = "";
      list.forEach((s) => {
        if (!s || !s.slug) return;
        const opt = document.createElement("option");
        opt.value = s.slug;
        opt.textContent = s.name || s.slug;
        schoolSelector.appendChild(opt);
      });

      // Try to keep current slug selected
      if (SLUG && list.some((s) => s.slug === SLUG)) {
        schoolSelector.value = SLUG;
      } else if (schoolSelector.options.length) {
        // If our SLUG wasn't in the list, adopt the first option
        SLUG = schoolSelector.value;
      }
    } catch (err) {
      console.warn("[ConfigAdmin] Could not load schools", err);
    }
  }

  function wireSchoolSelector() {
    if (!schoolSelector) return;

    schoolSelector.addEventListener("change", async () => {
      const nextSlug = schoolSelector.value;
      if (!nextSlug || nextSlug === SLUG) return;

      if (dirty) {
        const ok = window.confirm(
          "You have unsaved changes. Switch school and discard them?"
        );
        if (!ok) {
          // revert selector
          schoolSelector.value = SLUG || "";
          return;
        }
      }

      SLUG = nextSlug;
      updateSlugUi(nextSlug, schoolNameInput ? schoolNameInput.value : null);
      updateSlugInUrl(nextSlug);

      // Reset state + reload settings for new school
      STATE.config = { ...DEFAULTS.config };
      STATE.form   = { ...DEFAULTS.form };
      STATE.image  = { ...DEFAULTS.image };
      hydrateFormFromState();
      setPristine();

      try {
        await loadFromServer();
      } catch (err) {
        console.warn("[ConfigAdmin] loadFromServer error on school change", err);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* LOAD FROM SERVER                                                   */
  /* ------------------------------------------------------------------ */

  async function loadFromServer() {
    if (!SLUG) {
      console.warn("[ConfigAdmin] loadFromServer called with no SLUG");
      return;
    }

    setStatus("Loading settings from server…");

    try {
      const res = await fetch(
        `${ADMIN_API_BASE}/api/admin/widget/${encodeURIComponent(SLUG)}`
      );
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

      const data     = await res.json();
      const settings = data.settings || {};

      // Merge with defaults
      const rawConfig = settings.config || {};
      const rawForm   = settings.form || {};
      const rawImage  = settings.image || {};

      // Legacy migration: widgetUrl/dashboardUrl → widgetPath/dashboardPath
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

      // If server returns school info, update rename panel + selector
      if (data.school && data.school.slug) {
        updateSlugUi(data.school.slug, data.school.name || null);
      }

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
      } else if (
        el.tagName === "TEXTAREA" ||
        el.tagName === "INPUT" ||
        el.tagName === "SELECT"
      ) {
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
          STATE.config.afterDashboard ||
          { ...(DEFAULTS.config.afterDashboard || {}) };
        STATE.config.afterDashboard.signupUrl = afterSignupUrlInput.value;
        setDirty();
      });
    }

    if (afterCtaMessageInput) {
      afterCtaMessageInput.addEventListener("input", () => {
        STATE.config.afterDashboard =
          STATE.config.afterDashboard ||
          { ...(DEFAULTS.config.afterDashboard || {}) };
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
        `${ADMIN_API_BASE}/api/admin/widget/${encodeURIComponent(SLUG)}`,
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
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/dashboards`);
      if (!res.ok) throw new Error(`dashboards HTTP ${res.status}`);

      const data = await res.json();
      const list = Array.isArray(data.dashboards) ? data.dashboards : [];

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

        if (filename.toLowerCase().endsWith("_template.html")) return;
        if (!url.startsWith("/dashboards/")) return;

        if (seen.has(url)) return;
        seen.add(url);

        const opt = document.createElement("option");
        opt.value = url;
        opt.textContent = filename;
        dashboardTemplateSelect.appendChild(opt);
      }

      list.forEach(addDashboard);

      // Always ensure default is present
      addDashboard(DEFAULTS.config.dashboardPath);

      if (current && !seen.has(current)) {
        addDashboard(current);
      }

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
      const res = await fetch(`${ADMIN_API_BASE}/api/admin/widgets`);
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
    imgPreview.src = url;               // use stored URL as-is
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

    // Clicking the button opens the file chooser
    imgUploadBtn.addEventListener("click", () => {
      imgFileInput.click();
    });

    // When a file is chosen, upload it
    imgFileInput.addEventListener("change", async () => {
      const file = imgFileInput.files && imgFileInput.files[0];
      if (!file) return;

      if (!SLUG) {
        console.error("[ConfigAdmin] Image upload: SLUG is missing");
        if (imgUploadStatus) {
          imgUploadStatus.textContent = "Missing slug – cannot upload.";
        }
        return;
      }

      // Local, instant preview
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

        const url = `${ADMIN_API_BASE}/api/admin/widget/${encodeURIComponent(
          SLUG
        )}/image`;

        console.log("[ConfigAdmin] 📤 Uploading widget image", {
          url,
          name: file.name,
          size: file.size,
          type: file.type,
        });

        const res = await fetch(url, {
          method: "POST",
          body: formData,
        });

        const raw = await res.text();
        let data;
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (e) {
          console.warn("[ConfigAdmin] Image upload: non-JSON response", raw);
          data = { ok: res.ok, raw };
        }

        if (!res.ok || data.ok === false) {
          console.error("[ConfigAdmin] ❌ Image upload failed", {
            status: res.status,
            data,
          });
          if (imgUploadStatus) {
            imgUploadStatus.textContent = "Upload failed. See console.";
          }
          return;
        }

        const imageUrl =
  data.url || data.imageUrl || data.image || data.path;

if (!imageUrl) {
  console.warn(
    "[ConfigAdmin] Upload succeeded but no URL returned",
    data
  );
  if (imgUploadStatus) {
    imgUploadStatus.textContent =
      "Upload complete, but server did not return an image URL.";
  }
  return;
}

console.log("[ConfigAdmin] ✅ Image upload success (raw)", imageUrl);

// 🔗 Normalise to something that works everywhere
let storedUrl = imageUrl;

// If it's not already absolute (http/https)…
if (!/^https?:\/\//i.test(storedUrl)) {
  // If it's just a bare filename, assume it lives under /uploads/
  if (!storedUrl.startsWith("/")) {
    storedUrl = `/uploads/${storedUrl}`;
  }

  // On Vercel, ADMIN_API_BASE is the Render backend; on local/Render it's ""
  if (ADMIN_API_BASE) {
    storedUrl = `${ADMIN_API_BASE}${storedUrl}`;
  }
}

console.log("[ConfigAdmin] 🔗 Storing image URL:", storedUrl);

STATE.image = STATE.image || {};
STATE.image.url = storedUrl;   // store absolute (or root-relative) URL

refreshImagePreview();
setDirty();
        if (imgUploadStatus) {
          imgUploadStatus.textContent =
            "Image uploaded. Don’t forget to Save.";
        }
      } catch (err) {
        console.error("[ConfigAdmin] Image upload error", err);
        if (imgUploadStatus) {
          imgUploadStatus.textContent = "Upload failed. See console.";
        }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* INIT                                                               */
  /* ------------------------------------------------------------------ */

  async function init() {
    console.log("[ConfigAdmin] init() starting");

    const params      = new URLSearchParams(window.location.search);
    const initialSlug = params.get("slug") || "mss-demo";

    SLUG = initialSlug;
    updateSlugUi(initialSlug, null);

    wireFormEvents();
    wireAfterDashboardEvents();
    wireSave();
    wireImageUpload();
    wireDashboardSelector();
    wireWidgetSelector();
    wireSchoolSelector();

    if (schoolRenameBtn) {
      schoolRenameBtn.addEventListener("click", onSchoolRenameClick);
    }

    // Load school list for selector (if endpoint exists)
    await loadSchoolsForSelector();

    try {
      await loadFromServer();
    } catch (err) {
      console.warn("[ConfigAdmin] loadFromServer error, using defaults", err);
    }

    try {
      await loadDashboardTemplates();
      await loadWidgetTemplates();
    } catch (err) {
      console.warn("[ConfigAdmin] template loading error", err);
    }

    console.log("[ConfigAdmin] init() complete");
  }

  document.addEventListener("DOMContentLoaded", init);
})();