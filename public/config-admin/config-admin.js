console.log("✅ config-admin.js loaded");

(function () {
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug") || "mss-demo";

  const baseUrl = window.location.origin.replace(/\/+$/, "");

  let loadedConfig = {};
  let loadedForm = {};
  let loadedBilling = {};

  const statusEl = $("statusText");

  function setStatus(msg, kind = "info") {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "mss-config-status mss-config-status-" + kind;
  }

  // Fill inputs from loaded objects
  function applyToInputs() {
    const cfg = loadedConfig || {};
    const frm = loadedForm || {};
    const bill = loadedBilling || {};

    // Brand & text
    if ($("headlineInput")) $("headlineInput").value = frm.headline || "";
    if ($("poweredByLabelInput"))
      $("poweredByLabelInput").value = frm.poweredByLabel || "";

    if ($("editableHeadlineInput")) {
      $("editableHeadlineInput").checked = !!(
        cfg.editable && cfg.editable.headline
      );
    }

    // Theme & behaviour
    if ($("themeSelect")) {
      const theme = cfg.theme || "MSSStylesheet";
      $("themeSelect").value = theme;
    }

    if ($("permitUploadInput")) {
      $("permitUploadInput").checked = cfg.Permitupload !== false;
    }

    if ($("audioMinInput")) {
      $("audioMinInput").value =
        cfg.audioMinSeconds != null ? cfg.audioMinSeconds : 30;
    }

    if ($("audioMaxInput")) {
      $("audioMaxInput").value =
        cfg.audioMaxSeconds != null ? cfg.audioMaxSeconds : 61;
    }

    // API
    const api = cfg.api || {};
    if ($("apiBaseInput"))
      $("apiBaseInput").value = api.baseUrl || "https://app.myspeakingscore.com";
    if ($("apiKeyInput")) $("apiKeyInput").value = api.key || "";
    if ($("apiSecretInput")) $("apiSecretInput").value = api.secret || "";

    // Logger
    const logger = cfg.logger || {};
    if ($("loggerEnabledInput")) {
      $("loggerEnabledInput").checked = !!logger.enabled;
    }
    if ($("loggerUrlInput")) {
      $("loggerUrlInput").value = logger.url || "";
    }

    // Billing
    if ($("dailyLimitInput")) {
      $("dailyLimitInput").value =
        bill.dailyLimit != null && !isNaN(bill.dailyLimit)
          ? bill.dailyLimit
          : 0;
    }
    if ($("autoBlockOnLimitInput")) {
      $("autoBlockOnLimitInput").checked =
        bill.autoBlockOnLimit !== false; // default true
    }
    if ($("notifyOnLimitInput")) {
      $("notifyOnLimitInput").checked = !!bill.notifyOnLimit;
    }
    if ($("emailOnLimitInput")) {
      $("emailOnLimitInput").value = bill.emailOnLimit || "";
    }
  }

  // Pull values from inputs back into objects
  function collectFromInputs() {
    const cfg = { ...(loadedConfig || {}) };
    const frm = { ...(loadedForm || {}) };
    const bill = { ...(loadedBilling || {}) };

    // --- Form (headline, powered by) ---
    if ($("headlineInput")) {
      frm.headline = $("headlineInput").value.trim();
    }
    if ($("poweredByLabelInput")) {
      frm.poweredByLabel = $("poweredByLabelInput").value.trim();
    }

    // --- Editable flags ---
    cfg.editable = cfg.editable || {};
    if ($("editableHeadlineInput")) {
      cfg.editable.headline = $("editableHeadlineInput").checked;
    }

    // --- Theme & behaviour ---
    if ($("themeSelect")) {
      cfg.theme = $("themeSelect").value || "MSSStylesheet";
    }

    if ($("permitUploadInput")) {
      cfg.Permitupload = $("permitUploadInput").checked;
    }

    const minEl = $("audioMinInput");
    const maxEl = $("audioMaxInput");
    const minVal = minEl ? parseInt(minEl.value, 10) : NaN;
    const maxVal = maxEl ? parseInt(maxEl.value, 10) : NaN;

    if (!isNaN(minVal)) cfg.audioMinSeconds = minVal;
    if (!isNaN(maxVal)) cfg.audioMaxSeconds = maxVal;

    // --- API ---
    const api = { ...(cfg.api || {}) };
    if ($("apiBaseInput")) {
      api.baseUrl = $("apiBaseInput").value.trim();
    }
    if ($("apiKeyInput")) {
      api.key = $("apiKeyInput").value.trim();
    }
    if ($("apiSecretInput")) {
      api.secret = $("apiSecretInput").value.trim();
    }
    api.enabled = true;
    cfg.api = api;

    // --- Logger ---
    const logger = { ...(cfg.logger || {}) };
    if ($("loggerEnabledInput")) {
      logger.enabled = $("loggerEnabledInput").checked;
    }
    if ($("loggerUrlInput")) {
      logger.url = $("loggerUrlInput").value.trim();
    }
    cfg.logger = logger;

    // --- Billing ---
    const limitEl = $("dailyLimitInput");
    const limitVal = limitEl ? parseInt(limitEl.value, 10) : NaN;
    bill.dailyLimit = !isNaN(limitVal) && limitVal >= 0 ? limitVal : 0;

    if ($("autoBlockOnLimitInput")) {
      bill.autoBlockOnLimit = $("autoBlockOnLimitInput").checked;
    }
    if ($("notifyOnLimitInput")) {
      bill.notifyOnLimit = $("notifyOnLimitInput").checked;
    }
    if ($("emailOnLimitInput")) {
      bill.emailOnLimit = $("emailOnLimitInput").value.trim();
    }

    return { config: cfg, form: frm, billing: bill };
  }

  async function loadConfig() {
    setStatus("Loading configuration…", "info");
    try {
      const res = await fetch(
        baseUrl + "/api/admin/widget/" + encodeURIComponent(slug),
        {
          headers: { Accept: "application/json" },
        }
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        console.error("Admin config load failed:", res.status, body);
        setStatus(
          body.message ||
            body.error ||
            "Could not load configuration for this school.",
          "error"
        );
        return;
      }

      loadedConfig = body.config || {};
      loadedForm = body.form || {};
      loadedBilling = body.billing || {};
      applyToInputs();
      setStatus("Configuration loaded.", "ok");
    } catch (err) {
      console.error("loadConfig error:", err);
      setStatus("Network error while loading configuration.", "error");
    }
  }

  async function saveConfig(e) {
    if (e && e.preventDefault) e.preventDefault();

    setStatus("Saving configuration…", "info");

    const { config, form, billing } = collectFromInputs();

    try {
      const res = await fetch(
        baseUrl + "/api/admin/widget/" + encodeURIComponent(slug),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, form, billing }),
        }
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        console.error("Admin config save failed:", res.status, body);
        setStatus(
          body.message ||
            body.error ||
            "Could not save configuration for this school.",
          "error"
        );
        return;
      }

      loadedConfig = config;
      loadedForm = form;
      loadedBilling = billing;

      setStatus("Configuration saved.", "ok");
    } catch (err) {
      console.error("saveConfig error:", err);
      setStatus("Network error while saving configuration.", "error");
    }
  }

  function resetToDefaults() {
    if (!window.confirm("Reset this school’s widget to the default MSS settings?")) {
      return;
    }
    // Just reload from server; defaults are handled server-side if needed
    loadConfig();
  }

  window.addEventListener("DOMContentLoaded", () => {
    // Hook up buttons
    const form = $("configForm");
    const saveBtn = $("saveBtn");
    const resetBtn = $("resetBtn");

    if (form) form.addEventListener("submit", saveConfig);
    if (saveBtn) saveBtn.addEventListener("click", saveConfig);
    if (resetBtn) resetBtn.addEventListener("click", resetToDefaults);

    loadConfig();
  });
})();