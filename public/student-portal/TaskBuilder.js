// /public/student-portal/TaskBuilder.js
// v1.1 (2026-01-28) — Templates CRUD + Question selection (no filters)
// - Uses MSSClient.bootGuard for canonical auth + slug scope
// - Loads: templates, widgets, dashboards (static), AI prompts, questions
// - CRUD: New / Save / Duplicate / Delete templates
// - Selection: question_ids stored on template; UI syncs to checkboxes
// NOTE: Share task URL remains placeholder until “assign template → create task token” flow is wired.

console.log("✅ TaskBuilder.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // -------------------------------------------------------------------
  // Canonical auth/session boot
  // -------------------------------------------------------------------
  if (!window.MSSClient) {
    console.error("[TaskBuilder] MSSClient not loaded");
    window.location.href = "/admin-login/AdminLogin.html?reason=mssclient_missing";
    throw new Error("mssclient_missing");
  }

  const boot = window.MSSClient.bootGuard({
    allow: ["admin", "teacher", "superadmin"],
    requireSlug: true,
    requireToken: false,
  });

  const apiFetch = boot.apiFetch;
  const slug = String(boot.slug || "").trim();
  const session = boot.session || {};

  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------
  const state = {
    slug,
    schoolId: session.schoolId || null,

    questionsAll: [],
    selectedIds: new Set(),

    templates: [],
    currentTemplateId: null,

    widgets: [],
    dashboards: [
      { label: "Dashboard3 (Default)", value: "/dashboards/Dashboard3.html" },
      { label: "Dashboard4", value: "/dashboards/Dashboard4.html" },
      { label: "Dashboard5", value: "/dashboards/Dashboard5.html" },
      { label: "No dashboard", value: "" },
    ],

    prompts: [],
  };

  // -------------------------------------------------------------------
  // UI helpers
  // -------------------------------------------------------------------
  function setStatus(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.style.display = msg ? "block" : "none";
    el.textContent = msg || "";
    el.classList.remove("ok", "error", "warn");
    if (kind) el.classList.add(kind);
  }

  function setText(id, txt) {
    const el = $(id);
    if (!el) return;
    el.textContent = txt == null ? "—" : String(txt);
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function updateSelectedCount() {
    const n = state.selectedIds.size;
    const el = $("pill-selected-count");
    if (el) el.textContent = `Selected: ${n}`;
  }

  async function apiJson(url, opts) {
  const ensureSlug =
    opts && Object.prototype.hasOwnProperty.call(opts, "ensureSlug")
      ? !!opts.ensureSlug
      : true;

  const { ensureSlug: _drop, ...rest } = (opts || {});

  const res = await apiFetch(url, { ...rest, ensureSlug });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
     const msg = data?.error || data?.message || ("http_" + res.status);
     const err = new Error(msg);
     err.status = res.status;
     err.data = data;
     throw err;
   }
   return data;
 }

  function buildUrl(pathname, params) {
    const u = new URL(pathname, window.location.origin);
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === "") continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  function fillSelect(elId, items, placeholderLabel) {
    const el = $(elId);
    if (!el) return;
    const opts = [];
    if (placeholderLabel) opts.push(`<option value="">${escHtml(placeholderLabel)}</option>`);
    for (const it of (items || [])) {
      opts.push(`<option value="${escHtml(it.value)}">${escHtml(it.label)}</option>`);
    }
    el.innerHTML = opts.join("");
  }

  function fillAiPromptSelect() {
    const el = $("sel-ai-prompt");
    if (!el) return;

    const opts = [`<option value="">(none)</option>`];
    for (const p of state.prompts) {
      const id = Number(p.id);
      const name = p.name || `Prompt ${id}`;
      opts.push(`<option value="${id}">${escHtml(name)} (id=${id})</option>`);
    }
    el.innerHTML = opts.join("");
  }

  // -------------------------------------------------------------------
  // Data loaders
  // -------------------------------------------------------------------
  async function loadWidgets() {
    // Prefer admin listing, fallback to legacy /api/widgets, then hard defaults
    try {
      const d = await apiJson("/api/admin/widgets", { method: "GET" });
      const arr = Array.isArray(d.widgets) ? d.widgets : [];
      if (arr.length) {
        state.widgets = arr.map((name) => ({ label: name.replace(".html", ""), value: `/widgets/${name}` }));
        return;
      }
    } catch (e) {
      console.warn("[TaskBuilder] /api/admin/widgets failed; fallback", e?.message || e);
    }

    try {
      const d2 = await apiJson("/api/widgets", { method: "GET" });
      const arr2 = Array.isArray(d2.widgets) ? d2.widgets : [];
      if (arr2.length) {
        state.widgets = arr2.map((name) => ({ label: name.replace(".html", ""), value: `/widgets/${name}` }));
        return;
      }
    } catch (e2) {
      console.warn("[TaskBuilder] /api/widgets failed; using defaults", e2?.message || e2);
    }

    state.widgets = [
      { label: "Widget (Standard)", value: "/Widget.html" },
      { label: "Widget-Min (Minimal)", value: "/Widget-Min.html" },
      { label: "Widget3", value: "/Widget3.html" },
    ];
  }

  async function loadPrompts() {
    setStatus("status-prompts", "Loading AI prompts…", "");
    try {
      const d = await apiJson(`/api/admin/ai-prompts/${encodeURIComponent(state.slug)}`, { method: "GET" });
      const prompts = Array.isArray(d.prompts) ? d.prompts : (Array.isArray(d.rows) ? d.rows : []);
      state.prompts = (prompts || []).map((p) => ({
        id: Number(p.id),
        name: p.name || p.prompt_name || "",
      })).filter((p) => Number.isFinite(p.id) && p.id > 0);

      fillAiPromptSelect();
      setStatus("status-prompts", state.prompts.length ? "" : "No AI prompts found (optional).", state.prompts.length ? "" : "warn");
    } catch (e) {
      console.warn("[TaskBuilder] loadPrompts failed", e);
      state.prompts = [];
      fillAiPromptSelect();
      setStatus("status-prompts", `AI prompts unavailable: ${e.message || "error"}`, "warn");
    }
  }

  function normalizeQuestionRow(r) {
    return {
      id: Number(r.id),
      question: String(r.question || r.text || "").trim(),
      is_public: r.is_public === true,
    };
  }

  async function loadQuestions() {
  setStatus("status-questions", "Loading questions…", "");

  // read filter
  const visibility = String($("filter-visibility")?.value || "private")
    .trim()
    .toLowerCase();

  // build url
  const url =
    `/api/teacher/questions?slug=${encodeURIComponent(state.slug)}` +
    `&visibility=${encodeURIComponent(visibility)}` +
    `&ts=${Date.now()}`;

  console.log("[TaskBuilder] loadQuestions", { visibility, url });

  try {
    // IMPORTANT: ensureSlug false so apiFetch doesn't stomp query params
    const d = await apiJson(url, { method: "GET", ensureSlug: false });

    const rows = Array.isArray(d.questions) ? d.questions : [];
    state.questionsAll = rows
      .map(normalizeQuestionRow)
      .filter((q) => Number.isFinite(q.id) && q.id > 0 && q.question);

    renderQuestions();
    setStatus("status-questions", "", "");
  } catch (e) {
    console.error("[TaskBuilder] loadQuestions failed", e);
    state.questionsAll = [];
    renderQuestions();
    setStatus("status-questions", `Load failed: ${e.message || "error"}`, "error");
  }
}

  // -------------------------------------------------------------------
  // Templates CRUD (tolerant route shapes)
  // -------------------------------------------------------------------
  async function loadTemplates() {
    setStatus("status-templates", "Loading templates…", "");
    try {
      // Most likely list route already used elsewhere:
      // GET /api/teacher/task-templates?slug=...
      const d = await apiJson(`/api/teacher/task-templates?slug=${encodeURIComponent(state.slug)}&ts=${Date.now()}`, { method: "GET" });

      const rows =
        Array.isArray(d.templates) ? d.templates :
        Array.isArray(d.task_templates) ? d.task_templates :
        Array.isArray(d.rows) ? d.rows :
        Array.isArray(d.items) ? d.items :
        [];

      state.templates = rows
        .map((r) => ({
          id: Number(r.id || r.template_id || r.task_template_id),
          title: String(r.title || r.name || r.template_title || "").trim() || "Untitled template",
          widget_path: r.widget_path || r.widget || r.widgetUrl || r.widget_url || null,
          dashboard_path: r.dashboard_path || r.dashboard || r.dashboardUrl || r.dashboard_url || null,
          ai_prompt_id: r.ai_prompt_id != null ? Number(r.ai_prompt_id) : null,
          question_ids: Array.isArray(r.question_ids) ? r.question_ids.map(Number) : [],
          is_active: r.is_active == null ? true : !!r.is_active,
          updated_at: r.updated_at || null,
          created_at: r.created_at || null,
        }))
        .filter((t) => Number.isFinite(t.id) && t.id > 0);

      // If current selection vanished, clear it
      if (state.currentTemplateId && !state.templates.some(t => t.id === state.currentTemplateId)) {
        state.currentTemplateId = null;
      }

      renderTemplates();
      setStatus("status-templates", "", "");
    } catch (e) {
      console.error("[TaskBuilder] loadTemplates failed", e);
      state.templates = [];
      renderTemplates();
      setStatus("status-templates", `Load failed: ${e.message || "error"}`, "error");
    }
  }

  function renderTemplates() {
    const list = $("templates-list");
    if (!list) return;

    if (!state.templates.length) {
      list.innerHTML = `<div style="padding:12px;" class="muted">No templates yet. Click <strong>New template</strong>.</div>`;
      return;
    }

    const html = state.templates.map((t) => {
      const active = t.id === state.currentTemplateId ? "active" : "";
      const aiTag = t.ai_prompt_id ? `<span class="tag subtle">AI: ${t.ai_prompt_id}</span>` : `<span class="tag subtle">AI: —</span>`;
      const qTag = `<span class="tag subtle">Qs: ${Array.isArray(t.question_ids) ? t.question_ids.length : 0}</span>`;
      const wTag = t.widget_path ? `<span class="tag subtle">Widget</span>` : `<span class="tag subtle">Widget: —</span>`;
      const dTag = t.dashboard_path ? `<span class="tag subtle">Dash</span>` : `<span class="tag subtle">Dash: —</span>`;

      return `
        <div class="trow ${active}" data-tid="${t.id}">
          <div>
            <div class="tname"><strong>${escHtml(t.title)}</strong></div>
            <div class="tmeta">
              ${aiTag}${qTag}${wTag}${dTag}
            </div>
          </div>
          <div class="tactions">
            <button class="btn ghost btn-select-template" data-tid="${t.id}">Select</button>
          </div>
        </div>
      `;
    }).join("");

    list.innerHTML = html;

    list.querySelectorAll("button.btn-select-template").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const id = Number(btn.getAttribute("data-tid") || 0);
        if (!id) return;
        selectTemplateById(id);
      });
    });
  }

  function selectTemplateById(id) {
    const t = state.templates.find(x => x.id === id);
    if (!t) return;

    state.currentTemplateId = t.id;
    setText("pill-template-id", `template: ${t.id}`);

    // Fill editor fields
    const titleEl = $("task-title");
    if (titleEl) titleEl.value = t.title || "";

    const w = $("sel-widget");
    if (w && t.widget_path) w.value = t.widget_path;

    const d = $("sel-dashboard");
    if (d) d.value = t.dashboard_path || "";

    const p = $("sel-ai-prompt");
    if (p) p.value = t.ai_prompt_id ? String(t.ai_prompt_id) : "";

    // Sync question selection
    state.selectedIds.clear();
    const ids = Array.isArray(t.question_ids) ? t.question_ids : [];
    for (const qid of ids) {
      const n = Number(qid);
      if (Number.isFinite(n) && n > 0) state.selectedIds.add(n);
    }

    renderQuestions();
    renderTemplates();

    setStatus("status-save", `Loaded template ${t.id}.`, "ok");
  }

  function clearTemplateEditor() {
    state.currentTemplateId = null;
    setText("pill-template-id", "template: —");

    if ($("task-title")) $("task-title").value = "";
    if ($("sel-widget")) $("sel-widget").selectedIndex = 0;
    if ($("sel-dashboard")) $("sel-dashboard").value = "/dashboards/Dashboard3.html";
    if ($("sel-ai-prompt")) $("sel-ai-prompt").value = "";

    state.selectedIds.clear();
    renderQuestions();
    renderTemplates();
  }

  function buildTemplatePayload() {
    const title = String($("task-title")?.value || "").trim();
    const widget_path = String($("sel-widget")?.value || "").trim() || null;
    const dashboard_path = String($("sel-dashboard")?.value || "").trim() || null;

    const ai_prompt_raw = String($("sel-ai-prompt")?.value || "").trim();
    const ai_prompt_id = ai_prompt_raw ? Number(ai_prompt_raw) : null;

    const question_ids = Array.from(state.selectedIds.values())
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);

    return {
      slug: state.slug,
      title: title || "Untitled template",
      widget_path,
      dashboard_path,
      ai_prompt_id: Number.isFinite(ai_prompt_id) ? ai_prompt_id : null,
      question_ids,
      widget_config: {},   // placeholder for later (task-scoped overrides)
      is_active: true,
    };
  }

  function extractTemplateId(body) {
    return (
      body?.template_id ||
      body?.id ||
      body?.template?.id ||
      body?.task_template?.id ||
      body?.created?.id ||
      null
    );
  }

  async function createTemplate() {
    const payload = buildTemplatePayload();
    setStatus("status-save", "Creating template…", "");
    $("btn-save-template") && ($("btn-save-template").disabled = true);

    try {
      const d = await apiJson("/api/teacher/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const newId = Number(extractTemplateId(d) || 0) || null;
      await loadTemplates();

      if (newId) {
        selectTemplateById(newId);
        setStatus("status-save", `Created template ${newId}.`, "ok");
      } else {
        setStatus("status-save", "Created, but server did not return an id (shape mismatch).", "warn");
      }
    } catch (e) {
      console.error("[TaskBuilder] createTemplate failed", e);
      setStatus("status-save", `Create failed: ${e.message || "error"}`, "error");
    } finally {
      $("btn-save-template") && ($("btn-save-template").disabled = false);
    }
  }

  async function updateTemplate() {
    if (!state.currentTemplateId) {
      // If nothing selected, treat Save as Create
      return createTemplate();
    }

    const payload = buildTemplatePayload();
    payload.id = state.currentTemplateId;

    setStatus("status-save", `Saving template ${state.currentTemplateId}…`, "");
    $("btn-save-template") && ($("btn-save-template").disabled = true);

    try {
      // Best-practice: PUT /api/teacher/task-templates/:id
      // Fallback: PUT /api/teacher/task-templates (if that’s how your server is)
      try {
        await apiJson(`/api/teacher/task-templates/${encodeURIComponent(String(state.currentTemplateId))}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e1) {
        console.warn("[TaskBuilder] PUT /task-templates/:id failed; fallback to PUT /task-templates", e1?.message || e1);
        await apiJson("/api/teacher/task-templates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      await loadTemplates();
      selectTemplateById(state.currentTemplateId);
      setStatus("status-save", `Saved template ${state.currentTemplateId}.`, "ok");
    } catch (e) {
      console.error("[TaskBuilder] updateTemplate failed", e);
      setStatus("status-save", `Save failed: ${e.message || "error"}`, "error");
    } finally {
      $("btn-save-template") && ($("btn-save-template").disabled = false);
    }
  }

  async function duplicateTemplate() {
    if (!state.currentTemplateId) {
      setStatus("status-save", "Select a template to duplicate.", "warn");
      return;
    }

    const t = state.templates.find(x => x.id === state.currentTemplateId);
    if (!t) {
      setStatus("status-save", "Template not found in list.", "warn");
      return;
    }

    // Duplicate payload with new title
    const payload = buildTemplatePayload();
    payload.title = `${(t.title || "Template").trim()} (copy)`;

    setStatus("status-save", "Duplicating…", "");
    try {
      const d = await apiJson("/api/teacher/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const newId = Number(extractTemplateId(d) || 0) || null;
      await loadTemplates();

      if (newId) {
        selectTemplateById(newId);
        setStatus("status-save", `Duplicated to template ${newId}.`, "ok");
      } else {
        setStatus("status-save", "Duplicated, but server did not return an id.", "warn");
      }
    } catch (e) {
      console.error("[TaskBuilder] duplicateTemplate failed", e);
      setStatus("status-save", `Duplicate failed: ${e.message || "error"}`, "error");
    }
  }

  async function deleteTemplate() {
    if (!state.currentTemplateId) {
      setStatus("status-save", "Select a template to delete.", "warn");
      return;
    }

    const id = state.currentTemplateId;
    const ok = window.confirm(`Delete template ${id}? This cannot be undone.`);
    if (!ok) return;

    setStatus("status-save", `Deleting template ${id}…`, "");
    try {
      // Best-practice: DELETE /api/teacher/task-templates/:id
      // Fallback: DELETE /api/teacher/task-templates (with body)
      try {
        await apiJson(`/api/teacher/task-templates/${encodeURIComponent(String(id))}?slug=${encodeURIComponent(state.slug)}`, {
          method: "DELETE",
        });
      } catch (e1) {
        console.warn("[TaskBuilder] DELETE /task-templates/:id failed; fallback to DELETE body", e1?.message || e1);
        await apiJson("/api/teacher/task-templates", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: state.slug, id }),
        });
      }

      await loadTemplates();
      clearTemplateEditor();
      setStatus("status-save", `Deleted template ${id}.`, "ok");
    } catch (e) {
      console.error("[TaskBuilder] deleteTemplate failed", e);
      setStatus("status-save", `Delete failed: ${e.message || "error"}`, "error");
    }
  }

  // -------------------------------------------------------------------
  // Rendering questions list + selection (no filters)
  // -------------------------------------------------------------------
  function renderQuestions() {
    const list = $("questions-list");
    if (!list) return;

    if (!state.questionsAll.length) {
      list.innerHTML = `<div style="padding:12px;" class="muted">No questions available.</div>`;
      updateSelectedCount();
      return;
    }

    const html = state.questionsAll.map((q) => {
      const checked = state.selectedIds.has(q.id) ? "checked" : "";
      const tag = q.is_public ? `<span class="tag public">Public</span>` : `<span class="tag private">Private</span>`;
      return `
        <div class="qrow" data-qid="${q.id}">
          <div>
            <input type="checkbox" class="qcheck" data-qid="${q.id}" ${checked} />
          </div>
          <div>
            <div class="qtext">${escHtml(q.question)}</div>
            <div class="qmeta">
              ${tag}
              <span class="tag subtle">id: ${q.id}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");

    list.innerHTML = html;

    list.querySelectorAll("input.qcheck").forEach((cb) => {
      cb.addEventListener("change", () => {
        const id = Number(cb.getAttribute("data-qid") || 0);
        if (!id) return;
        if (cb.checked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        updateSelectedCount();
      });
    });

    updateSelectedCount();
  }

  function clearSelection() {
    state.selectedIds.clear();
    renderQuestions();
    setStatus("status-questions", "Selection cleared.", "ok");
  }

  function autoSelect3() {
    const top = state.questionsAll.slice(0, 3).map((x) => x.id);
    state.selectedIds.clear();
    for (const id of top) state.selectedIds.add(id);
    renderQuestions();
    setStatus("status-questions", top.length ? "Auto-selected 3." : "No questions to auto-select.", top.length ? "ok" : "warn");
  }

  // -------------------------------------------------------------------
  // Share box placeholder
  // -------------------------------------------------------------------
  async function copyUrl() {
    const txt = String($("out-task-url")?.textContent || "").trim();
    if (!txt || txt === "—") {
      setStatus("status-share", "No URL yet. (Token generation happens on assignment.)", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(txt);
      setStatus("status-share", "Copied URL.", "ok");
    } catch {
      setStatus("status-share", "Clipboard failed. Copy manually.", "warn");
    }
  }

  function openUrl() {
    const txt = String($("out-task-url")?.textContent || "").trim();
    if (!txt || txt === "—") {
      setStatus("status-share", "No URL yet. (Token generation happens on assignment.)", "warn");
      return;
    }
    window.open(txt, "_blank", "noopener,noreferrer");
  }

  function goBack() {
    const url = buildUrl("/student-portal/StudentPortalHome.html", { slug: state.slug });
    window.location.href = url;
  }

  // -------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------
  async function init() {
    // Identity / context
    setText("who-email", session.email || "—");
    setText("who-role", session.actorType || "—");
    setText("pill-slug", state.slug ? `slug: ${state.slug}` : "slug: —");
    setText("pill-schoolid", state.schoolId ? `id: ${state.schoolId}` : "id: —");
    setText("pill-template-id", "template: —");

    // Defaults
    setText("out-task-url", "—");
    updateSelectedCount();

    if (!state.slug) {
      setStatus("status-top", "Missing slug. Open with ?slug=... and ensure bootGuard provides scope.", "error");
      return;
    }

    // Wire events
    $("btn-back")?.addEventListener("click", (e) => { e.preventDefault(); goBack(); });

    $("btn-new-template")?.addEventListener("click", (e) => {
      e.preventDefault();
      clearTemplateEditor();
      setStatus("status-save", "New template: set fields + select questions, then Save.", "ok");
    });

    $("btn-refresh-templates")?.addEventListener("click", (e) => {
      e.preventDefault();
      loadTemplates();
    });

    $("btn-save-template")?.addEventListener("click", (e) => {
      e.preventDefault();
      updateTemplate();
    });

    $("btn-duplicate-template")?.addEventListener("click", (e) => {
      e.preventDefault();
      duplicateTemplate();
    });

    $("btn-delete-template")?.addEventListener("click", (e) => {
      e.preventDefault();
      deleteTemplate();
    });

    $("btn-clear")?.addEventListener("click", (e) => { e.preventDefault(); clearSelection(); });
    $("btn-autoselect-3")?.addEventListener("click", (e) => { e.preventDefault(); autoSelect3(); });

    $("btn-copy-url")?.addEventListener("click", (e) => { e.preventDefault(); copyUrl(); });
    $("btn-open-url")?.addEventListener("click", (e) => { e.preventDefault(); openUrl(); });

    $("filter-visibility")?.addEventListener("change", () => loadQuestions());

    // Load dropdowns + data
    try {
      setStatus("status-top", "Loading…", "");

      await loadWidgets();
      fillSelect("sel-widget", state.widgets, null);

      // Default widget (prefer Widget.html)
      const w = $("sel-widget");
      if (w) {
        const hasStandard = state.widgets.some((x) => (x.value || "").includes("Widget.html") || x.value === "/Widget.html");
        if (hasStandard) {
          const pick = state.widgets.find((x) => (x.value || "").includes("Widget.html"))?.value;
          if (pick) w.value = pick;
        }
      }

      fillSelect("sel-dashboard", state.dashboards, null);
      const d = $("sel-dashboard");
      if (d) d.value = "/dashboards/Dashboard3.html";

      await loadPrompts();
      await loadQuestions();
      await loadTemplates();

      // Auto-select first template if present
      if (!state.currentTemplateId && state.templates.length) {
        selectTemplateById(state.templates[0].id);
      }

      setStatus("status-top", "", "");
    } catch (e) {
      console.error("[TaskBuilder] init failed", e);
      setStatus("status-top", `Init failed: ${e.message || "error"}`, "error");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();