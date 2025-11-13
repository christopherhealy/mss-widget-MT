/* ConfigAdmin.js – Build 2025-11-13 09:45 ET
   Fully Postgres-backed slug admin
--------------------------------------------------------- */

(function () {

  // -----------------------------
  // Helpers
  // -----------------------------
  const qs  = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  const statusEl = qs('#status');
  const setStatus = (msg, warn = false) => {
    statusEl.textContent = msg;
    statusEl.style.background = warn ? '#ffecec' : '#eef6ff';
    statusEl.style.borderLeftColor = warn ? '#b00020' : '#0a66c2';
  };

  // -----------------------------
  // Slug & API
  // -----------------------------
  const slug = new URLSearchParams(location.search).get('slug')?.trim();
  if (!slug) {
    setStatus("⚠️ No slug provided (?slug=missing). Cannot load config.", true);
  }

  const ADMIN_URL = `/api/admin/widget/${encodeURIComponent(slug || '')}`;
  const LOGO_URL  = `${ADMIN_URL}/logo`;

  console.log("[ConfigAdmin] slug=", slug, "ADMIN_URL=", ADMIN_URL);

  // -----------------------------
  // Elements map
  // -----------------------------
  const els = {
    // Branding
    headline: qs('#headline'),
    poweredBy: qs('#poweredBy'),
    editableHeadline: qs('#editableHeadline'),
    logoFile: qs('#logoFile'),
    uploadLogoBtn: qs('#uploadLogoBtn'),
    removeLogoBtn: qs('#removeLogoBtn'),
    brandPreview: qs('#brandPreview'),
    logoStatus: qs('#logoStatus'),

    // Labels
    lblRecord: qs('#lblRecord'),
    lblStop: qs('#lblStop'),
    lblSubmit: qs('#lblSubmit'),

    // API
    apiBase: qs('#apiBase'),
    apiKey: qs('#apiKey'),
    apiSecret: qs('#apiSecret'),
    adminWriteKey: qs('#adminWriteKey'),

    // Widget Options
    allowUpload: qs('#allowUpload'),
    editableHeadline: qs('#editableHeadline'),
    minSec: qs('#minSec'),
    maxSec: qs('#maxSec'),

    // Form
    form: qs('#configForm'),
  };


  // -----------------------------
  // Fallback config (if API unavailable)
  // -----------------------------
  const DEFAULTS = {
    headline: "CEFR Assessment",
    poweredBy: "Powered by MSS Vox",

    lblRecord: "Record",
    lblStop: "Stop",
    lblSubmit: "Submit",

    allowUpload: false,
    editableHeadline: false,
    minSec: 30,
    maxSec: 60,

    apiBase: "https://app.myspeakingscore.com",
    apiKey: "",
    apiSecret: "",
    adminWriteKey: "",

    brandLogoUrl: ""
  };

  // -----------------------------
  // LOAD CONFIG
  // -----------------------------
  async function loadConfig() {
    if (!slug) return;

    try {
      const res = await fetch(ADMIN_URL, {
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });

      if (!res.ok) {
        console.warn("GET failed", res.status);
        useFallback("Config not found. Using defaults.");
        return;
      }

      const body = await res.json().catch(() => ({}));
      const cfg = body.config || body.form || body || {};

      console.log("[ConfigAdmin] Loaded config:", cfg);

      applyToUI({ ...DEFAULTS, ...cfg });
      setStatus("Config loaded.");
    }
    catch (e) {
      console.error("loadConfig error:", e);
      useFallback("Failed to load from API. Using fallback.", true);
    }
  }


  // Fallback to local JSON (rare)
  async function useFallback(msg, warn = false) {
    setStatus(msg, warn);

    try {
      const res = await fetch(`/config-admin/form.json?ts=${Date.now()}`);
      const cfg = await res.json().catch(() => DEFAULTS);

      console.log("[ConfigAdmin] Using fallback JSON", cfg);
      applyToUI({ ...DEFAULTS, ...cfg });
    }
    catch (e) {
      console.error("fallback load failed", e);
      applyToUI(DEFAULTS);
    }
  }


  // -----------------------------
  // APPLY -> UI
  // -----------------------------
  function applyToUI(cfg) {
    /* Branding */
    els.headline.value = cfg.headline || "";
    els.poweredBy.value = cfg.poweredBy || "";

    if (cfg.brandLogoUrl) {
      const bust = `${cfg.brandLogoUrl}${cfg.brandLogoUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      els.brandPreview.src = bust;
      els.brandPreview.style.display = "block";
      els.logoStatus.textContent = "Logo loaded.";
    }
    else {
      els.brandPreview.style.display = "none";
      els.logoStatus.textContent = "No brand logo.";
    }

    /* Labels */
    els.lblRecord.value = cfg.lblRecord || "";
    els.lblStop.value = cfg.lblStop || "";
    els.lblSubmit.value = cfg.lblSubmit || "";

    /* API */
    els.apiBase.value = cfg.apiBase || "";
    els.apiKey.value = cfg.apiKey || "";
    els.apiSecret.value = cfg.apiSecret || "";
    els.adminWriteKey.value = cfg.adminWriteKey || "";

    /* Widget Options */
    els.allowUpload.checked = !!cfg.allowUpload;
    els.editableHeadline.checked = !!cfg.editableHeadline;
    els.minSec.value = cfg.minSec ?? 0;
    els.maxSec.value = cfg.maxSec ?? 0;
  }


  // -----------------------------
  // COLLECT UI -> CONFIG OBJ
  // -----------------------------
  function collectConfig() {
    const cfg = {
      /* Branding */
      headline: els.headline.value,
      poweredBy: els.poweredBy.value,

      /* Labels */
      lblRecord: els.lblRecord.value,
      lblStop: els.lblStop.value,
      lblSubmit: els.lblSubmit.value,

      /* API */
      apiBase: els.apiBase.value,
      apiKey: els.apiKey.value,
      apiSecret: els.apiSecret.value,
      adminWriteKey: els.adminWriteKey.value,

      /* Widget Options */
      allowUpload: els.allowUpload.checked,
      editableHeadline: els.editableHeadline.checked,
      minSec: +els.minSec.value || 0,
      maxSec: +els.maxSec.value || 0,
    };

    // If preview is showing
    if (els.brandPreview?.src && !els.brandPreview.src.includes('data:')) {
      cfg.brandLogoUrl = els.brandPreview.src;
    }

    return cfg;
  }


  // -----------------------------
  // SAVE CONFIG
  // -----------------------------
  async function saveConfig() {
    if (!slug) {
      alert("Cannot save — no slug in URL.");
      return;
    }

    const cfg = collectConfig();

    try {
      const res = await fetch(ADMIN_URL, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-ADMIN-KEY": els.adminWriteKey.value || ""
        },
        body: JSON.stringify({ config: cfg })
      });

      if (!res.ok) throw new Error("HTTP " + res.status);

      setStatus("Saved.");
    }
    catch (e) {
      console.error("Save failed:", e);
      setStatus("Save failed.", true);
    }
  }


  // -----------------------------
  // UPLOAD LOGO
  // -----------------------------
  async function uploadLogo() {
    if (!slug) return alert("No slug.");

    const f = els.logoFile.files[0];
    if (!f) return alert("Choose a logo file.");

    const fd = new FormData();
    fd.append("file", f);

    setStatus("Uploading logo…");

    try {
      const res = await fetch(LOGO_URL, {
        method: "POST",
        body: fd,
        headers: {
          "X-ADMIN-KEY": els.adminWriteKey.value || ""
        }
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("HTTP " + res.status);

      const url = body.url || body.brandLogoUrl;
      if (url) {
        els.brandPreview.src = `${url}?t=${Date.now()}`;
        els.brandPreview.style.display = "block";
        els.logoStatus.textContent = "Logo uploaded.";
      }

      setStatus("Logo uploaded.");
    }
    catch (e) {
      console.error("Logo upload failed", e);
      setStatus("Logo upload failed.", true);
    }
  }


  // -----------------------------
  // REMOVE LOGO
  // -----------------------------
  async function removeLogo() {
    if (!slug) return;

    if (!confirm("Remove logo?")) return;

    try {
      const res = await fetch(LOGO_URL, {
        method: "DELETE",
        headers: {
          "X-ADMIN-KEY": els.adminWriteKey.value || ""
        }
      });

      if (!res.ok) throw new Error("HTTP " + res.status);

      els.brandPreview.style.display = "none";
      els.brandPreview.removeAttribute("src");
      els.logoStatus.textContent = "Logo removed.";

      setStatus("Logo removed.");
    }
    catch (e) {
      console.error("Remove logo failed", e);
      setStatus("Failed to remove logo.", true);
    }
  }


  // -----------------------------
  // Wire events
  // -----------------------------
  els.form?.addEventListener("submit", e => {
    e.preventDefault();
    saveConfig();
  });

  els.uploadLogoBtn?.addEventListener("click", uploadLogo);
  els.removeLogoBtn?.addEventListener("click", removeLogo);

  // -----------------------------
  // Init
  // -----------------------------
  loadConfig();

})();
