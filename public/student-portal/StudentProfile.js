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

function setQueryParam(name, value) {
  try {
    const u = new URL(window.location.href);
    if (value == null || value === "" || value === "0") u.searchParams.delete(name);
    else u.searchParams.set(name, String(value));
    window.history.replaceState({}, "", u.toString());
  } catch {}
}

function getStudentIdFromUrl() {
  const sid =
    getQueryParam("student_id") ||
    getQueryParam("studentId") ||
    getQueryParam("student") ||
    getQueryParam("id");

  const n = Number(sid || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
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

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString();
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------
   Modal helpers
------------------------------------------------------------ */
function openModal(title) {
  setText("modal-title", title || "Student");
  setStatus("status-modal", "", "");
  const bd = $("modal-backdrop");
  if (bd) bd.style.display = "flex";
}
function closeModal() {
  const bd = $("modal-backdrop");
  if (bd) bd.style.display = "none";
}
function modalGetVal(id) { return String($(id)?.value || "").trim(); }
function modalSetVal(id, v) { const el = $(id); if (el) el.value = v == null ? "" : String(v); }

function computeFullName(first, last) {
  return `${String(first || "").trim()} ${String(last || "").trim()}`.trim();
}

// ------------------------------------------------------------
// Transcript modal helper (SchoolPortal - Submissions)
// ------------------------------------------------------------
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pickTranscriptFromRow(row) {
  if (!row) return "";

  // Most common fields in your pipeline
  const direct =
    row.transcript_clean ??
    row.transcript ??
    row.transcriptRaw ??
    row.transcriptClean ??
    null;

  if (direct) return String(direct);

  // Sometimes stored in meta JSON
  const m = row.meta || row.mss || null;
  if (m && typeof m === "object") {
    if (m.transcript) return String(m.transcript);
    if (m.results?.transcript) return String(m.results.transcript);
  }

  return "";
}
// helpers to get us to the workspace
function getSlugFromUrlOrState() {
  const u = new URL(window.location.href);
  const slug = (u.searchParams.get("slug") || "").trim();
  // If you also store slug in session/global, keep this fallback:
  return slug || (window.__mss?.session?.slug || "");
}

function gotoWorkspace(slug, studentId) {
  const qs = new URLSearchParams();
  if (slug) qs.set("slug", slug);
  qs.set("student_id", String(studentId));
  window.location.href = `/student-portal/Workspace.html?${qs.toString()}`;
}

/**
 * Show transcript for a submission row.
 * Accepts either the full row object or a submissionId + lookup logic (if you prefer).
 */
function showTranscript(rowOrId) {
  try {
    let row = rowOrId;

    // If your handler passes just an id, you can resolve it from state here
    // Example:
    // if (typeof rowOrId === "number") row = (state.submissions || []).find(s => Number(s.id) === rowOrId);

    const txt = pickTranscriptFromRow(row);
    if (!txt) {
      // If you have a toast/status helper, use it; otherwise alert
      alert("Transcript not available for this submission.");
      return;
    }

    const html = `
      <div style="max-height:60vh; overflow:auto; padding:10px;">
        <pre style="white-space:pre-wrap; margin:0;">${escapeHtml(txt)}</pre>
      </div>
    `;

    // Use whichever modal helper exists in your project:
    if (typeof showModalHtml === "function") {
      showModalHtml("Transcript", html);
      return;
    }
    if (typeof showModal === "function") {
      showModal({ title: "Transcript", html });
      return;
    }

    // Fallback (still functional)
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (w) {
      w.document.write(`<title>Transcript</title>${html}`);
      w.document.close();
    } else {
      alert(txt);
    }
  } catch (err) {
    console.error("showTranscript failed:", err);
    alert("Could not display transcript (console has details).");
  }
}

// IMPORTANT: if your row action calls showTranscript(...) by name,
// make it global so inline/dynamic handlers can see it.
window.showTranscript = showTranscript;

/* ------------------------------------------------------------
   Auth
------------------------------------------------------------ */
const LS_SESSION_KEY = "mssSession";
const LS_TOKEN_KEY = "mssActorToken";

function readLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function readSession() { const raw = readLS(LS_SESSION_KEY); return raw ? safeJsonParse(raw) : null; }
function readToken() { return String(readLS(LS_TOKEN_KEY) || "").trim(); }

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

/* ------------------------------------------------------------
   State
------------------------------------------------------------ */
const state = {
  slug: "",
  // list
  students: [],
  selectedStudentId: null,
  searchQ: "",
  limit: 25,
  offset: 0,
  totalApprox: null,
  // profile
  student: null,
  assignedTasks: [],
  // templates
  templates: [],
  lastAssignedUrl: "",
  // modal
  modalMode: null, // "add" | "edit"
};

/* ------------------------------------------------------------
   API contracts for CRUD
------------------------------------------------------------ */
async function apiCreateStudent(payload) {
  const url = `/api/teacher/students`;
  return apiFetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function apiUpdateStudent(studentId, payload) {
  const url = `/api/teacher/students/${encodeURIComponent(studentId)}`;
  return apiFetchJson(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Soft delete route (preferred)
async function apiDeactivateStudent(studentId, payload) {
  const url = `/api/teacher/students/${encodeURIComponent(studentId)}/inactive`;
  return apiFetchJson(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/* ------------------------------------------------------------
   Students list
------------------------------------------------------------ */
async function loadStudentsList() {
  if (!state.slug) return;

  setStatus("status-students", "Loading students…", "");
  const url =
    `/api/teacher/students?slug=${encodeURIComponent(state.slug)}` +
    `&limit=${encodeURIComponent(state.limit)}` +
    `&offset=${encodeURIComponent(state.offset)}` +
    `&ts=${Date.now()}`;

  const { res, body } = await apiFetchJson(url);

  if (res.status === 404) {
    state.students = [];
    renderStudentsTable();
    setStatus(
      "status-students",
      "Students list endpoint not implemented yet (404). Use search (2+ chars) once search is wired to show results in the table.",
      "warn"
    );
    return;
  }

  if (!res.ok || body.ok === false) {
    state.students = [];
    renderStudentsTable();
    setStatus("status-students", `Failed to load students: ${body.error || "http_" + res.status}`, "error");
    return;
  }

  const list = body.students || body.items || [];
  state.students = Array.isArray(list) ? list : [];
  if (body.total != null) state.totalApprox = Number(body.total);

  // If current selection is no longer in list, keep selection but do not highlight
  renderStudentsTable();
  setStatus("status-students", `Loaded ${state.students.length} students.`, "ok");
}

async function searchStudents(q) {
  if (!state.slug) return;

  const qq = String(q || "").trim();
  state.searchQ = qq;

  if (!qq) {
    state.offset = 0;
    await loadStudentsList();
    return;
  }

  // Allow numeric ID search with 1 char; require 2+ for text
  const isInt = /^\d+$/.test(qq);
  if (!isInt && qq.length < 2) {
    state.students = [];
    renderStudentsTable({ hint: "Type 2+ characters to search (or enter a numeric ID)." });
    return;
  }

  setStatus("status-students", "Searching…", "");
  const url =
    `/api/teacher/students/search?slug=${encodeURIComponent(state.slug)}` +
    `&q=${encodeURIComponent(qq)}` +
    `&limit=25&ts=${Date.now()}`;

  const { res, body } = await apiFetchJson(url);

  if (!res.ok || body.ok === false) {
    state.students = [];
    renderStudentsTable();
    setStatus("status-students", `Search failed: ${body.error || "http_" + res.status}`, "error");
    return;
  }

  const list = body.students || body.items || [];
  state.students = Array.isArray(list) ? list : [];
  renderStudentsTable();
  setStatus("status-students", state.students.length ? `Found ${state.students.length} match(es).` : "No matches.", "ok");
}

function renderStudentsTable(opts = {}) {
  const tb = $("students-tbody");
  if (!tb) return;

  const list = Array.isArray(state.students) ? state.students : [];
  setText("students-count", `${list.length} student${list.length === 1 ? "" : "s"}`);

  // NOTE: table now has 4 columns (Name, Email, L1, Workspace)
  if (!list.length) {
    const hint = opts.hint || (state.searchQ ? "No matches." : "No students found.");
    tb.innerHTML = `<tr><td colspan="4" class="muted" style="padding:10px;">${escapeHtml(hint)}</td></tr>`;
    return;
  }

  tb.innerHTML = list
    .map((s) => {
      const id = Number(s.id);
      const name = escapeHtml(s.full_name || s.name || s.email || `Student ${id}`);
      const email = escapeHtml(s.email || "");
      const l1 = escapeHtml(s.l1 || "");
      const active = id === Number(state.selectedStudentId) ? "active" : "";

      return `
        <tr class="students-row ${active}" data-student-id="${id}">
          <td>
            <strong>${name}</strong>
            <div class="students-meta muted">
              id: ${id}${s.external_id ? ` • ext: ${escapeHtml(s.external_id)}` : ""}
            </div>
          </td>
          <td>${email || "<span class='muted'>—</span>"}</td>
          <td>${l1 || "<span class='muted'>—</span>"}</td>
          <td>
            <button
              class="btn btn-workspace"
              type="button"
              data-action="workspace"
              data-student-id="${id}"
              ${id ? "" : "disabled"}
            >
              Workspace →
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Single delegated handler: row click selects; button click navigates to Workspace
  tb.onclick = async (e) => {
    const btn = e.target.closest("button[data-action='workspace']");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();

      const sid = Number(btn.getAttribute("data-student-id") || 0);
      if (!sid) return;

      // slug comes from state (preferred) or URL
      const slug =
        String(state.slug || "").trim() ||
        String(new URL(window.location.href).searchParams.get("slug") || "").trim();

      const qs = new URLSearchParams();
      if (slug) qs.set("slug", slug);
      qs.set("student_id", String(sid));

      window.location.href = `/student-portal/Workspace.html?${qs.toString()}`;
      return;
    }

    const tr = e.target.closest("tr.students-row");
    if (!tr) return;

    const sid = Number(tr.getAttribute("data-student-id") || 0);
    if (!sid) return;

    await selectStudent(sid);
  };
}
/* ------------------------------------------------------------
   Select + load profile
------------------------------------------------------------ */
async function selectStudent(studentId) {
  state.selectedStudentId = Number(studentId);

  // ✅ keep URL in sync (only when we actually select)
  setQueryParam("student_id", state.selectedStudentId);
  setQueryParam("student", state.selectedStudentId); // optional backwards compat

  setText("pill-studentid", `student: ${state.selectedStudentId}`);
  $("student-empty-hint") && ($("student-empty-hint").style.display = "none");

  $("btn-refresh-profile") && ($("btn-refresh-profile").disabled = false);
  $("btn-students-edit") && ($("btn-students-edit").disabled = false);
  $("btn-students-remove") && ($("btn-students-remove").disabled = false);

  renderStudentsTable();

  await loadStudentProfile();
  await loadTemplates();
}

async function loadStudentProfile() {
  if (!state.slug || !state.selectedStudentId) return;

  setStatus("status-top", "", "");
  setStatus("status-tasks", "", "");

  const url =
    `/api/teacher/students/${encodeURIComponent(state.selectedStudentId)}/profile` +
    `?slug=${encodeURIComponent(state.slug)}&ts=${Date.now()}`;

  const { res, body } = await apiFetchJson(url);

  if (res.status === 404) {
    state.student = null;
    state.assignedTasks = [];
    renderStudent();
    renderTasks();
    setStatus("status-top", "Student profile endpoint not implemented yet (404).", "warn");
    return;
  }

  if (!res.ok || body.ok === false) {
    state.student = null;
    state.assignedTasks = [];
    renderStudent();
    renderTasks();
    setStatus("status-top", `Failed to load student profile: ${body.error || "http_" + res.status}`, "error");
    return;
  }

  state.student = body.student || body.profile || body.data?.student || null;
  state.assignedTasks = Array.isArray(body.assigned_tasks)
    ? body.assigned_tasks
    : (Array.isArray(body.tasks) ? body.tasks : []);

  renderStudent();
  renderTasks();
}

function renderStudent() {
  const st = state.student;

  setText("pill-slug", state.slug ? `slug: ${state.slug}` : "slug: —");
  setText("pill-studentid", state.selectedStudentId ? `student: ${state.selectedStudentId}` : "student: —");

  if (!st) {
    setText("st-name", "—");
    setText("st-email", "—");
    setText("st-id", state.selectedStudentId || "—");
    setText("st-external", "—");
    setText("st-l1", "—");
    setText("st-gender", "—");
    setText("st-created", "—");
    setText("st-last", "—");
    return;
  }

  setText("st-name", st.full_name || st.name || "—");
  setText("st-email", st.email || "—");
  setText("st-id", st.id || state.selectedStudentId || "—");
  setText("st-external", st.external_id || "—");
  setText("st-l1", st.l1 || "—");
  setText("st-gender", st.gender || "—");
  setText("st-created", fmtDate(st.created_at || st.createdAt));
  setText("st-last", fmtDate(st.last_activity_at || st.lastActivityAt || st.last_submission_at));
}

/* ------------------------------------------------------------
   Templates list + assign
------------------------------------------------------------ */
async function loadTemplates() {
  if (!state.slug) return;

  setStatus("status-assign", "", "");
  const url = `/api/teacher/task-templates?slug=${encodeURIComponent(state.slug)}&ts=${Date.now()}`;
  const { res, body } = await apiFetchJson(url);

  if (res.status === 404) {
    state.templates = [];
    renderTemplates();
    setStatus("status-assign", "Template list endpoint not implemented yet (404).", "warn");
    return;
  }

  if (!res.ok || body.ok === false) {
    state.templates = [];
    renderTemplates();
    setStatus("status-assign", `Templates unavailable: ${body.error || "http_" + res.status}`, "warn");
    return;
  }

  const list = body.templates || body.items || body.task_templates || [];
  state.templates = Array.isArray(list) ? list : [];
  renderTemplates();

  setStatus("status-assign", state.templates.length ? `Loaded ${state.templates.length} templates.` : "No templates found.", "ok");
}

function renderTemplates() {
  const sel = $("sel-template");
  if (!sel) return;

  const templates = Array.isArray(state.templates) ? state.templates : [];

  const opts = [`<option value="">(Select a template)</option>`]
    .concat(templates.map((t) => {
      const id = Number(t.id);
      const name = String(t.title || t.name || t.template_name || `Template ${id}`);
      const n = t.question_count != null ? ` (${t.question_count} q)` : "";
      return `<option value="${id}">${escapeHtml(name + n)}</option>`;
    }))
    .join("");

  sel.innerHTML = opts;

  const canAssign = !!state.selectedStudentId && templates.length > 0;
  $("btn-assign") && ($("btn-assign").disabled = !canAssign);
}

async function assignTemplate() {
  const templateId = Number(($("sel-template")?.value || 0));
  if (!state.slug) return setStatus("status-assign", "Missing slug.", "error");
  if (!state.selectedStudentId) return setStatus("status-assign", "Select a student first.", "error");
  if (!templateId) return setStatus("status-assign", "Select a template first.", "error");

  setStatus("status-assign", "Assigning…", "");
  const url = `/api/teacher/students/${encodeURIComponent(state.selectedStudentId)}/assign-template`;
  const payload = { slug: state.slug, template_id: templateId };

  const { res, body } = await apiFetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 404) {
    setStatus("status-assign", "Assign endpoint not implemented yet (404).", "warn");
    return;
  }

  if (!res.ok || body.ok === false) {
    setStatus("status-assign", `Assign failed: ${body.error || "http_" + res.status}`, "error");
    return;
  }

  const taskUrl =
    body.task_url ||
    body.url ||
    (body.task_token ? buildTaskUrl(body.task_token) : "");

  if (taskUrl) {
    state.lastAssignedUrl = taskUrl;
    setText("out-task-url", taskUrl);
  } else {
    setText("out-task-url", "—");
  }

  setStatus("status-assign", "Assigned. Refreshing profile…", "ok");
  await loadStudentProfile();
}

function buildTaskUrl(taskToken) {
  const u = new URL("/Widget.html", window.location.origin);
  u.searchParams.set("task", taskToken);
  if (state.slug) u.searchParams.set("slug", state.slug);
  return u.toString();
}

/* ------------------------------------------------------------
   Assigned tasks render
------------------------------------------------------------ */
function getTaskStatusLabel(t) {
  const s = String(t.status || "").toLowerCase();
  if (s) return t.status;
  if (t.submission_count > 0) return "Submitted";
  if (t.attempt_count > 0) return "In progress";
  return "Not started";
}

function renderTasks() {
  const wrap = $("tasks-wrap");
  if (!wrap) return;

  const tasks = Array.isArray(state.assignedTasks) ? state.assignedTasks : [];
  setText("tasks-count", `${tasks.length} task${tasks.length === 1 ? "" : "s"}`);

  if (!state.selectedStudentId) {
    wrap.innerHTML = `<div class="muted" style="padding:10px;">Select a student to load tasks.</div>`;
    return;
  }

  if (!tasks.length) {
    wrap.innerHTML = `<div class="muted" style="padding:10px;">No assigned tasks yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${tasks.map((t) => {
          const title = escapeHtml(t.title || t.name || `Task ${t.id}`);
          const status = escapeHtml(getTaskStatusLabel(t));
          const created = escapeHtml(fmtDate(t.created_at || t.createdAt));
          const token = t.task_token || t.token || "";
          const url = t.task_url || (token ? buildTaskUrl(token) : "");
          const urlEsc = escapeHtml(url);

          return `
            <tr>
              <td>${title}</td>
              <td>${status}</td>
              <td>${created}</td>
              <td class="actions">
                <button class="btn btn-copy" data-url="${urlEsc}">Copy URL</button>
                <button class="btn btn-open" data-url="${urlEsc}">Open</button>
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll(".btn-copy").forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = String(b.getAttribute("data-url") || "").trim();
      if (!url) return setStatus("status-tasks", "No URL available for this task yet.", "warn");
      try {
        await navigator.clipboard.writeText(url);
        setStatus("status-tasks", "Copied URL.", "ok");
      } catch {
        setStatus("status-tasks", "Clipboard failed. Copy manually.", "warn");
      }
    });
  });

  wrap.querySelectorAll(".btn-open").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const url = String(b.getAttribute("data-url") || "").trim();
      if (!url) return setStatus("status-tasks", "No URL available for this task yet.", "warn");
      window.open(url, "_blank", "noopener,noreferrer");
      setStatus("status-tasks", "Opened in new tab.", "ok");
    });
  });
}

/* ------------------------------------------------------------
   CRUD modal logic
------------------------------------------------------------ */
function fillModalFromStudent(st) {
  // Prefer explicit columns if backend returns them; fallback to splitting full_name.
  const fn = st?.first_name || "";
  const ln = st?.last_name || "";
  if (fn || ln) {
    modalSetVal("m-first", fn);
    modalSetVal("m-last", ln);
  } else {
    const parts = String(st?.full_name || "").trim().split(/\s+/).filter(Boolean);
    modalSetVal("m-first", parts[0] || "");
    modalSetVal("m-last", parts.length > 1 ? parts.slice(1).join(" ") : "");
  }

  modalSetVal("m-email", st?.email || "");
  modalSetVal("m-external", st?.external_id || "");
  modalSetVal("m-l1", st?.l1 || "");
  modalSetVal("m-l1-other", st?.l1_other || "");
  modalSetVal("m-gender", st?.gender || "");

  const other = $("m-l1-other");
  if (other) other.disabled = (modalGetVal("m-l1") !== "other");
}

function readModalPayload() {
  const first_name = modalGetVal("m-first");
  const last_name = modalGetVal("m-last");
  const email = modalGetVal("m-email") || null;
  const external_id = modalGetVal("m-external") || null;
  const l1 = modalGetVal("m-l1") || null;
  const l1_other = modalGetVal("m-l1-other") || null;
  const gender = modalGetVal("m-gender") || null;

  if (!first_name || !last_name) return { error: "Missing first and last name." };
  if (l1 === "other" && (!l1_other || l1_other.length < 2)) return { error: "If L1 is Other, provide L1 (Other)." };

  return {
    first_name,
    last_name,
    full_name: computeFullName(first_name, last_name), // safe even if BE ignores
    email,
    external_id,
    l1,
    l1_other,
    gender,
  };
}

async function onAddStudent() {
  state.modalMode = "add";
  fillModalFromStudent(null);
  openModal("Add Student");
}

async function onEditStudent() {
  if (!state.selectedStudentId) return;

  state.modalMode = "edit";

  // Use loaded profile if available; else find row from list
  let st = state.student;
  if (!st || Number(st.id) !== Number(state.selectedStudentId)) {
    st = (state.students || []).find(x => Number(x.id) === Number(state.selectedStudentId)) || {};
  }

  fillModalFromStudent(st);
  openModal("Edit Student");
}

async function onSaveModal() {
  if (!state.slug) return;

  const p = readModalPayload();
  if (p.error) return setStatus("status-modal", p.error, "error");

  setStatus("status-modal", "Saving…", "");

  if (state.modalMode === "add") {
    const payload = { slug: state.slug, ...p };
    const { res, body } = await apiCreateStudent(payload);

    if (!res.ok || body.ok === false) {
      return setStatus("status-modal", `Create failed: ${body.error || "http_" + res.status}`, "error");
    }

    setStatus("status-modal", "Created.", "ok");
    closeModal();

    // Refresh list and select new student if returned
    state.offset = 0;
    state.searchQ = "";
    $("students-search") && ($("students-search").value = "");
    await loadStudentsList();

    const newId = body.student?.id || body.id;
    if (newId) await selectStudent(Number(newId));
    return;
  }

  if (state.modalMode === "edit") {
    if (!state.selectedStudentId) return setStatus("status-modal", "No student selected.", "error");

    const payload = { slug: state.slug, ...p };
    const { res, body } = await apiUpdateStudent(state.selectedStudentId, payload);

    if (!res.ok || body.ok === false) {
      return setStatus("status-modal", `Update failed: ${body.error || "http_" + res.status}`, "error");
    }

    setStatus("status-modal", "Updated.", "ok");
    closeModal();

    await loadStudentsList();
    await loadStudentProfile();
    return;
  }

  setStatus("status-modal", "Unknown modal mode.", "error");
}

async function onRemoveStudent() {
  if (!state.slug) return;
  if (!state.selectedStudentId) return;

  const ok = window.confirm("Remove this student? This will set is_active=false (soft delete).");
  if (!ok) return;

  setStatus("status-top", "Removing…", "");
  const { res, body } = await apiDeactivateStudent(state.selectedStudentId, { slug: state.slug });

  if (!res.ok || body.ok === false) {
    return setStatus("status-top", `Remove failed: ${body.error || "http_" + res.status}`, "error");
  }

  setStatus("status-top", "Student set to inactive.", "ok");

  // Clear selection
  state.selectedStudentId = null;
  state.student = null;
  state.assignedTasks = [];

  setText("pill-studentid", "student: —");
  $("btn-refresh-profile") && ($("btn-refresh-profile").disabled = true);
  $("btn-students-edit") && ($("btn-students-edit").disabled = true);
  $("btn-students-remove") && ($("btn-students-remove").disabled = true);
  $("student-empty-hint") && ($("student-empty-hint").style.display = "block");

  renderStudentsTable();
  renderStudent();
  renderTasks();

  // Reload list
  state.offset = 0;
  state.searchQ = "";
  $("students-search") && ($("students-search").value = "");
  await loadStudentsList();
}

/* ------------------------------------------------------------
   Wire UI
------------------------------------------------------------ */
function wireActions() {
  $("btn-back")?.addEventListener("click", (e) => {
  if (e?.preventDefault) e.preventDefault();

  const slug = state.slug
    ? `?slug=${encodeURIComponent(state.slug)}`
    : "";

  // StudentProfile back ALWAYS goes to AdminHome / StudentPortalHome
  window.location.href = `/student-portal/StudentPortalHome.html${slug}`;
});

  $("btn-students-refresh")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    state.offset = 0;
    $("students-search") && ($("students-search").value = "");
    state.searchQ = "";
    await loadStudentsList();
  });

  $("btn-prev")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (state.searchQ) return;
    state.offset = Math.max(0, state.offset - state.limit);
    await loadStudentsList();
  });

  $("btn-next")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (state.searchQ) return;
    state.offset = state.offset + state.limit;
    await loadStudentsList();
  });

  const onSearch = debounce(async () => {
    const q = String($("students-search")?.value || "").trim();
    await searchStudents(q);
  }, 200);
  $("students-search")?.addEventListener("input", () => onSearch());

  $("btn-refresh-profile")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    await loadStudentProfile();
  });

  $("btn-assign")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    assignTemplate().catch((err) => {
      console.warn(err);
      setStatus("status-assign", "Assign failed (unexpected).", "error");
    });
  });

  $("btn-copy-url")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const txt = String($("out-task-url")?.textContent || "").trim();
    if (!txt || txt === "—") return setStatus("status-assign", "No URL yet.", "warn");
    try {
      await navigator.clipboard.writeText(txt);
      setStatus("status-assign", "Copied assigned URL.", "ok");
    } catch {
      setStatus("status-assign", "Clipboard failed. Copy manually.", "warn");
    }
  });

  $("btn-open-url")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const txt = String($("out-task-url")?.textContent || "").trim();
    if (!txt || txt === "—") return setStatus("status-assign", "No URL yet.", "warn");
    window.open(txt, "_blank", "noopener,noreferrer");
    setStatus("status-assign", "Opened assigned URL.", "ok");
  });

  // CRUD buttons
  $("btn-students-add")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    onAddStudent().catch(console.warn);
  });

  $("btn-students-edit")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    onEditStudent().catch(console.warn);
  });

  $("btn-students-remove")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    onRemoveStudent().catch(console.warn);
  });

  // Modal
  $("btn-modal-close")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    closeModal();
  });

  $("btn-modal-save")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    onSaveModal().catch((err) => {
      console.warn(err);
      setStatus("status-modal", "Save failed (unexpected).", "error");
    });
  });

  $("m-l1")?.addEventListener("change", () => {
    const v = modalGetVal("m-l1");
    const other = $("m-l1-other");
    if (other) other.disabled = (v !== "other");
  });
}

/* ------------------------------------------------------------
   Init
------------------------------------------------------------ */
async function init() {
  state.slug = getSlugContext();

  if (!state.slug) {
    setStatus("status-top", "Missing slug. Open with ?slug=... (or select school in Admin Home).", "error");
    return;
  }

  setText("pill-slug", `slug: ${state.slug}`);
  setText("pill-studentid", "student: —");
  setText("out-task-url", "—");

  $("btn-assign") && ($("btn-assign").disabled = true);
  $("btn-refresh-profile") && ($("btn-refresh-profile").disabled = true);
  $("btn-students-edit") && ($("btn-students-edit").disabled = true);
  $("btn-students-remove") && ($("btn-students-remove").disabled = true);

  wireActions();

  await loadStudentsList();

  // ✅ Prefer URL student; otherwise pick first student in list (demo-friendly)
  let sid = getStudentIdFromUrl();
  if (sid && !state.students.some(s => Number(s.id) === sid)) sid = 0;
  if (!sid && state.students.length) sid = Number(state.students[0].id);

  if (sid) await selectStudent(sid);
  else await loadTemplates();
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    console.error("[StudentProfile] init failed", err);
    setStatus("status-top", "Student Profile failed to initialize. Check console.", "error");
  });
});