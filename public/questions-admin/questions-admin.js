// public/questions-admin/questions-admin.js
console.log("✅ questions-admin.js loaded");

(function () {
  const qs = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  const params = new URLSearchParams(window.location.search);
  const slug = (params.get("slug") || "mss-demo").trim();

  // Wire header + tabs
  const slugEl = qs("#mssAdminSchoolSlug");
  if (slugEl) slugEl.textContent = slug;

  const tabConfig = qs("#mssAdminTabConfig");
  if (tabConfig) tabConfig.href = `/config-admin/?slug=${encodeURIComponent(slug)}`;

  const statusEl = qs("#qsStatus");
  const saveBtn = qs("#qsSave");
  const addBtn  = qs("#qsAdd");
  const backBtn = qs("#qsBack");

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "mss-admin-status" + (cls ? " " + cls : "");
  }

  // --- Compatibility shims (don’t touch your DnD!) ---
  function has(obj, path) {
    return path.split(".").reduce((o,k)=> (o && k in o) ? o[k] : undefined, obj) !== undefined;
  }

  function getQuestionsFromUI() {
    // Preferred modern API
    if (has(window, "WidgetSurvey.getQuestions")) return window.WidgetSurvey.getQuestions();
    // Known older API
    if (typeof window.getSurvey === "function") return window.getSurvey();
    // Very safe DOM fallback: any element with [data-question] carries text
    return qsa("[data-question]").map(el => (el.dataset.question || el.textContent || "").trim()).filter(Boolean);
  }

  function setQuestionsIntoUI(list) {
    // Preferred modern API
    if (has(window, "WidgetSurvey.setQuestions")) return window.WidgetSurvey.setQuestions(list);
    // Known older API
    if (typeof window.setSurvey === "function") return window.setSurvey(list);
    // DOM fallback: emit an event that your DnD can listen for to populate itself
    document.dispatchEvent(new CustomEvent("questions:load", { detail: { questions: list } }));
  }

  function addBlankQuestion() {
    // Minimal add: push a blank and hand to UI. If your UI provides its own “add” function, use it here.
    const current = getQuestionsFromUI();
    current.push("");
    setQuestionsIntoUI(current);
  }

  // --- Load from server ---
  async function loadQuestions() {
    try {
      setStatus("Loading…", "is-working");
      const res = await fetch(`/api/admin/widget/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);

      const form = body.form || {};
      const questions = Array.isArray(form.survey) ? form.survey : [];
      setQuestionsIntoUI(questions);
      setStatus("Loaded.", "is-ok");
      return { body, questions };
    } catch (e) {
      console.error("loadQuestions error:", e);
      setStatus("Failed to load questions.", "is-error");
      return null;
    }
  }

  // --- Save to server (only mutate form.survey; preserve other data) ---
  async function saveQuestions() {
    const snapshot = await (await fetch(`/api/admin/widget/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json" } })).json().catch(() => null);
    if (!snapshot || !snapshot.ok) {
      setStatus("Could not fetch current config before save.", "is-error");
      return;
    }

    const currentForm = snapshot.form || {};
    const currentConfig = snapshot.config || {};
    const currentBilling = snapshot.billing || {};

    const survey = getQuestionsFromUI().map(s => (s || "").trim()).filter(Boolean);

    const payload = {
      config: currentConfig,
      form: { ...currentForm, survey },
      billing: currentBilling,
    };

    try {
      setStatus("Saving…", "is-working");
      const put = await fetch(`/api/admin/widget/${encodeURIComponent(slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = await put.json().catch(() => ({}));
      if (!put.ok || !out.ok) throw new Error(out.error || out.message || `HTTP ${put.status}`);
      setStatus("Saved ✓", "is-ok");
    } catch (e) {
      console.error("saveQuestions error:", e);
      setStatus("Save failed.", "is-error");
    }
  }

  // Wire buttons
  if (saveBtn) saveBtn.addEventListener("click", saveQuestions);
  if (addBtn)  addBtn.addEventListener("click", addBlankQuestion);
  if (backBtn) backBtn.addEventListener("click", () => { window.location.href = `/config-admin/?slug=${encodeURIComponent(slug)}`; });

  // Initial load
  loadQuestions();
})();