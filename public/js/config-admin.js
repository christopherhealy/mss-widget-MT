(function () {
  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  const slugInput = document.getElementById("schoolSlugInput");
  const reloadBtn = document.getElementById("reloadBtn");
  const statusEl = document.getElementById("configStatus");
  const bodyEl = document.getElementById("configBody");
  const saveBtn = document.getElementById("saveBtn");

  const headlineInput = document.getElementById("headlineInput");
  const poweredInput = document.getElementById("poweredInput");
  const questionsInput = document.getElementById("questionsInput");
  const allowUploadCheckbox = document.getElementById("allowUploadCheckbox");
  const minSecondsInput = document.getElementById("minSecondsInput");
  const maxSecondsInput = document.getElementById("maxSecondsInput");

  let currentSlug = null;
  let currentConfig = {};
  let currentForm = {};

  function setStatus(msg, ok) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-config-status" + (ok == null ? "" : ok ? " ok" : " err");
  }

  async function loadForSlug(slug) {
    if (!slug) {
      setStatus("Please enter a school slug.", false);
      return;
    }

    setStatus("Loading settings…", null);
    bodyEl.hidden = true;

    try {
      const res = await fetch(`/api/admin/widget/${encodeURIComponent(slug)}`);
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        const msg = body.error || body.message || "Could not load settings.";
        setStatus(msg, false);
        return;
      }

      currentSlug = body.slug;
      currentConfig = body.config || {};
      currentForm = body.form || {};

      // Populate fields
      headlineInput.value = currentForm.headline || "";
      poweredInput.value = currentForm.poweredByLabel || "Powered by MSS Vox";

      const survey = Array.isArray(currentForm.survey) ? currentForm.survey : [];
      questionsInput.value = survey.join("\n\n");

      const permit =
        typeof currentConfig.Permitupload === "boolean"
          ? currentConfig.Permitupload
          : true;
      allowUploadCheckbox.checked = permit;

      minSecondsInput.value =
        currentConfig.audioMinSeconds != null
          ? String(currentConfig.audioMinSeconds)
          : "20";
      maxSecondsInput.value =
        currentConfig.audioMaxSeconds != null
          ? String(currentConfig.audioMaxSeconds)
          : "100";

      bodyEl.hidden = false;
      setStatus(`Loaded settings for "${body.name}" (slug: ${body.slug}).`, true);
      slugInput.value = body.slug;
    } catch (err) {
      console.error("ConfigAdmin load error:", err);
      setStatus("Network error while loading settings.", false);
    }
  }

  async function saveChanges() {
    if (!currentSlug) {
      setStatus("No school loaded yet.", false);
      return;
    }

    setStatus("Saving…", null);

    const survey = questionsInput.value
      .split(/\n{2,}/) // split by blank lines
      .map((q) => q.trim())
      .filter(Boolean);

    currentForm.headline = headlineInput.value.trim();
    currentForm.poweredByLabel = poweredInput.value.trim() || "Powered by MSS Vox";
    currentForm.survey = survey;

    const minS = parseInt(minSecondsInput.value, 10);
    const maxS = parseInt(maxSecondsInput.value, 10);

    currentConfig.Permitupload = !!allowUploadCheckbox.checked;
    if (!Number.isNaN(minS)) currentConfig.audioMinSeconds = minS;
    if (!Number.isNaN(maxS)) currentConfig.audioMaxSeconds = maxS;

    try {
      const res = await fetch(`/api/admin/widget/${encodeURIComponent(currentSlug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: currentConfig,
          form: currentForm,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body.ok) {
        const msg = body.error || body.message || "Save failed.";
        setStatus(msg, false);
        return;
      }

      setStatus("Saved successfully.", true);
    } catch (err) {
      console.error("ConfigAdmin save error:", err);
      setStatus("Network error while saving.", false);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const initialSlug = getQueryParam("slug") || "widget-academy";
    if (slugInput) slugInput.value = initialSlug;
    loadForSlug(initialSlug);

    if (reloadBtn) {
      reloadBtn.addEventListener("click", () => {
        loadForSlug(slugInput.value.trim());
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", saveChanges);
    }
  });
})();