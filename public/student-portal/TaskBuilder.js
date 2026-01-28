// /public/student-portal/TaskBuilder.js
"use strict";

/* ------------------------------------------------------------
   Minimal helpers
------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

function setText(id, txt) {
  const el = $(id);
  if (!el) return;
  el.textContent = txt == null ? "" : String(txt);
}

function setStatus(id, msg, kind) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "error", "warn");
  if (kind) el.classList.add(kind);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getQueryParam(name) {
  try {
    const p = new URLSearchParams(window.location.search || "");
    const v = (p.get(name) || "").trim();
    return v || "";
  } catch {
    return "";
  }
}

function readLS(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Canonical session/token keys in your platform
const LS_SESSION_KEY = "mssSession";
const LS_TOKEN_KEY = "mssActorToken";

/* ------------------------------------------------------------
   Auth + session context
------------------------------------------------------------ */
function readSession() {
  const raw = readLS(LS_SESSION_KEY);
  return raw ? safeJsonParse(raw) : null;
}

function readToken() {
  return String(readLS(LS_TOKEN_KEY) || "").trim();
}

function getSlugContext() {
  const slugUrl = getQueryParam("slug");
  const s = readSession() || {};
  const slugSession = String(s.slug || "").trim();
  return slugUrl || slugSession || "";
}

async function apiFetchJson(url, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const token = readToken();
  if (token) headers.set("Authorization", "Bearer " + token);
  headers.set("Accept", "application/json");

  // If we are sending JSON, enforce content-type
  const hasBody = opts.body != null;
  const method = String(opts.method || "GET").toUpperCase();
  const isJsonBody =
    hasBody &&
    typeof opts.body === "string" &&
    (opts.headers?.["Content-Type"] === "application/json" || headers.get("Content-Type") === "application/json");

  if (hasBody && method !== "GET" && !headers.get("Content-Type") && typeof opts.body === "string") {
    // Safe default if caller forgot
    headers.set("Content-Type", "application/json");
  }

  let res;
  let text = "";
  try {
    res = await fetch(url, { ...opts, headers, cache: "no-store" });
    text = await res.text(); // read once, then parse ourselves
  } catch (err) {
    return {
      res: { ok: false, status: 0 },
      body: { ok: false, error: "network_error", detail: String(err?.message || err) },
      rawText: "",
      contentType: "",
    };
  }

  const contentType = String(res.headers.get("content-type") || "");

  // Try JSON parse only if it looks like JSON
  let body = {};
  if (contentType.includes("application/json")) {
    try {
      body = text ? JSON.parse(text) : {};
    } catch (err) {
      body = { ok: false, error: "bad_json", detail: String(err?.message || err) };
    }
  } else {
    // Non-JSON response (often HTML 404 page, login page, etc.)
    body = {
      ok: false,
      error: "non_json_response",
      http_status: res.status,
      content_type: contentType || "(none)",
      preview: text.slice(0, 300),
    };
  }

  return { res, body, rawText: text, contentType };
}

/* ------------------------------------------------------------
   State
------------------------------------------------------------ */
const state = {
  slug: "",
  schoolId: null,
  actorType: "",
  email: "",
  role: "",
  studentId: null, // optional; only used if passed in URL for MVP
  questions: [],
  selectedIds: new Set(),
  aiPrompts: [],

  // UI config defaults
  widgetPath: "/widgets/Widget.html",
  dashboardPath: "/dashboards/Dashboard3.html",
  aiPromptId: null,
};

/* ------------------------------------------------------------
   Widget/Dashboard options (MVP)
------------------------------------------------------------ */
const WIDGET_OPTIONS = [
  { label: "Widget (default)", path: "widgets/Widget.html" },
  { label: "Widget-Min", path: "widgets/WidgetMin.html" },
  { label: "Widget-Max", path: "widgets/WidgetMaxhtml" },
  { label: "Widget-3", path: "widgets/Widget3.html" },
  {label: "Widget-One", path: "widgets/WidgetOne.html" },
];

const DASHBOARD_OPTIONS = [
  { label: "Dashboard3 (default)", path: "/dashboards/Dashboard3.html" },
  { label: "Dashboard", path: "/dashboards/Dashboard.html" },
  { label: "Dashboard-Min", path: "/dashboards/Dashboard-Min.html" },
];

