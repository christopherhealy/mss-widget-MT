// /public/student-portal/StudentPortalHome.js
"use strict";

function $(id) { return document.getElementById(id); }

function setStatus(id, msg, kind) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("error", "ok");
  if (kind) el.classList.add(kind);
}

function setText(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text == null ? "—" : String(text);
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

function readLS(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// Legacy fallback only (keep, but do NOT rely on it)
function getLegacyActiveSchoolContext() {
  const candidates = ["mss_active_school_slug", "mss_school_slug", "active_school_slug", "schoolSlug"];
  let slug = "";
  for (const k of candidates) {
    const v = (readLS(k) || "").trim();
    if (v) { slug = v; break; }
  }

  const idCandidates = ["mss_active_school_id", "mss_school_id", "active_school_id", "schoolId"];
  let schoolId = "";
  for (const k of idCandidates) {
    const v = (readLS(k) || "").trim();
    if (v) { schoolId = v; break; }
  }

  return { slug, schoolId };
}

// Canonical session (AdminHome writes here)
function readSession() {
  const raw = readLS("mssSession");
  return raw ? safeJsonParse(raw) : null;
}

// Deterministic slug resolution (match AdminHome intent)
function resolveSlug() {
  const urlSlug = getQueryParam("slug");
  if (urlSlug) return urlSlug;

  const s = readSession();
  const sessionSlug = String(s?.slug || "").trim();
  if (sessionSlug) return sessionSlug;

  // last resort: legacy keys
  const legacy = getLegacyActiveSchoolContext();
  if (legacy.slug) return legacy.slug;

  return "";
}

async function loadContext() {
  const slug = resolveSlug();
  const session = readSession();

  setText("school-slug", slug || "—");

  // school id is not guaranteed in session yet; keep placeholder until you choose to store it
  // (bootstrap can supply it later if desired)
  const legacy = getLegacyActiveSchoolContext();
  setText("school-id-pill", "id: " + (legacy.schoolId || "—"));

  // Populate meta from mssSession if present
  const email = session?.email || session?.admin_email || "";
  const actorType = String(session?.actorType || "").trim();
  const role =
    actorType
      ? actorType
      : (session?.isTeacherAdmin ? "teacher_admin" : (session?.role || ""));

  setText("admin-email", email || "—");
  setText("admin-role", role || "—");
}

function buildTaskUrl(taskToken) {
  // Student-facing widget entry (task-scoped)
  // IMPORTANT: keep slug as belt+suspenders while task bootstrap is still evolving
  const slug = resolveSlug();
  const u = new URL("/widget/Widget.html", window.location.origin);
  if (slug) u.searchParams.set("slug", slug);
  u.searchParams.set("task", taskToken);
  return u.toString();
}

async function copyToClipboard(text) {
  return navigator.clipboard.writeText(text);
}

function wireUi() {
   $("btn-students")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const slug = resolveSlug();
    if (!slug) {
      setStatus("status-mvp", "Missing slug. Open Student Portal from AdminHome with ?slug=...", "error");
      return;
    }

    // MVP: temporary student selection for local QA
    const studentId =
      getQueryParam("student_id") ||
      getQueryParam("studentId") ||
      "1"; // TEMP: replace with student list later

    window.location.href =
      "/student-portal/StudentProfile.html" +
      "?slug=" + encodeURIComponent(slug) +
      "&student_id=" + encodeURIComponent(studentId);
  });

  // ✅ NEW: go to Task Builder now
  $("btn-tasks")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const slug = resolveSlug();
    if (!slug) {
      setStatus("status-mvp", "Missing slug. Open Student Portal from AdminHome with ?slug=...", "error");
      return;
    }

    window.location.href = "/student-portal/TaskBuilder.html?slug=" + encodeURIComponent(slug);
  });

  $("btn-submissions")?.addEventListener("click", (e) => {
  if (e && e.preventDefault) e.preventDefault();

  const slug = String(window.MSSClient?.state?.slug || "").trim(); // if available
  const u = new URL("/student-portal/ESLSuccess.html", window.location.origin);
  if (slug) u.searchParams.set("slug", slug);

  window.location.href = u.toString();
});

  $("btn-open-task")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const token = ($("task-token")?.value || "").trim();
    if (!token) {
      setStatus("status-task", "Enter a task_token first.", "error");
      return;
    }

    const url = buildTaskUrl(token);
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("status-task", "Opened task in a new tab.", "ok");
  });

  

  $("btn-copy-task-url")?.addEventListener("click", async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const token = ($("task-token")?.value || "").trim();
    if (!token) {
      setStatus("status-task", "Enter a task_token first.", "error");
      return;
    }

    const url = buildTaskUrl(token);
    try {
      await copyToClipboard(url);
      setStatus("status-task", "Copied task URL to clipboard.", "ok");
    } catch (err) {
      console.warn("Clipboard failed:", err);
      setStatus("status-task", "Could not copy automatically. Select and copy manually.", "error");
    }
  });

  $("btn-back-admin")?.addEventListener("click", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    window.location.href = "/admin-home/AdminHome.html";
  });
  

  // Convenience: allow ?task= to prefill token tester
  const tokenFromQuery = getQueryParam("task");
  if (tokenFromQuery && $("task-token")) {
    $("task-token").value = tokenFromQuery;
    setStatus("status-task", "Task token prefilled from URL.", "ok");
  }

  // Build stamp
  const ts = new Date().toISOString();
  setText("build-ts", ts);
}

document.addEventListener("DOMContentLoaded", async () => {
  wireUi();
  await loadContext();
});