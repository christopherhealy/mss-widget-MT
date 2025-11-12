/* config-admin.js v3.2 • Build 2025-11-12 14:27 ET */
(function(){
  const qs = (s,r=document)=>r.querySelector(s);
  const qsa = (s,r=document)=>Array.from(r.querySelectorAll(s));
  const statusEl = qs('#mssAdminStatus');

  const slug = new URLSearchParams(location.search).get('slug')?.trim() || '';
  const ADMIN_URL = `/api/admin/widget/${encodeURIComponent(slug)}`;
  console.log('[config-admin] slug:', slug, 'ADMIN_URL:', ADMIN_URL);

  // ---- helpers
  function setStatus(msg, warn=false){
    if(!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = warn ? '#b45309' : '#0a7a0a';
  }
  const getBool = el => !!el?.checked;
  const setBool = (el, v) => { if(el) el.checked = !!v; };
  const getVal  = el => el?.value ?? '';
  const setVal  = (el, v) => { if(el) el.value = (v ?? ''); };

  // ---- elements map
  const els = {
    headline: qs('#cfgHeadline'),
    poweredBy: qs('#cfgPoweredBy'),
    editableHeadline: qs('#cfgEditableHeadline'),
    theme: qs('#cfgTheme'),
    allowUpload: qs('#cfgAllowUpload'),
    minSec: qs('#cfgMinSec'),
    maxSec: qs('#cfgMaxSec'),

    showHeadline: qs('#showHeadline'),
    showRecordButton: qs('#showRecordButton'),
    showPrevButton: qs('#showPrevButton'),
    showNextButton: qs('#showNextButton'),
    showStopButton: qs('#showStopButton'),
    showUploadButton: qs('#showUploadButton'),
    showPoweredByLabel: qs('#showPoweredByLabel'),
    showNotRecordingLabel: qs('#showNotRecordingLabel'),
    showSubmitButton: qs('#showSubmitButton'),

    apiBaseUrl: qs('#cfgApiBaseUrl'),
    apiKey: qs('#cfgApiKey'),
    apiSecret: qs('#cfgApiSecret'),
    loggerEnabled: qs('#cfgLoggerEnabled'),
    loggerUrl: qs('#cfgLoggerUrl'),

    dailyLimit: qs('#cfgDailyLimit'),
    notifyOnLimit: qs('#cfgNotifyOnLimit'),
    autoBlockOnLimit: qs('#cfgAutoBlockOnLimit'),

    // branding
    brandingActions: qs('#mssBrandingActions'),
    logoFile: qs('#mssBrandLogoFile'),
    logoImg: qs('#mssBrandLogoImg'),
    logoStatus: qs('#mssBrandLogoStatus'),
    logoProg: qs('#mssBrandLogoProg'),
    logoUpload: qs('#mssBrandLogoUpload'),
    logoRemove: qs('#mssBrandLogoRemove'),

    form: qs('#mssConfigForm'),
  };

  // ---- defaults used if API returns {}, 404, or unknown shape
  const DEFAULTS = {
    headline: 'CEFR Assessment',
    poweredBy: 'Powered by MSS Vox',
    editableHeadline: false,
    theme: 'default',
    allowUpload: false,
    minSec: 30,
    maxSec: 61,

    showHeadline: true,
    showRecordButton: true,
    showPrevButton: true,
    showNextButton: true,
    showStopButton: true,
    showUploadButton: false,
    showPoweredByLabel: true,
    showNotRecordingLabel: true,
    showSubmitButton: true,

    apiBaseUrl: 'https://app.myspeakingscore.com',
    apiKey: '',
    apiSecret: '',
    loggerEnabled: false,
    loggerUrl: '',

    dailyLimit: 50,
    notifyOnLimit: true,
    autoBlockOnLimit: false,
  };

  // ---- load
  async function loadConfig(){
    if (!slug){
      setStatus('⚠️ Missing ?slug= in URL', true);
      applyToUI(DEFAULTS);
      return;
    }

    try{
      const res = await fetch(ADMIN_URL, { headers:{Accept:'application/json'}, cache:'no-store' });
      if (res.status === 404){
        console.warn('Config 404, using defaults');
        applyToUI(DEFAULTS);
        setStatus('Using defaults (no saved config yet)');
        // Branding: disable actions until backend logo route exists
        disableBrandingActions(true);
        return;
      }
      const body = await res.json().catch(()=>({}));
      console.log('[config-admin] GET body:', body);
      if(!res.ok){ throw new Error('HTTP '+res.status); }

      // Accept {config}, {form}, or raw object
      const cfg = body.config || body.form || body || {};
      const merged = { ...DEFAULTS, ...cfg };
      applyToUI(merged);
      setStatus('Loaded');

      // Probe logo endpoint availability (HEAD)
      try{
        const head = await fetch(`${ADMIN_URL}/logo`, { method:'HEAD' });
        disableBrandingActions(!(head.ok));
      }catch{ disableBrandingActions(true); }

    }catch(e){
      console.error('loadConfig failed', e);
      applyToUI(DEFAULTS);
      setStatus('Failed to load config – using defaults', true);
      disableBrandingActions(true);
    }
  }

  function disableBrandingActions(disabled){
    if (els.brandingActions){
      els.brandingActions.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
  }

  function applyToUI(cfg){
    setVal(els.headline, cfg.headline);
    setVal(els.poweredBy, cfg.poweredBy);
    setBool(els.editableHeadline, !!cfg.editableHeadline);

    setVal(els.theme, cfg.theme || 'default');
    setBool(els.allowUpload, !!cfg.allowUpload);
    setVal(els.minSec, cfg.minSec ?? '');
    setVal(els.maxSec, cfg.maxSec ?? '');

    setBool(els.showHeadline, !!cfg.showHeadline);
    setBool(els.showRecordButton, !!cfg.showRecordButton);
    setBool(els.showPrevButton, !!cfg.showPrevButton);
    setBool(els.showNextButton, !!cfg.showNextButton);
    setBool(els.showStopButton, !!cfg.showStopButton);
    setBool(els.showUploadButton, !!cfg.showUploadButton);
    setBool(els.showPoweredByLabel, !!cfg.showPoweredByLabel);
    setBool(els.showNotRecordingLabel, !!cfg.showNotRecordingLabel);
    setBool(els.showSubmitButton, !!cfg.showSubmitButton);

    setVal(els.apiBaseUrl, cfg.apiBaseUrl || '');
    setVal(els.apiKey, cfg.apiKey || '');
    setVal(els.apiSecret, cfg.apiSecret || '');
    setBool(els.loggerEnabled, !!cfg.loggerEnabled);
    setVal(els.loggerUrl, cfg.loggerUrl || '');

    setVal(els.dailyLimit, cfg.dailyLimit ?? '');
    setBool(els.notifyOnLimit, !!cfg.notifyOnLimit);
    setBool(els.autoBlockOnLimit, !!cfg.autoBlockOnLimit);

    if (cfg.brandLogoUrl){
      els.logoImg.src = cfg.brandLogoUrl;
      els.logoImg.style.display = '';
      els.logoStatus.textContent = 'Logo uploaded.';
    } else {
      els.logoImg.removeAttribute('src');
      els.logoImg.style.display = 'none';
      els.logoStatus.textContent = 'No logo uploaded yet.';
    }
  }

  function collectFromUI(){
    const cfg = {
      headline: getVal(els.headline),
      poweredBy: getVal(els.poweredBy),
      editableHeadline: getBool(els.editableHeadline),

      theme: getVal(els.theme) || 'default',
      allowUpload: getBool(els.allowUpload),
      minSec: +getVal(els.minSec) || 0,
      maxSec: +getVal(els.maxSec) || 0,

      showHeadline: getBool(els.showHeadline),
      showRecordButton: getBool(els.showRecordButton),
      showPrevButton: getBool(els.showPrevButton),
      showNextButton: getBool(els.showNextButton),
      showStopButton: getBool(els.showStopButton),
      showUploadButton: getBool(els.showUploadButton),
      showPoweredByLabel: getBool(els.showPoweredByLabel),
      showNotRecordingLabel: getBool(els.showNotRecordingLabel),
      showSubmitButton: getBool(els.showSubmitButton),

      apiBaseUrl: getVal(els.apiBaseUrl),
      apiKey: getVal(els.apiKey),
      apiSecret: getVal(els.apiSecret),
      loggerEnabled: getBool(els.loggerEnabled),
      loggerUrl: getVal(els.loggerUrl),

      dailyLimit: +getVal(els.dailyLimit) || 0,
      notifyOnLimit: getBool(els.notifyOnLimit),
      autoBlockOnLimit: getBool(els.autoBlockOnLimit),
    };
    if (els.logoImg?.src) cfg.brandLogoUrl = els.logoImg.src;
    return cfg;
  }

  // ---- save
  async function saveConfig(){
    const cfg = collectFromUI();
    try{
      const res = await fetch(ADMIN_URL, {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({config: cfg})
      });
      if(!res.ok) throw new Error('HTTP '+res.status);
      setStatus('Saved');
    }catch(e){
      console.error('saveConfig failed', e);
      setStatus('Save failed', true);
    }
  }

  // ---- branding upload/remove (guarded if endpoint missing)
  function updateLogoUI(url){
    if (url){
      els.logoImg.src = url;
      els.logoImg.style.display = '';
      els.logoStatus.textContent = 'Logo uploaded.';
    } else {
      els.logoImg.removeAttribute('src');
      els.logoImg.style.display = 'none';
      els.logoStatus.textContent = 'No logo uploaded yet.';
    }
  }

  async function uploadLogo(){
    if (els.brandingActions?.getAttribute('aria-disabled') === 'true'){
      return alert('Logo upload endpoint not available on this environment.');
    }
    const f = els.logoFile?.files?.[0];
    if(!f){ alert('Choose a logo file first.'); return; }
    setStatus('Uploading logo…');
    els.logoProg.style.display = ''; els.logoProg.value = 5;
    try{
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch(`${ADMIN_URL}/logo`, { method:'POST', body: fd });
      els.logoProg.value = 70;
      const body = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error('HTTP '+res.status);
      const url = body.url || body.brandLogoUrl;
      updateLogoUI(url);
      els.logoProg.value = 100;
      setTimeout(()=>{ els.logoProg.style.display='none'; els.logoProg.value=0; }, 350);
      setStatus('Logo uploaded');
    }catch(e){
      console.error('logo upload failed', e);
      els.logoProg.style.display='none'; els.logoProg.value=0;
      setStatus('Logo upload failed', true);
    }
  }

  async function removeLogo(){
    if (els.brandingActions?.getAttribute('aria-disabled') === 'true'){
      return alert('Logo remove endpoint not available on this environment.');
    }
    if(!confirm('Remove current logo?')) return;
    setStatus('Removing logo…');
    try{
      const res = await fetch(`${ADMIN_URL}/logo`, { method:'DELETE' });
      if(!res.ok) throw new Error('HTTP '+res.status);
      updateLogoUI('');
      setStatus('Logo removed');
    }catch(e){
      console.error('logo remove failed', e);
      setStatus('Logo remove failed', true);
    }
  }

  // ---- wire
  function wire(){
    els.form?.addEventListener('submit', (e)=>{ e.preventDefault(); saveConfig(); });
    els.logoUpload?.addEventListener('click', uploadLogo);
    els.logoRemove?.addEventListener('click', removeLogo);
  }

  wire();
  loadConfig();
})();
