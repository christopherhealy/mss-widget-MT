/* config-admin.js v3.1 */
(function () {
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const statusEl = qs('#mssAdminStatus');

  // ─── SLUG & ENDPOINT ────────────────────────────────────────────────────────
  const slug = new URLSearchParams(location.search).get('slug')?.trim() || '';
  const ADMIN_URL = `/api/admin/widget/${encodeURIComponent(slug)}`;

  // Hydrate slug badge so nav buttons work
  const slugEl = qs('#mssAdminSchoolSlug');
  if (slugEl) {
    slugEl.textContent = slug || '(missing)';
    slugEl.dataset.slug = slug;
  }

  // Warn if no slug and stop boot
  if (!slug) {
    setStatus('⚠️ Add ?slug= to the URL (e.g., ?slug=mss-demo)', true);
    return;
  }

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  function setStatus(msg, warn = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = warn ? '#b45309' : '#0a7a0a';
  }
  const getBool = (el) => !!el?.checked;
  const setBool = (el, v) => { if (el) el.checked = !!v; };
  const getVal = (el) => (el ? el.value : '');
  const setVal = (el, v) => { if (el) el.value = v ?? ''; };

  // ─── ELEMENT MAP ────────────────────────────────────────────────────────────
  const els = {
    form: qs('#mssConfigForm'),

    // Brand & text
    headline: qs('#cfgHeadline'),
    poweredBy: qs('#cfgPoweredBy'),
    editableHeadline: qs('#cfgEditableHeadline'),

    // Theme / timing / upload
    theme: qs('#cfgTheme'),
    allowUpload: qs('#cfgAllowUpload'),
    minSec: qs('#cfgMinSec'),
    maxSec: qs('#cfgMaxSec'),

    // Visibility toggles
    showHeadline: qs('#showHeadline'),
    showRecordButton: qs('#showRecordButton'),
    showPrevButton: qs('#showPrevButton'),
    showNextButton: qs('#showNextButton'),
    showStopButton: qs('#showStopButton'),
    showUploadButton: qs('#showUploadButton'),
    showPoweredByLabel: qs('#showPoweredByLabel'),
    showNotRecordingLabel: qs('#showNotRecordingLabel'),
    showSubmitButton: qs('#showSubmitButton'),

    // API & logging
    apiBaseUrl: qs('#cfgApiBaseUrl'),
    apiKey: qs('#cfgApiKey'),
    apiSecret: qs('#cfgApiSecret'),
    loggerEnabled: qs('#cfgLoggerEnabled'),
    loggerUrl: qs('#cfgLoggerUrl'),

    // Usage & safety
    dailyLimit: qs('#cfgDailyLimit'),
    notifyOnLimit: qs('#cfgNotifyOnLimit'),
    autoBlockOnLimit: qs('#cfgAutoBlockOnLimit'),

    // Branding
    logoFile: qs('#mssBrandLogoFile'),
    logoImg: qs('#mssBrandLogoImg'),
    logoStatus: qs('#mssBrandLogoStatus'),
    // The following might not exist in your HTML; we’ll handle that gracefully:
    logoProg: qs('#mssBrandLogoProg'),
    logoUpload: qs('#mssBrandLogoUpload'),
    logoRemove: qs('#mssBrandLogoRemove'),
  };

  // Keep last-loaded config so we can merge unknown keys on save
  let _loadedConfig = {};

  // ─── LOAD ───────────────────────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const res = await fetch(ADMIN_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('HTTP ' + res.status);

      // Accept various shapes: {config}, {form}, or raw object
      const cfg = body.config || body.form || body || {};
      _loadedConfig = cfg && typeof cfg === 'object' ? cfg : {};
      applyToUI(_loadedConfig);
      setStatus('Loaded');
    } catch (e) {
      console.error('loadConfig failed', e);
      setStatus('Failed to load config', true);
    }
  }

  function applyToUI(cfg) {
    // Brand & text
    setVal(els.headline, cfg.headline);
    setVal(els.poweredBy, cfg.poweredBy);
    setBool(els.editableHeadline, !!cfg.editableHeadline);

    // Theme / timing / upload
    setVal(els.theme, cfg.theme || 'default');
    setBool(els.allowUpload, !!cfg.allowUpload);
    setVal(els.minSec, cfg.minSec ?? '');
    setVal(els.maxSec, cfg.maxSec ?? '');

    // Visibility
    setBool(els.showHeadline, !!cfg.showHeadline);
    setBool(els.showRecordButton, !!cfg.showRecordButton);
    setBool(els.showPrevButton, !!cfg.showPrevButton);
    setBool(els.showNextButton, !!cfg.showNextButton);
    setBool(els.showStopButton, !!cfg.showStopButton);
    setBool(els.showUploadButton, !!cfg.showUploadButton);
    setBool(els.showPoweredByLabel, !!cfg.showPoweredByLabel);
    setBool(els.showNotRecordingLabel, !!cfg.showNotRecordingLabel);
    setBool(els.showSubmitButton, !!cfg.showSubmitButton);

    // API & logging
    setVal(els.apiBaseUrl, cfg.apiBaseUrl || '');
    setVal(els.apiKey, cfg.apiKey || '');
    setVal(els.apiSecret, cfg.apiSecret || '');
    setBool(els.loggerEnabled, !!cfg.loggerEnabled);
    setVal(els.loggerUrl, cfg.loggerUrl || '');

    // Usage & safety
    setVal(els.dailyLimit, cfg.dailyLimit ?? '');
    setBool(els.notifyOnLimit, !!cfg.notifyOnLimit);
    setBool(els.autoBlockOnLimit, !!cfg.autoBlockOnLimit);

    // Branding
    updateLogoUI(cfg.brandLogoUrl || '');
  }

  function collectFromUI() {
    // Don’t coerce blanks to zero—send undefined for “not set”
    const numOrUndef = (s) => {
      const n = Number(String(s ?? '').trim());
      return Number.isFinite(n) && String(s ?? '').trim() !== '' ? n : undefined;
    };

    const cfg = {
      // Brand & text
      headline: getVal(els.headline) || undefined,
      poweredBy: getVal(els.poweredBy) || undefined,
      editableHeadline: getBool(els.editableHeadline),

      // Theme / timing / upload
      theme: getVal(els.theme) || 'default',
      allowUpload: getBool(els.allowUpload),
      minSec: numOrUndef(getVal(els.minSec)),
      maxSec: numOrUndef(getVal(els.maxSec)),

      // Visibility
      showHeadline: getBool(els.showHeadline),
      showRecordButton: getBool(els.showRecordButton),
      showPrevButton: getBool(els.showPrevButton),
      showNextButton: getBool(els.showNextButton),
      showStopButton: getBool(els.showStopButton),
      showUploadButton: getBool(els.showUploadButton),
      showPoweredByLabel: getBool(els.showPoweredByLabel),
      showNotRecordingLabel: getBool(els.showNotRecordingLabel),
      showSubmitButton: getBool(els.showSubmitButton),

      // API & logging
      apiBaseUrl: getVal(els.apiBaseUrl) || undefined,
      apiKey: getVal(els.apiKey) || undefined,
      apiSecret: getVal(els.apiSecret) || undefined,
      loggerEnabled: getBool(els.loggerEnabled),
      loggerUrl: getVal(els.loggerUrl) || undefined,

      // Usage & safety
      dailyLimit: numOrUndef(getVal(els.dailyLimit)),
      notifyOnLimit: getBool(els.notifyOnLimit),
      autoBlockOnLimit: getBool(els.autoBlockOnLimit),

      // Branding: keep whatever preview shows
      brandLogoUrl: els.logoImg?.getAttribute('src') || undefined,
    };

    // Merge with last loaded so we don’t blow away unknown keys
    return Object.assign({}, _loadedConfig, cfg);
  }

  // ─── SAVE ───────────────────────────────────────────────────────────────────
  async function saveConfig() {
    const cfg = collectFromUI();
    try {
      const res = await fetch(ADMIN_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      _loadedConfig = cfg; // optimistic update
      setStatus('Saved');
    } catch (e) {
      console.error('saveConfig failed', e);
      setStatus('Save failed', true);
    }
  }

  // ─── BRANDING (upload/remove) ───────────────────────────────────────────────
  function updateLogoUI(url) {
    if (url) {
      if (els.logoImg) {
        els.logoImg.src = url;
        els.logoImg.style.display = '';
      }
      if (els.logoStatus) els.logoStatus.textContent = 'Logo uploaded.';
    } else {
      if (els.logoImg) {
        els.logoImg.removeAttribute('src');
        els.logoImg.style.display = 'none';
      }
      if (els.logoStatus) els.logoStatus.textContent = 'No logo uploaded yet.';
    }
  }

  // Create a lightweight inline progress element if missing
  function ensureLogoProg() {
    if (els.logoProg) return els.logoProg;
    const prog = document.createElement('progress');
    prog.id = 'mssBrandLogoProg';
    prog.max = 100;
    prog.value = 0;
    prog.style.display = 'none';
    prog.style.marginTop = '8px';
    // Place after file input, if possible
    if (els.logoFile?.parentElement) {
      els.logoFile.parentElement.appendChild(prog);
    } else {
      (els.logoStatus?.parentElement || document.body).appendChild(prog);
    }
    els.logoProg = prog;
    return prog;
  }

  async function uploadLogoFromFile(file) {
    if (!file) return;
    setStatus('Uploading logo…');
    const prog = ensureLogoProg();
    prog.style.display = '';
    prog.value = 5;

    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${ADMIN_URL}/logo`, { method: 'POST', body: fd });
      prog.value = 70;
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const url = body.url || body.brandLogoUrl;
      updateLogoUI(url);
      prog.value = 100;
      setTimeout(() => { prog.style.display = 'none'; prog.value = 0; }, 350);
      setStatus('Logo uploaded');
    } catch (e) {
      console.error('logo upload failed', e);
      prog.style.display = 'none';
      prog.value = 0;
      setStatus('Logo upload failed', true);
    }
  }

  async function removeLogo() {
    if (!confirm('Remove current logo?')) return;
    setStatus('Removing logo…');
    try {
      const res = await fetch(`${ADMIN_URL}/logo`, { method: 'DELETE' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      updateLogoUI('');
      setStatus('Logo removed');
    } catch (e) {
      console.error('logo remove failed', e);
      // Fallback: clear locally and save config without a brand url
      updateLogoUI('');
      const cfg = collectFromUI();
      await saveConfig(); // ignore errors here
      setStatus('Logo removed (local only)', true);
    }
  }

  // ─── WIRING ─────────────────────────────────────────────────────────────────
  function wire() {
    // Save
    els.form?.addEventListener('submit', (e) => { e.preventDefault(); saveConfig(); });

    // Logo upload: trigger upload when a file is chosen
    els.logoFile?.addEventListener('change', (e) => {
      const f = e.currentTarget?.files?.[0];
      if (!f) return;
      // Optional client preview before upload
      if (els.logoImg) {
        const url = URL.createObjectURL(f);
        els.logoImg.src = url;
        els.logoImg.style.display = '';
        if (els.logoStatus) els.logoStatus.textContent = 'Uploading…';
      }
      uploadLogoFromFile(f);
    });

    // Optional explicit buttons if you add them later
    els.logoUpload?.addEventListener('click', () => {
      els.logoFile?.click();
    });
    els.logoRemove?.addEventListener('click', removeLogo);
  }

  // ─── BOOT ───────────────────────────────────────────────────────────────────
  wire();
  loadConfig();
})();
