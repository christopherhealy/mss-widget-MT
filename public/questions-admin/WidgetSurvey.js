// /questions-admin/WidgetSurvey.js – with admin session guard
(function () {
  "use strict";

// --------------------------------------------------------------
// Dec 1 — Support selected widget variant from SchoolPortal
// --------------------------------------------------------------

// Parse ?widget=WidgetMin.html or Widget.html or WidgetMax.html
function getWidgetVariantFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const widget = params.get("widget");

  if (!widget) return "Widget.html"; // default

  // Hardening: strip path, accept only known files
  const safe = widget.replace(/[^A-Za-z0-9._-]/g, "").trim();
  if (!safe) return "Widget.html";

  // Allow only known variants
  const allowed = [
    "Widget.html",
    "WidgetMin.html",
    "WidgetMax.html",
    "WidgetReadmax.html"
  ];

  return allowed.includes(safe) ? safe : "Widget.html";
}

const WIDGET_VARIANT = getWidgetVariantFromUrl();
console.log("🔎 WidgetSurvey: widget variant =", WIDGET_VARIANT);

  /* ----------------------------------------------------
     SECURITY HELPERS
  ---------------------------------------------------- */

  function requireSessionOrRedirect() {
    if (!window.MSSAdminSession) {
      console.warn("MSSAdminSession missing – redirecting to admin login.");
      window.location.href = "/admin-login/AdminLogin.html";
      return null;
    }

    const session = window.MSSAdminSession.getSession();
    if (!session || !session.adminId) {
      console.warn("No valid admin session – redirecting to login.");

      const returnTo = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.location.href = `/admin-login/AdminLogin.html?returnTo=${returnTo}`;
      return null;
    }

    return session;
  }

  function attachCrossTabLogoutWatcher() {
    window.addEventListener("storage", (event) => {
      if (event.key === "MSS_ADMIN_SESSION" && !event.newValue) {
        // Session was cleared in another tab
        alert("Your admin session has ended. Please sign in again.");
        window.location.href = "/admin-login/AdminLogin.html";
      }
    });
  }

  /* ----------------------------------------------------
     PAGE INITIAL SETUP
  ---------------------------------------------------- */

  const params = new URLSearchParams(window.location.search);
  let assessmentId = params.get("assessmentId");
  const slug = params.get("slug");

  const assessmentInfoEl = document.getElementById("assessmentInfo");
  const tableBody = document.querySelector("#questionsTable tbody");
  const addQuestionBtn = document.getElementById("addQuestionBtn");
  const saveBtn = document.getElementById("saveBtn");
  const loadingText = document.getElementById("loadingText");
  const statusEl = document.getElementById("status");

  // tracks whether we successfully loaded from server
  let questionsLoadedOk = false;

  // 🔒 Require a valid admin session before doing anything
  const SESSION = requireSessionOrRedirect();
  if (!SESSION) {
    // We’re being redirected to login, so don’t wire up the page.
    return;
  }

  // 🔒 Listen for logout in another tab
  attachCrossTabLogoutWatcher();

  /* ----------------------------------------------------
     HELPERS
  ---------------------------------------------------- */

  function setLoading(isLoading) {
    loadingText.style.display = isLoading ? "inline" : "none";
    saveBtn.disabled = isLoading;
    addQuestionBtn.disabled = isLoading;
  }

  function setStatus(msg, type = "") {
    statusEl.textContent = msg || "";
    statusEl.className = `status ${type}`;
  }

  // Create a table row for a single question
  // question = { id, position, question, is_active, ... }
  function createRow(question = {}) {
    const tr = document.createElement("tr");

    // keep the DB id (if any) on the row so the API can distinguish new vs existing
    if (question.id != null) {
      tr.dataset.id = String(question.id);
    }

    // POSITION
    const tdOrder = document.createElement("td");
    const orderInput = document.createElement("input");
    orderInput.type = "text";
    orderInput.value =
      question.position != null && question.position !== ""
        ? question.position
        : "";
    orderInput.placeholder = "#";
    tdOrder.appendChild(orderInput);
    tr.appendChild(tdOrder);

    // QUESTION TEXT
    const tdQuestion = document.createElement("td");
    const questionInput = document.createElement("textarea");
    questionInput.rows = 2;
    questionInput.value = question.question ?? "";
    tdQuestion.appendChild(questionInput);
    tr.appendChild(tdQuestion);

    // IS ACTIVE
    const tdActive = document.createElement("td");
    const activeInput = document.createElement("input");
    activeInput.type = "checkbox";
    activeInput.checked = question.is_active !== false; // default true if undefined
    tdActive.style.textAlign = "center";
    tdActive.appendChild(activeInput);
    tr.appendChild(tdActive);

    // DELETE BUTTON
    const tdDelete = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.textContent = "X";
    delBtn.addEventListener("click", () => {
      tr.remove();
    });
    tdDelete.appendChild(delBtn);
    tr.appendChild(tdDelete);

    tableBody.appendChild(tr);
  }

  // Read all questions from the table into an array
  function getQuestionsFromTable() {
    const rows = Array.from(tableBody.querySelectorAll("tr"));

    return rows
      .map((tr, index) => {
        const [orderTd, questionTd, activeTd] = tr.children;

        const orderInput = orderTd.querySelector("input");
        const questionInput = questionTd.querySelector("textarea");
        const activeInput = activeTd.querySelector('input[type="checkbox"]');

        const pos = parseInt(orderInput.value, 10);
        const position = Number.isFinite(pos) ? pos : index + 1;

        const payload = {
          position,
          question: (questionInput.value || "").trim(),
          is_active: !!activeInput.checked,
        };

        // carry id if this row represents an existing DB record
        if (tr.dataset.id) {
          payload.id = Number(tr.dataset.id);
        }

        return payload;
      })
      .filter((q) => q.question !== "");
  }

  // Resolve assessmentId:
  //  - if assessmentId is in querystring, use it
  //  - else if slug is present, call /api/admin/assessments/:slug
  async function resolveAssessmentId() {
    if (assessmentId) return assessmentId;

    if (!slug) return null;

    try {
      const res = await fetch(
        `/api/admin/assessments/${encodeURIComponent(slug)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "error resolving assessment");

      assessmentId = String(data.assessmentId);
      // Update info line with details
      assessmentInfoEl.textContent = `Editing questions for school "${slug}", assessment #${assessmentId} (${data.assessment?.name || "Unnamed"})`;
      return assessmentId;
    } catch (err) {
      console.error("Failed to resolve assessmentId", err);
      setStatus(
        "Failed to resolve assessment for this slug. See console.",
        "err"
      );
      return null;
    }
  }

  // Load questions from the API
  async function loadQuestions() {
    setLoading(true);
    setStatus("");
    tableBody.innerHTML = "";
    questionsLoadedOk = false;

    const resolvedId = await resolveAssessmentId();
    if (!resolvedId) {
      setLoading(false);
      return;
    }

    console.log("Loading questions for assessment", resolvedId);

    try {
      const res = await fetch(
        `/api/assessments/${encodeURIComponent(resolvedId)}/questions`
      );
      console.log("GET /questions status:", res.status);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("Questions payload:", data);

      const questions = data.questions || [];
      if (!questions.length) {
        console.warn("No questions returned from server.");
        createRow(); // start with one blank row
      } else {
        questions.forEach((q) => createRow(q));
      }

      questionsLoadedOk = true;
      setStatus(`Loaded ${questions.length} question(s).`, "ok");
    } catch (err) {
      console.error("Failed to load questions", err);
      setStatus("Failed to load questions from server.", "err");
      createRow(); // still give user something to edit
    } finally {
      setLoading(false);
    }
  }

  // Save questions back to the API
  async function saveQuestions() {
    const resolvedId = await resolveAssessmentId();
    if (!resolvedId) return;

    if (!questionsLoadedOk) {
      setStatus(
        "Refusing to save: questions did not load correctly from the server.",
        "err"
      );
      console.warn(
        "Save aborted because questionsLoadedOk is false. Fix loadQuestions()/API before saving."
      );
      return;
    }

    const questions = getQuestionsFromTable();
    console.log("Saving questions payload:", JSON.stringify(questions, null, 2));

    if (!questions.length) {
      setStatus("Nothing to save – at least one question is required.", "err");
      return;
    }

    setLoading(true);
    setStatus("Saving…");

    try {
      const res = await fetch(
        `/api/assessments/${encodeURIComponent(resolvedId)}/questions`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ questions }),
        }
      );

      console.log("PUT /questions status:", res.status);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Unknown error");

      setStatus("Questions saved to Postgres ✔", "ok");
      await loadQuestions(); // reload to normalize ordering
    } catch (err) {
      console.error("Failed to save questions", err);
      setStatus("Failed to save questions – see console.", "err");
    } finally {
      setLoading(false);
    }
  }

  /* ----------------------------------------------------
     INIT
  ---------------------------------------------------- */

  async function init() {
    if (!assessmentId && !slug) {
      assessmentInfoEl.textContent =
        "❌ Missing assessmentId or slug in URL (?assessmentId=1 or ?slug=mss-demo).";
      saveBtn.disabled = true;
      addQuestionBtn.disabled = true;
      return;
    }

    if (assessmentId) {
      assessmentInfoEl.textContent =
  `Editing questions for school "${slug}", widget: ${WIDGET_VARIANT}, assessment #${assessmentId} (${data.assessment?.name || "Unnamed"})`;
    } else if (slug) {
      assessmentInfoEl.textContent = `Resolving assessment for school "${slug}"…`;
    }

    await loadQuestions();
  }

  addQuestionBtn.addEventListener("click", () => {
    createRow();
  });

  saveBtn.addEventListener("click", () => {
    saveQuestions();
  });

  updatePreviewWidget();

  init();
})();

// Optional preview iframe support
function updatePreviewWidget() {
  const iframe = document.getElementById("widgetPreviewFrame");
  if (!iframe) return;

  const slug = (slug || "").trim();
  if (!slug) {
    iframe.src = "about:blank";
    return;
  }

  iframe.src = `/widgets/${WIDGET_VARIANT}?slug=${encodeURIComponent(slug)}`;
  console.log("🔎 WidgetSurvey preview →", iframe.src);
}