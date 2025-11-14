// HelpAdmin.js – MSS Widget MT – 2025-11-14 09:30 EST

/* ---------- slug + base URLs ---------- */

const urlParams = new URLSearchParams(window.location.search);
const urlSlug = urlParams.get("slug");
const rawSlug = urlSlug || window.mssWidgetSlug || "mss-demo";
const SLUG = rawSlug.trim();

let ADMIN_BASE;
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  ADMIN_BASE = "http://localhost:3000";
} else if (location.hostname.endsWith("vercel.app")) {
  ADMIN_BASE = "https://mss-widget-mt.onrender.com";
} else {
  ADMIN_BASE = window.location.origin;
}

const QUESTIONS_URL =
  ADMIN_BASE + "/api/admin/questions/" + encodeURIComponent(SLUG);
const HELP_BASE_URL =
  ADMIN_BASE + "/api/admin/help/" + encodeURIComponent(SLUG);

/* ---------- state ---------- */

const state = {
  schoolId: null,
  questions: [],
  currentQuestionId: null,
  help: {
    prompt: "",
    maxhelp: "",
    minhelp: "",
  },
  dirty: false,
};

/* ---------- DOM helpers ---------- */

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, ok = true) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "" : "#b91c1c";
}

function updateMeta() {
  const slugDisplay = $("slugDisplay");
  const meta = $("meta");
  if (slugDisplay) slugDisplay.textContent = "slug=" + SLUG;
  if (!meta) return;

  const q =
    state.currentQuestionId != null
      ? `QID ${state.currentQuestionId}`
      : "no question selected";

  const dirtyFlag = state.dirty ? " • unsaved changes" : "";
  const ts = new Date().toLocaleString();

  meta.textContent = `Source: Postgres • ${q} • ${ts}${dirtyFlag}`;
}

/* ---------- load questions ---------- */

async function loadQuestions() {
  setStatus("Loading questions…");
  try {
    const r = await fetch(QUESTIONS_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);

    const body = await r.json();
    if (!body.ok) throw new Error(body.error || "unknown_error");

    state.schoolId = body.schoolId;
    state.questions = body.questions || [];

    populateQuestionSelect();
    setStatus("Questions loaded.");
  } catch (err) {
    console.error("[HelpAdmin] loadQuestions error:", err);
    setStatus("Failed to load questions: " + err.message, false);
  }
}

function populateQuestionSelect() {
  const select = $("questionSelect");
  if (!select) return;

  select.innerHTML = "";

  if (!state.questions.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No questions found for this school.";
    select.appendChild(opt);
    return;
  }

  state.questions.forEach((q, index) => {
    const opt = document.createElement("option");
    opt.value = String(q.id);
    const label =
      q.text && q.text.length > 140
        ? q.text.slice(0, 137) + "…"
        : q.text || `Question ${index + 1}`;
    opt.textContent = `${index + 1}. ${label}`;
    select.appendChild(opt);
  });

  // auto-select first question
  const firstId = state.questions[0].id;
  select.value = String(firstId);
  onQuestionChange();
}

/* ---------- load help for one question ---------- */

async function loadHelp(questionId) {
  const qid = Number(questionId);
  if (!Number.isInteger(qid) || qid <= 0) return;

  setStatus("Loading help…");
  try {
    const url = `${HELP_BASE_URL}/${qid}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const body = await r.json();
    if (!body.ok) throw new Error(body.error || "unknown_error");

    state.currentQuestionId = qid;
    state.help = {
      prompt: body.prompt || "",
      maxhelp: body.maxhelp || "",
      minhelp: body.minhelp || "",
    };
    state.dirty = false;

    populateHelpFields();
    updateMeta();
    setStatus(body.exists ? "Help loaded from server." : "No help yet – start by using the prompt.");
  } catch (err) {
    console.error("[HelpAdmin] loadHelp error:", err);
    setStatus("Failed to load help: " + err.message, false);
  }
}

function populateHelpFields() {
  const { prompt, maxhelp, minhelp } = state.help;
  if ($("qhPrompt")) $("qhPrompt").value = prompt;
  if ($("qhMaxHelp")) $("qhMaxHelp").value = maxhelp;
  if ($("qhMinHelp")) $("qhMinHelp").value = minhelp;
}

/* ---------- save help ---------- */

async function saveHelp() {
  if (!state.currentQuestionId) {
    setStatus("Select a question first.", false);
    return;
  }

  const prompt = $("qhPrompt") ? $("qhPrompt").value : "";
  const maxhelp = $("qhMaxHelp") ? $("qhMaxHelp").value : "";
  const minhelp = $("qhMinHelp") ? $("qhMinHelp").value : "";

  const payload = { prompt, maxhelp, minhelp };

  setStatus("Saving help…");
  try {
    const url = `${HELP_BASE_URL}/${state.currentQuestionId}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        // X-ADMIN-KEY is checked server-side via ADMIN_WRITE_KEY env var.
        // If you set that env var, add the header here as needed.
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("HTTP " + res.status);
    const body = await res.json();
    if (!body.ok) throw new Error(body.error || "unknown_error");

    state.help = {
      prompt,
      maxhelp,
      minhelp,
    };
    state.dirty = false;
    updateMeta();
    setStatus("Help saved to server (Postgres).");
  } catch (err) {
    console.error("[HelpAdmin] saveHelp error:", err);
    setStatus("Failed to save help: " + err.message, false);
  }
}

/* ---------- handlers & wiring ---------- */

function markDirty() {
  state.dirty = true;
  updateMeta();
}

function onQuestionChange() {
  const select = $("questionSelect");
  if (!select) return;
  const id = select.value;
  if (!id) {
    state.currentQuestionId = null;
    state.help = { prompt: "", maxhelp: "", minhelp: "" };
    populateHelpFields();
    updateMeta();
    return;
  }
  loadHelp(id);
}

function wireEvents() {
  const select = $("questionSelect");
  if (select) {
    select.addEventListener("change", onQuestionChange);
  }

  const fields = ["qhPrompt", "qhMaxHelp", "qhMinHelp"];
  fields.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", markDirty);
  });

  const saveBtn = $("saveBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      saveHelp();
    });
  }

  const reloadBtn = $("reloadBtn");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", () => {
      onQuestionChange();
    });
  }
}

/* ---------- init ---------- */

function init() {
  updateMeta();
  wireEvents();
  loadQuestions();
}

window.addEventListener("DOMContentLoaded", init);
