// /config-admin/ConfigAdmin.js — Admin + Image Viewer + Dashboards + Widgets
// Single-school mode + School rename + optional multi-school selector
// Uses settings.{config,form,image} in Postgres
// Canonical keys: config.widgetPath, config.dashboardPath, config.afterDashboard.*
// Dec 5 – adds admin-session guard + shared multi-school dropdown (my-schools)

console.log("✅ ConfigAdmin.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // Header + School Settings
  const slugLabel        = $("slugLabel");
  const currentSlugLabel = $("currentSlugLabel");   // rename panel label
  const schoolNameInput  = $("schoolNameInput");    // rename panel input
  const schoolRenameBtn  = $("schoolRenameBtn");    // rename panel button
  const legacySelector   = $("schoolSelector");     // older School Settings dropdown

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
  const widgetTemplateSelect = $("widgetTemplate");


  

// Use the HTML id "widgetTemplate"


  // Image / branding elements
  const imgFileInput          = $("img-file");           // hidden input (not used directly now)
  const imgUploadBtn          = $("img-uploadBtn");      // "Upload Image" button
  const imgUploadStatus       = $("img-uploadStatus");
  const imgPreview            = $("img-preview");
  const imgPreviewPlaceholder = $("img-previewPlaceholder");

  // After-dashboard fields
  const afterSignupUrlInput  = $("afterDashboard-signupUrl");
  const afterCtaMessageInput = $("afterDashboard-ctaMessage");

  // NEW header dropdown + slug badge (same look as SchoolPortal)
  const schoolSelectEl = $("config-school-selector") || legacySelector || null;
  const slugBadgeEl    = $("config-slug-badge") || null;

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
      sizePercent: 100, // default image size
    },
  };

  /* ------------------------------------------------------------------ */
  /* ADMIN SESSION GUARD                                                */
  /* ------------------------------------------------------------------ */

  const ADMIN_LS_KEY = "mssAdminSession";

  function getAdminSession() {
    try {
      const raw = window.localStorage.getItem(ADMIN_LS_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (!session || !session.adminId || !session.email) return null;
      return session;
    } catch (e) {
      console.warn("[ConfigAdmin] Failed to read admin session", e);
      return null;
    }
  }

  function requireAdminSession(reason) {
    const session = getAdminSession();
    if (session) return session;

    const msg =
      reason ||
      "Your admin session has ended. Please sign in again to manage school settings.";

    try {
      if (typeof setStatus === "function") {
        setStatus(msg, true);
      } else {
        console.warn("[ConfigAdmin] " + msg);
      }
    } catch (e) {
      console.warn("[ConfigAdmin] Unable to show status for ended session", e);
    }

    window.location.href = "/admin-login/AdminLogin.html";

    try {
      window.close();
    } catch (e) {
      // some browsers block window.close()
    }

    throw new Error("Admin session missing – redirected to login.");
  }

  /* ------------------------------------------------------------------ */
  /* SLUG + SCHOOL STATE                                                */
  /* ------------------------------------------------------------------ */

  const urlParams = new URLSearchParams(window.location.search);
  if (!SLUG) {
    SLUG = urlParams.get("slug") || null;
  }

  let CONFIG_SCHOOLS = [];   // [{id, slug, name, ...}]
  let CURRENT_SCHOOL = null;

  const CONFIG_SCHOOL_SWITCH_WARNING_HTML = `
    <p>You have changed schools.</p>
    <p style="margin-top:6px;">
      <strong>Important:</strong> Please close any open
      <b>Config Admin</b> or <b>Question Editor</b> tabs from the previous school
      before continuing.
    </p>
  `;

  function showConfigSchoolChangeWarning() {
    return new Promise((resolve) => {
      const dlg = document.getElementById("portal-warning-overlay");
      const msg = document.getElementById("portal-warning-message");
      const ok  = document.getElementById("portal-warning-ok");

      if (dlg && msg && ok) {
        msg.innerHTML = CONFIG_SCHOOL_SWITCH_WARNING_HTML;
        dlg.style.display = "flex";
        dlg.setAttribute("aria-hidden", "false");

        ok.onclick = () => {
          dlg.style.display = "none";
          dlg.setAttribute("aria-hidden", "true");
          resolve();
        };
      } else {
        alert(
          "You have changed schools.\n\n" +
          "Please close any open Config Admin or Question Editor tabs from the previous school before continuing."
        );
        resolve();
      }
    });
  }

  function syncSlugUi() {
    const slug = SLUG || "—";

    if (slugLabel)        slugLabel.textContent = slug;
    if (currentSlugLabel) currentSlugLabel.textContent = slug;

    if (slugBadgeEl) {
      slugBadgeEl.textContent = `Slug: ${slug}`;
    }

    if (schoolNameInput && CURRENT_SCHOOL && CURRENT_SCHOOL.name) {
      schoolNameInput.value = CURRENT_SCHOOL.name;
    }

    if (schoolSelectEl && CONFIG_SCHOOLS.length) {
      schoolSelectEl.value = slug;
      schoolSelectEl.disabled = CONFIG_SCHOOLS.length === 1;
    }
  }

  function updateSlugUi(slug, name) {
    SLUG = slug;

    if (CONFIG_SCHOOLS && CONFIG_SCHOOLS.length) {
      const match = CONFIG_SCHOOLS.find((s) => String(s.slug) === String(slug));
      if (match) {
        CURRENT_SCHOOL = match;
        if (name) {
          CURRENT_SCHOOL.name = name;
          match.name = name;
        }
      }
    }

    if (schoolNameInput && name) {
      schoolNameInput.value = name;
    }

    syncSlugUi();
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

  async function fetchConfigSchoolsForAdmin() {
    if (!schoolSelectEl) {
      // layout without dropdown = pure single-school mode
      return;
    }

    const session = requireAdminSession(
      "Your admin session has ended. Please sign in again to manage school settings."
    );

    const ADMIN_EMAIL = session.email;
    const ADMIN_ID    = session.adminId || session.id;

    try {
      const qs = new URLSearchParams();
      if (ADMIN_EMAIL) qs.set("email", ADMIN_EMAIL);
      if (ADMIN_ID)    qs.set("adminId", String(ADMIN_ID));

      let url = "/api/admin/my-schools";
      const query = qs.toString();
      if (query) url += `?${query}`;

      const res  = await fetch(url);
      const data = await res.json();

      if (!res.ok || data.ok === false) {
        console.warn("[ConfigAdmin] my-schools error:", data);
        if (!SLUG) {
          alert(
            "No schools found for this admin, and no slug in the URL.\n" +
            "Please contact support."
          );
        }
        return;
      }

      CONFIG_SCHOOLS = Array.isArray(data.schools) ? data.schools : [];
      schoolSelectEl.innerHTML = "";

      if (!CONFIG_SCHOOLS.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No schools found";
        schoolSelectEl.appendChild(opt);
        schoolSelectEl.disabled = true;
        return;
      }

      // Decide which slug we’re on:
      // 1) If SLUG matches one of the schools, use that.
      // 2) Otherwise default to the first school.
      if (
        !SLUG ||
        !CONFIG_SCHOOLS.some((s) => String(s.slug) === String(SLUG))
      ) {
        CURRENT_SCHOOL = CONFIG_SCHOOLS[0];
        SLUG = CURRENT_SCHOOL.slug;
      } else {
        CURRENT_SCHOOL =
          CONFIG_SCHOOLS.find((s) => String(s.slug) === String(SLUG)) ||
          CONFIG_SCHOOLS[0];
        SLUG = CURRENT_SCHOOL.slug;
      }

      if (CONFIG_SCHOOLS.length === 1) {
        // Mary sees her single school, not "No school selected"
        const s = CONFIG_SCHOOLS[0];
        const opt = document.createElement("option");
        opt.value = s.slug;
        opt.textContent = s.name || s.slug;
        schoolSelectEl.appendChild(opt);
        schoolSelectEl.disabled = true;
        schoolSelectEl.value = s.slug;
      } else {
        CONFIG_SCHOOLS.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.slug;
          opt.textContent = s.name || s.slug;
          schoolSelectEl.appendChild(opt);
        });
        schoolSelectEl.disabled = false;
        schoolSelectEl.value = SLUG;
      }

      syncSlugUi();
    } catch (err) {
      console.error("[ConfigAdmin] fetchConfigSchoolsForAdmin failed", err);
      if (!SLUG) {
        alert(
          "Unable to load schools for this admin and no slug was provided.\n" +
          "Please contact support."
        );
      }
    }
  }

  async function onConfigSchoolChanged() {
    if (!schoolSelectEl) return;
    const newSlug = schoolSelectEl.value;
    if (!newSlug || newSlug === SLUG) return;

    await showConfigSchoolChangeWarning();

    SLUG = newSlug;
    CURRENT_SCHOOL =
      CONFIG_SCHOOLS.find((s) => String(s.slug) === String(newSlug)) || null;

    syncSlugUi();

    STATE.config = { ...DEFAULTS.config };
    STATE.form   = { ...DEFAULTS.form };
    STATE.image  = { ...DEFAULTS.image };
    hydrateFormFromState();
    setPristine();

    await loadFromServer();
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
  /* ADMIN API BASE + URL HELPERS                                       */
  /* ------------------------------------------------------------------ */

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
    if (/^https?:\/\//i.test(path)) return path;

    let p = path;
    if (!p.startsWith("/")) {
      p = `/uploads/${p}`;
    }

    return `${ADMIN_API_BASE}${p}`;
  }

  /* ------------------------------------------------------------------ */
  /* SCHOOL RENAME                                                      */
  /* ------------------------------------------------------------------ */

  async function onSchoolRenameClick() {
    if (!SLUG) return;
    if (!schoolNameInput) return;

    requireAdminSession(
      "Your admin session has ended. Please sign in again to rename schools."
    );

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

      const newSlug =
        data.slug || (data.school && data.school.slug) || SLUG;
      const name =
        data.name || (data.school && data.school.name) || newName;

      updateSlugUi(newSlug, name);
      updateSlugInUrl(newSlug);

      if (schoolSelectEl) {
        const opt =
          schoolSelectEl.querySelector(`option[value="${oldSlug}"]`) ||
          schoolSelectEl.selectedOptions[0];

        if (opt) {
          opt.value = newSlug;
          opt.textContent = name || newSlug;
          schoolSelectEl.value = newSlug;
        }
      }

      setStatus("School name & slug updated.");
    } catch (err) {
      console.error("onSchoolRenameClick error:", err);
      setStatus("Error renaming school.");
    }
  }

  /* ------------------------------------------------------------------ */
  /* LOAD FROM SERVER                                                   */
  /* ------------------------------------------------------------------ */

  async function loadFromServer() {
    requireAdminSession(
      "Your admin session has ended. Please sign in again to load settings."
    );

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

      const rawConfig = settings.config || {};
      const rawForm   = settings.form || {};
      const rawImage  = settings.image || {};

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

      if (data.school && data.school.slug) {
        updateSlugUi(data.school.slug, data.school.name || null);
      } else {
        syncSlugUi();
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

    if (dashboardTemplateSelect) {
      const url =
        STATE.config.dashboardPath ||
        STATE.config.dashboardUrl ||
        DEFAULTS.config.dashboardPath;
      dashboardTemplateSelect.value = url;
      updateDashboardPreview();
    }

    if (widgetTemplateSelect) {
      const wurl =
        STATE.config.widgetPath ||
        STATE.config.widgetUrl ||
        DEFAULTS.config.widgetPath;
      widgetTemplateSelect.value = wurl;
    }

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

    setDirty();
  }

  function wireFormFields() {
    const allFields = document.querySelectorAll("[data-section][data-key]");
    allFields.forEach((el) => {
      const eventType = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventType, () => applyFieldToState(el));
    });
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

    requireAdminSession(
      "Your admin session has ended. Please sign in again before saving settings."
    );

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

    requireAdminSession(
      "Your admin session has ended. Please sign in again to load dashboard templates."
    );

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

    requireAdminSession(
      "Your admin session has ended. Please sign in again to load widget templates."
    );

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
      addWidget("Widget.html");

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

    const url   = (STATE.image && STATE.image.url) || "";
    const size  = (STATE.image && STATE.image.sizePercent) || 100;

    if (url) {
      imgPreview.src = url;
      imgPreview.style.display = "block";
      imgPreviewPlaceholder.style.display = "none";

      imgPreview.style.maxWidth = size + "%";
      imgPreview.style.height   = "auto";
    } else {
      imgPreview.src = "";
      imgPreview.style.display = "none";
      imgPreviewPlaceholder.style.display = "inline";
    }
  }

  /* ------------------------------------------------------------------ */
  /* IMAGE VIEWER INTEGRATION                                           */
  /* ------------------------------------------------------------------ */

  function openImageViewer() {
    requireAdminSession(
      "Your admin session has ended. Please sign in again to change the widget image."
    );

    if (!SLUG) {
      setStatus("Missing slug – cannot open image viewer.", true);
      return;
    }

    const currentUrl  = (STATE.image && STATE.image.url) || "";
    const currentSize = (STATE.image && STATE.image.sizePercent) || 100;

    const params = new URLSearchParams({
      slug: SLUG,
      url: currentUrl,
      size: String(currentSize),
    });

    const viewerUrl = `/config-admin/ImageViewer.html?${params.toString()}`;

    const features = [
      "width=1100",
      "height=720",
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");

    const win = window.open(viewerUrl, "MSSImageViewer", features);
    if (!win) {
      alert("Pop-up blocked. Please enable pop-ups for this site.");
    }
  }

  function wireImageUpload() {
    if (!imgUploadBtn) return;
    imgUploadBtn.addEventListener("click", openImageViewer);
  }

// Dec 7
 function handleImageViewerMessage(event) {
  const data = event.data || {};
  if (!data || data.source !== "MSSImageViewer") return;

  const payload = data.payload || {};

  if (data.type === "cancel") {
    setStatus("Image viewer closed without changes.");
    return;
  }

  if (data.type === "apply") {
    const { slug, url, sizePercent, id } = payload;  // ← id from DB

    if (!url) {
      setStatus("Image viewer did not return an image URL.", true);
      return;
    }

    if (slug && slug !== SLUG) {
      console.warn(
        "[ConfigAdmin] Image from different slug:",
        slug,
        "(current SLUG=", SLUG, ")"
      );
    }

    STATE.image = STATE.image || {};
    if (typeof id === "number") {
      STATE.image.id = id;                  // ← store branding_files.id
    }
    STATE.image.url = url;
    if (typeof sizePercent === "number") {
      STATE.image.sizePercent = sizePercent;
    }

    refreshImagePreview();
    setDirty();
    setStatus("Updated image from viewer. Don’t forget to Save.");
  }
}
  window.addEventListener("message", handleImageViewerMessage);

  /* ------------------------------------------------------------------ */
  /* INIT                                                               */
  /* ------------------------------------------------------------------ */

  async function init() {
    const session = requireAdminSession(
      "Your admin session has ended. Please sign in again to manage school settings."
    );

    console.log("[ConfigAdmin] Admin session:", session);
    console.log("[ConfigAdmin] init() starting");

    // Wire base UI
    wireFormFields();
    wireAfterDashboardEvents();
    wireSave();
    wireImageUpload();
    wireDashboardSelector();
    wireWidgetSelector();

    if (schoolRenameBtn) {
      schoolRenameBtn.addEventListener("click", onSchoolRenameClick);
    }

    if (schoolSelectEl) {
      schoolSelectEl.addEventListener("change", onConfigSchoolChanged);
    }

    const urlSlug = urlParams.get("slug");
    if (!SLUG && urlSlug) {
      SLUG = urlSlug;
    }

    await fetchConfigSchoolsForAdmin();

    if (!SLUG) {
      SLUG = urlSlug || "mss-demo";
    }

    syncSlugUi();

    await loadFromServer();
    await loadDashboardTemplates();
    await loadWidgetTemplates();
  }

  document.addEventListener("DOMContentLoaded", init);
})();