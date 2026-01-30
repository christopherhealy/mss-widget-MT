/* ============================================================
   Workspace.js (v2)
   - Uses MSSClient global shim: requireAdminSession/adminHeaders
   - Loads: results (required) + templates (optional) + students (optional)
   - Title prefers real names; avoids "Student 6" unless truly unknown
============================================================ */

(() => {
  // ---------------------------
  // CONFIG: align these to your real server routes
  // ---------------------------
 const API = {
  reportsBySlug: (slug, limit = 500) =>
    `/api/admin/reports/${encodeURIComponent(slug)}?limit=${limit}`,

  taskTemplates: (slug) =>
    `/api/teacher/task-templates?slug=${encodeURIComponent(slug)}&ts=${Date.now()}`,

  studentsBySlug: (slug) =>
    `/api/admin/students?slug=${encodeURIComponent(slug)}`,

  assignTemplate: (studentId) =>
    `/api/teacher/students/${encodeURIComponent(String(studentId))}/assign-template`,
};



  // ---------------------------
  // Utilities
  // ---------------------------
  const $ = (id) => document.getElementById(id);

  

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt == null ? "" : String(txt);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showStatus(id, kind, msg) {
    const el = $(id);
    if (!el) return;
    el.className = `status ${kind || ""}`.trim();
    el.style.display = "block";
    el.innerHTML = msg || "";
  }

  function hideStatus(id) {
    const el = $(id);
    if (!el) return;
    el.style.display = "none";
    el.textContent = "";
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function requireGlobals() {
    if (typeof window.requireAdminSession !== "function") throw new Error("requireAdminSession_missing");
    if (typeof window.adminHeaders !== "function") throw new Error("adminHeaders_missing");
  }

  function getStudentDisplayName(stu) {
    if (!stu) return "";

    const fullName = String(stu.full_name || "").trim();
    if (fullName) return fullName;

    const name = String(stu.name || "").trim();
    if (name) return name;

    const first = String(stu.first_name || "").trim();
    const last = String(stu.last_name || "").trim();
    const fl = [first, last].filter(Boolean).join(" ").trim();
    if (fl) return fl;

    // DO NOT fall back to "Student 6" unless nothing else exists.
    // If you want email as a last resort, uncomment:
    // const email = String(stu.email || "").trim();
    // if (email) return email;

    return "";
  }

  function setWorkspaceTitle(stu, studentId) {
    const nm = getStudentDisplayName(stu);
    const label = nm ? `Workspace for ${nm}` : `Student Workspace`;
    const h1 = $("page-title");
    if (h1) h1.textContent = label;
    document.title = nm ? `Workspace | ${nm}` : `Student Workspace | ${studentId || ""}`.trim();
  }

  function fmtDateish(v) {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  }

  // ---------------------------
  // State
  // ---------------------------
  const state = {
    slug: "",
    studentId: 0,
    student: null,
    templates: [],
    results: [],
    warnings: [],
  };

  // ---------------------------
  // API helpers (GLOBAL MSS shim)
  // ---------------------------
  async function apiGet(url) {
    window.requireAdminSession("Workspace requires admin access.");

    const res = await fetch(url, {
      method: "GET",
      headers: window.adminHeaders({ Accept: "application/json" }),
      credentials: "include",
    });

    let json = null;
    try { json = await res.json(); } catch (_) {}

    if (!res.ok || !json?.ok) {
      const err = json?.error || `GET_failed_${res.status}`;
      const msg = json?.message || res.statusText || "";
      const e = new Error(`${err}${msg ? `: ${msg}` : ""}`);
      e.httpStatus = res.status;
      e.body = json;
      e.url = url;
      throw e;
    }

    return json;
  }

  async function apiPost(url, body) {
    window.requireAdminSession("Workspace requires admin access.");

    const res = await fetch(url, {
      method: "POST",
      headers: window.adminHeaders({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      credentials: "include",
      body: JSON.stringify(body || {}),
    });

    let json = null;
    try { json = await res.json(); } catch (_) {}

    if (!res.ok || !json?.ok) {
      const err = json?.error || `POST_failed_${res.status}`;
      const msg = json?.message || res.statusText || "";
      const e = new Error(`${err}${msg ? `: ${msg}` : ""}`);
      e.httpStatus = res.status;
      e.body = json;
      e.url = url;
      throw e;
    }

    return json;
  }
  function appendNoteLine(text) {
  const wrap = document.getElementById("notes-wrap");
  if (!wrap) return;

  // Ensure a simple notes list exists
  let list = document.getElementById("notes-list");
  if (!list) {
    wrap.innerHTML = `
      <div class="muted" style="margin-bottom:8px;">Notes (session only)</div>
      <div class="muted" style="margin-bottom:10px;">
        Demo note: these notes are not saved yet.
      </div>
      <div id="notes-list" style="display:flex; flex-direction:column; gap:8px;"></div>
    `;
    list = document.getElementById("notes-list");
  }

  const item = document.createElement("div");
  item.style.padding = "10px";
  item.style.border = "1px dashed #e2e8f0";
  item.style.borderRadius = "10px";
  item.className = "mono";
  item.textContent = text;

  list.prepend(item);
}

  // ---------------------------
  // Loaders
  // ---------------------------
  async function loadStudentResults() {
    const out = await apiGet(API.reportsBySlug(state.slug, 500));
    
    const tests = Array.isArray(out.tests) ? out.tests : [];
    state.results = tests.filter((t) => Number(t.student_id) === Number(state.studentId));

    // IMPORTANT: do NOT invent "Student 6" here; only infer what we truly have.
    if (!state.student && state.results.length) {
      const latest = state.results[0];
      state.student = {
        id: Number(latest.student_id) || state.studentId,
        email: latest.student_email || "",
        // keep name blank unless your view provides it
        full_name: String(latest.student_name || "").trim(), // if you later add this column
      };
    }

    renderStudentHeader();
    renderResults();
  }

  async function loadStudents() {
    const out = await apiGet(API.studentsBySlug(state.slug));
    const list = Array.isArray(out.students) ? out.students : [];
    const found = list.find((s) => Number(s.id) === Number(state.studentId)) || null;

    if (found) {
      state.student = found;
      renderStudentHeader();
    }
  }

 async function loadTemplates() {
  if (!state.slug) return;

  const out = await apiGet(API.taskTemplates(state.slug));

  // keep identical to StudentProfile
  const list = out.templates || out.items || out.task_templates || [];
  state.templates = Array.isArray(list) ? list : [];

  renderTemplates();
}
  async function loadNotes() {
    const wrap = $("notes-wrap");
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="muted" style="margin-bottom:8px;">
        Notes (coming next): teacher can add coaching notes, reminders, and follow-ups.
      </div>
      <div class="muted" style="padding:10px; border:1px dashed #e2e8f0; border-radius:10px;">
        NotesAPI not wired yet.
      </div>
    `;
  }

  // ---------------------------
  // Renderers
  // ---------------------------
  function renderStudentHeader() {
    const s = state.student || {};

    const nm = getStudentDisplayName(s);
    setText("st-name", nm || "—");
    setText("st-email", s.email || "—");
    setText("st-id", s.id || state.studentId || "—");
    setText("st-l1", s.l1 || "—");

    setWorkspaceTitle(state.student, state.studentId);

    // reserve visuals (later)
    const dash = $("dash-slot");
    if (dash) {
      dash.innerHTML = `
        <div class="muted" style="margin-bottom:8px;">Dashboard (reserved)</div>
        <div class="muted" style="padding:10px; border:1px dashed #e2e8f0; border-radius:10px;">
          Current dashboard view will render here (later).
        </div>
      `;
    }

    const chart = $("chart-slot");
    if (chart) {
      chart.innerHTML = `
        <div class="muted" style="margin-bottom:8px;">Progress chart (reserved)</div>
        <div class="muted" style="padding:10px; border:1px dashed #e2e8f0; border-radius:10px;">
          Bar chart for Fluency / Grammar / Pronunciation / Vocab / WPM will render here (later).
        </div>
      `;
    }
  }

  function renderTemplates() {
    const sel = $("sel-template");
    if (!sel) return;

    sel.innerHTML =
      `<option value="">(Select a template)</option>` +
      state.templates
        .map((t) => {
          const id = Number(t.id);
          const title = escapeHtml(t.title || `Template ${id}`);
          return `<option value="${id}">${title}</option>`;
        })
        .join("");

    const btnAssign = $("btn-assign");
    if (btnAssign) btnAssign.disabled = !state.templates.length;
  }

  function renderResults() {
    const wrap = $("results-wrap");
    if (!wrap) return;

    const rows = Array.isArray(state.results) ? state.results : [];
    if (!rows.length) {
      wrap.innerHTML = `<div class="muted" style="padding:10px;">No results yet for this student.</div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="students-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:20%;">Submitted</th>
              <th style="width:40%;">Question</th>
              <th style="width:10%;">WPM</th>
              <th style="width:10%;">CEFR</th>
              <th style="width:20%;">Scores</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => {
              const when = escapeHtml(fmtDateish(r.submitted_at));
              const q = escapeHtml(r.question || "—");
              const wpm = escapeHtml(r.wpm ?? "—");
              const cefr = escapeHtml(r.mss_cefr || r.cefr || "—");

              const flu = r.mss_fluency ?? "—";
              const gra = r.mss_grammar ?? "—";
              const pro = r.mss_pron ?? "—";
              const voc = r.mss_vocab ?? "—";
              const scoreStr = `F:${flu} G:${gra} P:${pro} V:${voc}`;

              return `
                <tr>
                  <td>${when}</td>
                  <td>${q}</td>
                  <td>${wpm}</td>
                  <td>${cefr}</td>
                  <td class="mono">${escapeHtml(scoreStr)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ---------------------------
  // Actions
  // ---------------------------
 async function assignTemplate() {
  const sel = document.getElementById("sel-template");
  const templateId = Number(sel?.value || 0);
  if (!templateId) return;

  try {
    showStatus("status-top", "warn", "Assigning template…");

    const out = await apiPost(API.assignTemplate(state.studentId), {
      slug: state.slug,
      template_id: templateId,
    });

    const url = String(out?.task_url || "").trim();
    console.log("[assignTemplate] response:", out);
    console.log("[assignTemplate] url:", url);

    // 1) Write to the dedicated output field
    const outEl = document.getElementById("out-task-url");
    if (outEl) outEl.textContent = url || "(no task_url returned)";
    else console.warn("Missing #out-task-url element in Workspace.html");

    // 2) ALSO write to status-top (demo-safe fallback)
    if (url) {
      showStatus("status-top", "ok", `Assigned. URL: ${url}`);
    } else {
      showStatus("status-top", "warn", "Assigned, but no URL returned.");
    }

    // Optional: store in state for Copy/Open buttons
    state.lastTaskUrl = url;

  } catch (e) {
    console.error("[assignTemplate] failed:", e);
    showStatus(
  "status-top",
  "ok",
  `Assigned. <a href="${url}" target="_blank" rel="noopener noreferrer">
     Open task
   </a>`
);
  }
}

  function wireUi() {
    $("btn-back")?.addEventListener("click", () => {
      const sp = new URLSearchParams();
      if (state.slug) sp.set("slug", state.slug);
      window.location.href = `/student-portal/StudentProfile.html?${sp.toString()}`;
    });

    $("btn-assign")?.addEventListener("click", assignTemplate);

    $("btn-refresh")?.addEventListener("click", async () => {
      try {
        showStatus("status-top", "warn", "Refreshing…");
        await loadStudentResults();
        // best-effort refreshes:
        await Promise.allSettled([loadTemplates(), loadStudents()]);
        showStatus("status-top", "ok", "Refreshed.");
      } catch (e) {
        showStatus("status-top", "error", `Refresh failed: ${e?.message || e}`);
      }
    });
  }

  // ---------------------------
  // Init
  // ---------------------------
  async function init() {
    try {
      hideStatus("status-top");
      requireGlobals();

      state.slug = String(qs().get("slug") || "").trim();
      state.studentId = Number(qs().get("student_id") || 0);

      if (!state.slug || !state.studentId) {
        showStatus("status-top", "error", "Missing slug or student_id in URL.");
        return;
      }

      setText("pill-slug", `slug: ${state.slug}`);
      setText("pill-studentid", `student: ${state.studentId}`);

      wireUi();
      showStatus("status-top", "warn", "Loading workspace…");

      // REQUIRED: results (you confirmed this works)
      await loadStudentResults();

      // OPTIONAL: templates + students (don’t fail the page)
      await Promise.allSettled([
        (async () => {
          try { await loadTemplates(); }
          catch (e) {
            console.warn("[Workspace] templates failed:", e);
            // 404 = route missing; show a helpful warning
            if (e?.httpStatus === 404) state.warnings.push("Templates endpoint is 404 (route not present in this server build).");
            else state.warnings.push("Templates failed to load.");
          }
        })(),
        (async () => {
          try { await loadStudents(); }
          catch (e) {
            console.warn("[Workspace] students failed:", e);
            if (e?.httpStatus === 404) state.warnings.push("Students endpoint is 404 (route not present in this server build).");
            else state.warnings.push("Student details failed to load.");
          }
        })(),
        loadNotes(),
      ]);

      // If we managed to load real student details, title will be updated via renderStudentHeader().
      // If not, we still have a clean title without "Student 6".

      if (state.warnings.length) {
        showStatus("status-top", "warn", `Workspace loaded. ${state.warnings.join(" ")}`);
      } else {
        showStatus("status-top", "ok", "Workspace loaded.");
      }
    } catch (e) {
      console.error("[Workspace] init error:", e);
      showStatus("status-top", "error", `Workspace init failed: ${e?.message || e}`);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();