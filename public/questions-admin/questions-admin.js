<!-- public/questions-admin/questions-admin.js -->
<script>
(() => {
  const qs = (s)=>document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  console.log("🧩 MSS Questions Admin for slug=%o in %s mode",
              slug,
              location.hostname.includes("localhost") ? "LOCAL DEV" : "RENDER PROD");

  // UI hooks you already have:
  const statusEl = document.getElementById("status");
  const listEl   = document.getElementById("list");

  let schema = null;            // whole form object (labels etc.)
  let survey = [];              // questions array

  function setStatus(msg, ok=true){
    if (!statusEl) return;
    statusEl.textContent = (ok ? "Loaded." : msg);
    statusEl.style.color = ok ? "green" : "#b45309";
  }

  // ---- LOAD order: DB → bootstrap → local form.json ----
  async function loadSurvey() {
    try {
      // 1) DB (preferred)
      const r1 = await fetch(`/api/widget/${encodeURIComponent(slug)}/questions?ts=${Date.now()}`, {cache:"no-store"});
      if (r1.ok) {
        const {questions, form} = await r1.json();
        schema = form || {};
        survey = Array.isArray(questions) ? questions.slice() : [];
        render();
        setStatus("Loaded.");
        return;
      }
      console.warn("[WidgetSurvey] DB questions 404; trying bootstrap…");
    } catch (e) {
      console.warn("[WidgetSurvey] DB load failed:", e);
    }

    try {
      // 2) bootstrap (read current form from server)
      const r2 = await fetch(`/api/widget/${encodeURIComponent(slug)}/bootstrap?ts=${Date.now()}`, {cache:"no-store"});
      if (r2.ok) {
        const boot = await r2.json();
        schema = boot.form || {};
        survey = Array.isArray(schema.survey) ? schema.survey.slice() : [];
        render();
        setStatus("Loaded (bootstrap).");
        return;
      }
      console.warn("[WidgetSurvey] bootstrap 404; trying local file…");
    } catch (e) {
      console.warn("[WidgetSurvey] bootstrap load failed:", e);
    }

    try {
      // 3) local file next to this page
      const r3 = await fetch(`./form.json?ts=${Date.now()}`, {cache:"no-store"});
      if (!r3.ok) throw new Error("form.json not found");
      schema = await r3.json();
      survey = Array.isArray(schema.survey) ? schema.survey.slice() : [];
      render();
      setStatus("Loaded (form.json).");
    } catch (e) {
      console.error("[WidgetSurvey] all loads failed:", e);
      setStatus("Could not load questions.", false);
    }
  }

  // ---- SAVE → DB endpoint (by slug) ----
  async function saveSurvey() {
    try {
      const res = await fetch(`/api/admin/widget/${encodeURIComponent(slug)}/questions`, {
        method: "PUT",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ questions: survey })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus("Saved.", true);
    } catch (e) {
      console.error("[WidgetSurvey] save failed:", e);
      setStatus("Save failed.", false);
    }
  }

  // ---- your existing render + DnD hooks go here (unchanged) ----
  function summarize(q){ /* …existing… */ }
  function wireDnd(container){ /* …existing… */ }
  function render(){ /* …existing… */ }

  // Wire “Save questions” button if present
  const saveBtn = document.getElementById("saveQuestionsBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveSurvey);

  window.addEventListener("DOMContentLoaded", loadSurvey);
})();
</script>