/* ------------------------------------------------------------
   Load: “Me” (UI only)
------------------------------------------------------------ */
async function loadMe() {
  const s = readSession() || {};
  state.actorType = String(s.actorType || "").toLowerCase();
  state.email = String(s.email || "").trim();
  state.role =
    state.actorType === "admin"
      ? (s.isSuperadmin ? "Super admin" : "Admin")
      : (s.isTeacherAdmin ? "Teacher Admin" : "Teacher");

  // Optional MVP: allow TaskBuilder to run without student_id
  const sid = getQueryParam("student_id") || getQueryParam("studentId");
  state.studentId = sid ? Number(sid) : null;

  setText("who-email", state.email || "—");
  setText("who-role", state.role || "—");

  state.slug = getSlugContext();
  setText("pill-slug", state.slug || "—");

  // school id may exist in session
  const schoolId = s.schoolId ?? s.school_id ?? null;
  state.schoolId = schoolId != null ? Number(schoolId) : null;
  setText("pill-schoolid", state.schoolId != null ? `id: ${state.schoolId}` : "id: —");

  if (!state.slug) {
    setStatus("status-top", "Missing slug. Open this page with ?slug=... or select school in Admin Home.", "error");
  } else {
    setStatus("status-top", "", "");
  }
}

/* ------------------------------------------------------------
   Questions: fetch + render + filters
------------------------------------------------------------ */
function getVisibilityMode() {
  const v = ($("filter-visibility")?.value || "private").toLowerCase();
  if (v !== "private" && v !== "public" && v !== "all") return "private";
  return v;
}

function getTextFilter() {
  return String($("filter-text")?.value || "").trim().toLowerCase();
}

function applyQuestionFilters(allQuestions) {
  const mode = getVisibilityMode();
  const q = getTextFilter();

  return (allQuestions || []).filter((row) => {
    const isPublic = !!row.is_public;
    if (mode === "private" && isPublic) return false;
    if (mode === "public" && !isPublic) return false;

    if (q) {
      const hay =
        (row.question || "") +
        " " +
        (row.category || "") +
        " " +
        (row.level || "") +
        " " +
        String(row.assessment_id || "");
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderQuestions() {
  const wrap = $("questions-list");
  if (!wrap) return;

  const filtered = applyQuestionFilters(state.questions);
  setText("pill-selected-count", `Selected: ${state.selectedIds.size}`);

  if (!filtered.length) {
    wrap.innerHTML = `<div class="muted" style="padding:12px;">No questions match your filters.</div>`;
    setStatus("status-questions", "Loaded 0 questions.", "warn");
    return;
  }

  wrap.innerHTML = filtered
    .map((row) => {
      const id = Number(row.id);
      const checked = state.selectedIds.has(id) ? "checked" : "";
      const badge = row.is_public ? `<span class="tag public">Public</span>` : `<span class="tag private">Private</span>`;
      const a = row.assessment_id != null ? `<span class="tag subtle">assessment:${escapeHtml(row.assessment_id)}</span>` : "";
      return `
        <label class="qrow">
          <input type="checkbox" class="qchk" data-qid="${id}" ${checked} />
          <div class="qbody">
            <div class="qtext">${escapeHtml(row.question || "")}</div>
            <div class="qmeta">${badge} ${a}</div>
          </div>
        </label>
      `;
    })
    .join("");

  wrap.querySelectorAll(".qchk").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = Number(cb.getAttribute("data-qid"));
      if (!id) return;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      setText("pill-selected-count", `Selected: ${state.selectedIds.size}`);
    });
  });

  setStatus("status-questions", `Loaded ${filtered.length} questions.`, "ok");
}

async function loadQuestions() {
  if (!state.slug) return;

  setStatus("status-questions", "Loading questions…", "");
  const url = `/api/teacher/questions?slug=${encodeURIComponent(state.slug)}&ts=${Date.now()}`;
  const { res, body } = await apiFetchJson(url);

  if (!res.ok || body.ok === false) {
    const msg = body.error || `http_${res.status}`;
    setStatus("status-questions", `Failed to load questions: ${msg}`, "error");
    state.questions = [];
    renderQuestions();
    return;
  }

  state.questions = Array.isArray(body.questions) ? body.questions : [];
  renderQuestions();
}

/* ------------------------------------------------------------
   AI prompts (optional): handle 404 gracefully
------------------------------------------------------------ */
function renderAiPrompts() {
  const sel = $("sel-ai-prompt");
  if (!sel) return;

  const opts = [`<option value="">(None)</option>`]
    .concat(
      state.aiPrompts.map((p) => {
        const id = Number(p.id);
        const name = String(p.name || p.title || `Prompt ${id}`);
        return `<option value="${id}">${escapeHtml(name)}</option>`;
      })
    )
    .join("");

  sel.innerHTML = opts;
  sel.value = state.aiPromptId != null ? String(state.aiPromptId) : "";
}

