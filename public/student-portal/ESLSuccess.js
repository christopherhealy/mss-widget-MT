// /public/student-portal/ESLSuccess.js
// v0.1 (MVP) — wire ESLSuccess.html to /api/teacher/eslsuccess/overview
console.log("✅ ESLSuccess.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // -----------------------------
  // MSSClient boot
  // -----------------------------
  if (!window.MSSClient) {
    console.error("[ESLSuccess] MSSClient not loaded");
    window.location.href = "/admin-login/AdminLogin.html?reason=mssclient_missing";
    return;
  }

  const boot = window.MSSClient.bootGuard({
    allow: ["teacher", "admin", "teacher_admin", "superadmin"],
    requireSlug: true,
    requireToken: false,
  });

  const apiFetch = boot.apiFetch;
  const slug = String(boot.slug || "").trim();
  const session = boot.session || {};

  // -----------------------------
  // state
  // -----------------------------
  const state = {
    slug,
    schoolId: session.schoolId || null,
    students: [],
    recent: [],
    selectedStudentId: null,
  };

  // -----------------------------
  // helpers
  // -----------------------------
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toISOString().slice(0, 10);
  }

  function timeAgo(d) {
    if (!d) return "—";
    const t = new Date(d).getTime();
    if (!Number.isFinite(t)) return "—";
    const diff = Date.now() - t;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days <= 0) return "Today";
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }

  async function apiJson(url, opts) {
    const res = await apiFetch(url, { ...(opts || {}), ensureSlug: true });
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

  function setText(id, v) {
    const el = $(id);
    if (!el) return;
    el.textContent = v == null || v === "" ? "—" : String(v);
  }

  // -----------------------------
  // rendering
  // -----------------------------
  function computeKpis() {
    const activeStudents = state.students.length;
    const tasksCompleted = state.recent.length; // recent feed count (not perfect, ok for MVP)
    const needsAttention = state.students.filter((s) => !s.last_submission_at).length;

    // Avg TOEFL from student rollups (avg_toefl per student)
    const toefls = state.students
      .map((s) => Number(s.avg_toefl))
      .filter((n) => Number.isFinite(n) && n > 0);

    const avgToefl = toefls.length ? (toefls.reduce((a, b) => a + b, 0) / toefls.length) : null;

    setText("kpi-students", activeStudents || 0);
    // keep your CEFR KPI aspirational for now; show avg TOEFL as proxy
    setText("kpi-cefr", avgToefl ? `~${avgToefl.toFixed(1)} TOEFL` : "—");
    setText("kpi-tasks", tasksCompleted || 0);
    setText("kpi-attn", needsAttention || 0);
  }

  function renderStudents() {
    const table = $("students-table");
    if (!table) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    if (!state.students.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No students found for this teacher (via student_tasks).</td></tr>`;
      return;
    }

    const rowsHtml = state.students.map((s) => {
      const id = Number(s.id);
      const name = [s.first_name, s.last_name].filter(Boolean).join(" ") || s.email || `Student ${id}`;
      const last = s.last_submission_at ? timeAgo(s.last_submission_at) : "—";
      const avgToefl = s.avg_toefl ? Number(s.avg_toefl).toFixed(1) : "—";
      const cefr = s.avg_cefr || "—";

      // crude “signal”
      const signal = s.last_submission_at ? "✓ Active" : "⚠ No submissions";
      const signalClass = s.last_submission_at ? "attention ok" : "attention";

      return `
        <tr data-student-id="${id}" style="cursor:pointer;">
          <td>
            <div class="name">${esc(name)}</div>
            <div class="tiny">${esc(s.email || "")}</div>
          </td>
          <td><span class="badge"><strong>${esc(cefr)}</strong></span></td>
          <td class="trend flat">—</td>
          <td>
            <div class="tiny">${esc(last)}</div>
            <div class="muted">${s.last_submission_at ? esc(fmtDate(s.last_submission_at)) : ""}</div>
          </td>
          <td><span class="badge"><strong>${esc(avgToefl)}</strong> <span class="muted">TOEFL est.</span></span></td>
          <td><span class="${signalClass}">${esc(signal)}</span></td>
        </tr>
      `;
    }).join("");

    tbody.innerHTML = rowsHtml;

    tbody.querySelectorAll("tr[data-student-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const sid = Number(tr.getAttribute("data-student-id") || 0);
        if (!sid) return;
        state.selectedStudentId = sid;
        renderStudentFocus();
      });
    });
  }

  function renderStudentFocus() {
    const sid = state.selectedStudentId;

    // pick first student by default
    if (!sid && state.students.length) state.selectedStudentId = Number(state.students[0].id);

    const student = state.students.find((s) => Number(s.id) === Number(state.selectedStudentId));
    if (!student) return;

    const name = [student.first_name, student.last_name].filter(Boolean).join(" ") || student.email || `Student ${student.id}`;
    const last = student.last_submission_at ? timeAgo(student.last_submission_at) : "—";
    const avgToefl = student.avg_toefl ? Number(student.avg_toefl).toFixed(1) : "—";

    setText("focus-name", name);
    setText("focus-last", last);
    setText("focus-cefr", student.avg_cefr || "—");

    // lightweight derived chips (placeholder-ish)
    setText("focus-time", "—");  // needs durations
    setText("focus-tasks", "—"); // needs active task counting

    // Evidence table: filter recent feed by student_id
    const evidenceTable = $("evidence-table");
    const tbody = evidenceTable ? evidenceTable.querySelector("tbody") : null;
    if (tbody) {
      const items = state.recent
        .filter((r) => Number(r.student_id) === Number(student.id))
        .slice(0, 12);

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted">No submissions yet for this student.</td></tr>`;
      } else {
        tbody.innerHTML = items.map((r) => {
          const taskTitle = r.task_title || `task_id ${r.task_id || "—"}`;
          const score = r.toefl_estimate ? Number(r.toefl_estimate) : null;
          const cefr = r.cefr_level || "—";

          return `
            <tr>
              <td>
                <div class="name">${esc(taskTitle)}</div>
                <div class="tiny">task_id: ${esc(r.task_id ?? "—")}</div>
              </td>
              <td class="muted">—</td>
              <td class="muted">${esc(fmtDate(r.created_at))}</td>
              <td><span class="badge"><strong>${score != null ? esc(score) : "—"}</strong> <span class="muted">${esc(cefr)}</span></span></td>
            </tr>
          `;
        }).join("");
      }
    }

    // quick KPI in right panel could reflect avg TOEFL
    const statusRight = $("status-right");
    if (statusRight) statusRight.textContent = `Loaded real data · Avg TOEFL: ${avgToefl}`;
  }

  // -----------------------------
  // load
  // -----------------------------
  async function loadOverview() {
    const url = `/api/teacher/eslsuccess/overview?slug=${encodeURIComponent(state.slug)}&ts=${Date.now()}`;
    const d = await apiJson(url, { method: "GET" });

    state.schoolId = d.schoolId || state.schoolId;
    state.students = Array.isArray(d.students) ? d.students : [];
    state.recent = Array.isArray(d.recentSubmissions) ? d.recentSubmissions : [];

    computeKpis();
    renderStudents();
    renderStudentFocus();
  }

  function wireButtons() {
    $("btn-refresh")?.addEventListener("click", (e) => {
      e.preventDefault();
      loadOverview().catch((err) => console.error("refresh failed", err));
    });

    $("btn-back")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = `/student-portal/StudentPortalHome.html?slug=${encodeURIComponent(state.slug)}`;
    });

    $("btn-taskbuilder")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = `/student-portal/TaskBuilder.html?slug=${encodeURIComponent(state.slug)}`;
    });

    // Optional: hook these if present
    $("btn-open-submissions")?.addEventListener("click", (e) => {
      e.preventDefault();
      // for now: stay here (this is submissions workspace)
    });
  }

  async function init() {
    // header pills
    setText("who-email", session.email || "—");
    setText("pill-slug", state.slug || "—");
    setText("pill-schoolid", state.schoolId || "—");
    setText("build-ts", new Date().toISOString().slice(0, 19).replace("T", " "));

    wireButtons();

    try {
      await loadOverview();
    } catch (err) {
      console.error("[ESLSuccess] loadOverview failed", err);
      const statusRight = $("status-right");
      if (statusRight) statusRight.textContent = `Load failed: ${err.message || "error"}`;
      // also blank the placeholder tables so it's obvious:
      const st = $("students-table")?.querySelector("tbody");
      if (st) st.innerHTML = `<tr><td colspan="6" class="muted">Load failed: ${esc(err.message || "error")}</td></tr>`;
      const ev = $("evidence-table")?.querySelector("tbody");
      if (ev) ev.innerHTML = `<tr><td colspan="4" class="muted">Load failed.</td></tr>`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();