"use strict";

/* ------------------------------------------------------------
   Helpers
------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

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

function getQueryParam(name) {
  try {
    const p = new URLSearchParams(window.location.search || "");
    const v = (p.get(name) || "").trim();
    return v || "";
  } catch {
    return "";
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function readLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function readToken() { return String(readLS("mssActorToken") || "").trim(); }
function readSession() { const raw = readLS("mssSession"); return raw ? safeJsonParse(raw) : null; }

function getSlugContext() {
  const slugUrl =
    getQueryParam("slug") ||
    getQueryParam("school") ||
    getQueryParam("school_slug") ||
    getQueryParam("schoolSlug");

  const s = readSession() || {};
  const slugSession = String(s.slug || s.school_slug || s.schoolSlug || "").trim();

  return slugUrl || slugSession || "";
}

async function apiFetchJson(url, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const token = readToken();
  if (token) headers.set("Authorization", "Bearer " + token);
  headers.set("Accept", "application/json");

  const res = await fetch(url, { ...opts, headers, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function copyToClipboard(text) {
  return navigator.clipboard.writeText(String(text || ""));
}

/* ------------------------------------------------------------
   Widget/Dashboard registry
------------------------------------------------------------ */
const AVAILABLE_WIDGETS = [
  { label: "Widget (Standard)", value: "/Widget.html" },
  { label: "Widget-Min (Minimal)", value: "/Widget-Min.html" },
  { label: "Widget3", value: "/Widget3.html" },
];

const AVAILABLE_DASHBOARDS = [
  { label: "Dashboard3 (Default)", value: "/dashboards/Dashboard3.html" },
  { label: "Dashboard (Legacy)", value: "/dashboards/Dashboard.html" },
  { label: "No dashboard", value: "" },
];

function fillSelect(id, options, defaultValue) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = options
    .map(o => `<option value="${String(o.value).replace(/"/g, "&quot;")}">${o.label}</option>`)
    .join("");
  if (defaultValue != null) el.value = defaultValue;
}

/* ------------------------------------------------------------
   Parsing
------------------------------------------------------------ */
function parseCsvIds(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const parts = s.split(",").map(x => x.trim()).filter(Boolean);
  const ids = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null; // invalid token
    ids.push(Number(p));
  }
  // de-dupe while keeping order
  return Array.from(new Set(ids));
}

function parseWidgetConfigJson(raw) {
  const s = String(raw || "").trim();
  if (!s) return {};
  const obj = safeJsonParse(s);
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  return obj;
}

/* ------------------------------------------------------------
   State
------------------------------------------------------------ */
const state = {
  slug: "",
  lastTemplateId: null,
};

/* ------------------------------------------------------------
   Actions
------------------------------------------------------------ */
async function createTemplate() {
  const slug = state.slug;
  if (!slug) return setStatus("status-top", "Missing slug. Open with ?slug=... or select school first.", "error");

  const title = String($("tpl-title")?.value || "").trim();
  if (!title) return setStatus("status-save", "Template title is required.", "error");

  const widgetPath = String($("widget-path")?.value || "").trim();
  const dashboardPath = String($("dashboard-path")?.value || "").trim();

  const aiPromptRaw = String($("ai-prompt-id")?.value || "").trim();
  const aiPromptId = aiPromptRaw ? Number(aiPromptRaw) : null;
  if (aiPromptRaw && !aiPromptId) return setStatus("status-save", "AI Prompt ID must be numeric (or blank).", "error");

  const isActive = String($("is-active")?.value || "true") === "true";

  const qIds = parseCsvIds($("question-ids")?.value || "");
  if (qIds === null) return setStatus("status-save", "Question IDs must be comma-separated integers (e.g., 101,102).", "error");

  const widgetConfig = parseWidgetConfigJson($("widget-config")?.value || "");
  if (widgetConfig === null) return setStatus("status-save", "Widget config must be valid JSON object (or blank).", "error");

  const payload = {
    slug,
    title,
    question_ids: qIds,                 // server should store as jsonb array
    ai_prompt_id: aiPromptId,           // optional
    widget_path: widgetPath || null,
    dashboard_path: dashboardPath || null,
    widget_config: widgetConfig || {},  // jsonb
    is_active: isActive,
  };

  setStatus("status-save", "Creating template…", "");
  const { res, body } = await apiFetchJson(`/api/teacher/task-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok || body.ok === false) {
    return setStatus("status-save", `Create failed: ${body.error || "http_" + res.status}`, "error");
  }

  // tolerate response shapes
  const templateId =
    body.template_id ||
    body.id ||
    body.template?.id ||
    body.task_template?.id ||
    null;

  state.lastTemplateId = templateId ? Number(templateId) : null;

  setText("out-template-id", state.lastTemplateId || "—");
  setText("out-template-title", title);

  $("btn-copy-template-id") && ($("btn-copy-template-id").disabled = !state.lastTemplateId);

  setStatus("status-save", "Template created. It should now appear in Student Profile → Assign a Task.", "ok");
}

function openTemplateList() {
  // simplest: go to Student Profile page; template dropdown reads from /api/teacher/task-templates
  const u = new URL("/student-portal/StudentProfile.html", window.location.origin);
  if (state.slug) u.searchParams.set("slug", state.slug);
  window.location.href = u.pathname + "?" + u.searchParams.toString();
}

/* ------------------------------------------------------------
   Wire UI
------------------------------------------------------------ */
function wireUi() {
  $("btn-back")?.addEventListener("click", (e) => {
    e.preventDefault();
    const u = new URL("/student-portal/StudentPortalHome.html", window.location.origin);
    if (state.slug) u.searchParams.set("slug", state.slug);
    window.location.href = u.pathname + "?" + u.searchParams.toString();
  });

  $("btn-create-template")?.addEventListener("click", (e) => {
    e.preventDefault();
    createTemplate().catch((err) => {
      console.error(err);
      setStatus("status-save", "Create failed (unexpected). Check console.", "error");
    });
  });

  $("btn-copy-template-id")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!state.lastTemplateId) return setStatus("status-save", "No template ID yet.", "warn");
    try {
      await copyToClipboard(String(state.lastTemplateId));
      setStatus("status-save", "Copied template ID.", "ok");
    } catch {
      setStatus("status-save", "Clipboard failed. Copy manually.", "warn");
    }
  });

  $("btn-open-templates")?.addEventListener("click", (e) => {
    e.preventDefault();
    openTemplateList();
  });

  $("build-ts").textContent = new Date().toISOString();
}

/* ------------------------------------------------------------
   Init
------------------------------------------------------------ */
function init() {
  state.slug = getSlugContext();
  setText("pill-slug", state.slug ? `slug: ${state.slug}` : "slug: —");

  // defaults
  fillSelect("widget-path", AVAILABLE_WIDGETS, "/Widget.html");
  fillSelect("dashboard-path", AVAILABLE_DASHBOARDS, "/dashboards/Dashboard3.html");

  // initial outputs
  setText("out-template-id", "—");
  setText("out-template-title", "—");
  $("btn-copy-template-id") && ($("btn-copy-template-id").disabled = true);

  wireUi();
}

document.addEventListener("DOMContentLoaded", () => {
  init();
});