async function loadAiPrompts() {
  if (!state.slug) return;

  // Your server currently has suggest + suggest-settings, but NO list endpoint.
  // So: treat 404 as "not ready yet" and do not break TaskBuilder.
  setStatus("status-prompts", "Loading AI prompts…", "");

  const candidates = [
  // Server supports path-param list endpoint:
  // GET /api/admin/ai-prompts/:slug
  `/api/admin/ai-prompts/${encodeURIComponent(state.slug)}?ts=${Date.now()}`,
];

  for (const url of candidates) {
    const { res, body } = await apiFetchJson(url);

    // 404 = endpoint not implemented (expected right now)
    if (res.status === 404) continue;

    // Other failure (auth, etc.)
    if (!res.ok || body.ok === false) {
      setStatus("status-prompts", `AI prompts unavailable (${body.error || "http_" + res.status}).`, "warn");
      state.aiPrompts = [];
      renderAiPrompts();
      return;
    }

    const list = body.prompts || body.ai_prompts || body.aiPrompts || body.items || [];
    state.aiPrompts = Array.isArray(list) ? list : [];
    setStatus("status-prompts", state.aiPrompts.length ? `Loaded ${state.aiPrompts.length} prompts.` : "No prompts found.", "ok");
    renderAiPrompts();
    return;
  }

  setStatus("status-prompts", "AI prompt list endpoint not available yet (404). Safe to ignore for now.", "warn");
  state.aiPrompts = [];
  renderAiPrompts();
}

/* ------------------------------------------------------------
   Save task
------------------------------------------------------------ */
function getTaskTitle() {
  return String($("task-title")?.value || "").trim();
}

function getWidgetPath() {
  return String($("sel-widget")?.value || state.widgetPath || "/widgets/Widget.html").trim();
}

function getDashboardPath() {
  return String($("sel-dashboard")?.value || state.dashboardPath || "/dashboards/Dashboard3.html").trim();
}

function getAiPromptId() {
  const v = String($("sel-ai-prompt")?.value || "").trim();
  return v ? Number(v) : null;
}

function buildTaskUrl(taskToken) {
  const u = new URL(getWidgetPath() || "/widgets/Widget.html", window.location.origin);
  u.searchParams.set("task", taskToken);
  if (state.slug) u.searchParams.set("slug", state.slug); // optional belt+suspenders
  return u.toString();
}

async function saveTask() {
  if (!state.slug) {
    setStatus("status-save", "Missing slug. Open Admin Home and select a school, then return.", "error");
    return;
  }

  const title = getTaskTitle();
  const widget_path = getWidgetPath();
  const dashboard_path = getDashboardPath();
  const ai_prompt_id = getAiPromptId();

  if (!state.selectedIds.size) {
    setStatus("status-save", "Select at least one question.", "error");
    return;
  }

  // remove student_id from payload entirely for templates:
const payload = {
  slug: state.slug,
  title: title || null,
  question_ids: Array.from(state.selectedIds),
  widget_path,
  dashboard_path,
  ai_prompt_id: ai_prompt_id || null,
};

  setStatus("status-save", "Saving task…", "");
  const { res, body } = await apiFetchJson("/api/teacher/task-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok || body.ok === false) {
    const msg = body.error || `http_${res.status}`;
    setStatus(
      "status-save",
      `Failed to save task: ${msg}${
        msg === "missing_student_id" || msg === "bad_student_id"
          ? " (Backend still requires student_id. Either relax schema or keep MVP as single-student tasks.)"
          : ""
      }`,
      "error"
    );
    return;
  }

  const task_token = body.task_token || body.taskToken || body.token || "";
  if (!task_token) {
    setStatus("status-save", "Task saved, but no task_token returned by server.", "warn");
    return;
  }

  const url = buildTaskUrl(task_token);
  setText("out-task-url", url);

  setStatus("status-save", "Task saved. Share the URL below.", "ok");
}

/* ------------------------------------------------------------
   Quick add private question (text-only; no help)
------------------------------------------------------------ */
async function quickAddQuestion() {
  if (!state.slug) {
    setStatus("status-quickadd", "Missing slug.", "error");
    return;
  }
  const q = String($("quick-question")?.value || "").trim();
  if (!q) {
    setStatus("status-quickadd", "Enter a question.", "error");
    return;
  }

  const payload = {
    slug: state.slug,
    question: q,
    is_public: false,
    help_level: "none",
  };

  setStatus("status-quickadd", "Saving private question…", "");
  const { res, body } = await apiFetchJson("/api/teacher/questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok || body.ok === false) {
    setStatus("status-quickadd", `Failed: ${body.error || "http_" + res.status}`, "error");
    return;
  }

  $("quick-question").value = "";
  setStatus("status-quickadd", "Saved. Refreshing list…", "ok");
  await loadQuestions();
}

/* ------------------------------------------------------------
   Share controls
------------------------------------------------------------ */
function copyUrl() {
  const txt = String($("out-task-url")?.textContent || "").trim();
  if (!txt || txt === "—") {
    setStatus("status-share", "No URL to copy yet. Save a task first.", "error");
    return;
  }
  navigator.clipboard.writeText(txt)
    .then(() => setStatus("status-share", "Copied URL to clipboard.", "ok"))
    .catch(() => setStatus("status-share", "Clipboard failed. Copy manually.", "warn"));
}

function openUrl() {
  const txt = String($("out-task-url")?.textContent || "").trim();
  if (!txt || txt === "—") {
    setStatus("status-share", "No URL to open yet. Save a task first.", "error");
    return;
  }
  window.open(txt, "_blank", "noopener,noreferrer");
  setStatus("status-share", "Opened URL in a new tab.", "ok");
}

/* ------------------------------------------------------------
   Wire UI
------------------------------------------------------------ */
function wireSelectors() {
  const w = $("sel-widget");
  if (w) {
    w.innerHTML = WIDGET_OPTIONS
      .map(o => `<option value="${escapeHtml(o.path)}">${escapeHtml(o.label)}</option>`)
      .join("");
    w.value = state.widgetPath;
    w.addEventListener("change", () => { state.widgetPath = getWidgetPath(); });
  }

  const d = $("sel-dashboard");
  if (d) {
    d.innerHTML = DASHBOARD_OPTIONS
      .map(o => `<option value="${escapeHtml(o.path)}">${escapeHtml(o.label)}</option>`)
      .join("");
    d.value = state.dashboardPath;
    d.addEventListener("change", () => { state.dashboardPath = getDashboardPath(); });
  }

  const p = $("sel-ai-prompt");
  p?.addEventListener("change", () => {
    state.aiPromptId = getAiPromptId();
  });
}

function wireActions() {
  $("btn-clear")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    state.selectedIds.clear();
    renderQuestions();
    setStatus("status-questions", "Selection cleared.", "ok");
  });

  $("btn-autoselect-3")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    const filtered = applyQuestionFilters(state.questions);
    state.selectedIds.clear();
    filtered.slice(0, 3).forEach((q) => state.selectedIds.add(Number(q.id)));
    renderQuestions();
    setStatus("status-questions", "Auto-selected 3.", "ok");
  });

  $("filter-visibility")?.addEventListener("change", () => renderQuestions());
  $("filter-text")?.addEventListener("input", () => renderQuestions());

  $("btn-save-task")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    saveTask().catch((err) => {
      console.warn(err);
      setStatus("status-save", "Save failed (unexpected).", "error");
    });
  });

  $("btn-copy-url")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    copyUrl();
  });

  $("btn-open-url")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    openUrl();
  });

  // FINISHES THE PART YOU SAID WAS TRUNCATED:
  $("btn-quickadd")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();
    quickAddQuestion().catch((err) => {
      console.warn(err);
      setStatus("status-quickadd", "Quick add failed (unexpected).", "error");
    });
  });

  $("btn-back")?.addEventListener("click", (e) => {
    if (e) e.preventDefault();

    // safest navigation: prefer history; otherwise fall back to a known portal path
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    const slug = state.slug ? `?slug=${encodeURIComponent(state.slug)}` : "";
    window.location.href = `/student-portal/StudentPortalHome.html${slug}`;
  });
}

/* ------------------------------------------------------------
   Init
------------------------------------------------------------ */
async function init() {
  await loadMe();
  wireSelectors();
  wireActions();

  // Load data
  await loadQuestions();
  await loadAiPrompts();
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error("[TaskBuilder] init failed", err);
    setStatus("status-top", "TaskBuilder failed to initialize. Check console for details.", "error");
  });
});