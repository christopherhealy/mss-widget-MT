// /public/admin-prompt/AIPromptManager.js
// v0.3 — Modal viewer + modal editor + MSS modal (no browser alerts) + Suggest preamble builder
console.log("✅ AIPromptManager.js loaded");

(function () {
  "use strict";

  const LS_TOKEN_KEY = "mss_admin_token";
  const LOGIN_URL = "/admin-login/AdminLogin.html";
  const $ = (id) => document.getElementById(id);

  const els = {
    meta: $("meta"),
    status: $("status"),
    list: $("list"),
    btnAdd: $("btnAdd"),

    // Top close buttons
    btnClose: $("btnClose"),
    btnCloseX: $("btnCloseX"),

    // Viewer modal
    viewerOverlay: $("viewerOverlay"),
    viewerTitle: $("viewerTitle"),
    viewerMeta: $("viewerMeta"),
    viewerText: $("viewerText"),
    viewerClose: $("viewerClose"),
    viewerClose2: $("viewerClose2"),
    viewerEdit: $("viewerEdit"),

    // Editor modal
    editOverlay: $("editOverlay"),
    editTitle: $("editTitle"),
    editMeta: $("editMeta"),
    editClose: $("editClose"),
    btnCancel: $("btnCancel"),
    btnSave: $("btnSave"),
    btnSuggest: $("btnSuggest"),
    promptName: $("promptName"),
    promptText: $("promptText"),
    helperLanguage: $("helperLanguage"),
    suggestNotes: $("suggestNotes"),
    editError: $("editError"),

    // Checklists
    mssChecklist: $("mssChecklist"),
    optChecklist: $("optChecklist"),
    varChecklist: $("varChecklist"),

    // MSS modal (alerts/validation)
    mssModalOverlay: $("mssModalOverlay"),
    mssModalTitle: $("mssModalTitle"),
    mssModalBody: $("mssModalBody"),
    mssModalCloseX: $("mssModalCloseX"),
    mssModalOk: $("mssModalOk"),
  };

  // ---------------------------
  // In-memory state
  // ---------------------------
  let currentSlug = "";
  let promptsCache = [];
  let viewerPromptId = null;
  let editPromptId = null; // null = add, number = edit

  // ---------------------------
  // Variables + Suggest metric lists
  // ---------------------------
  const VARS = [
    { key: "question", label: "Question" },
    { key: "transcript", label: "Transcript" },
    { key: "student", label: "Student" },
    { key: "wpm", label: "WPM" },
    { key: "mss_toefl", label: "MSS TOEFL" },
    { key: "mss_cefr", label: "MSS CEFR" },
    { key: "mss_fluency", label: "Fluency" },
    { key: "mss_pron", label: "Pronunciation" },
    { key: "mss_grammar", label: "Grammar" },
    { key: "mss_vocab", label: "Vocabulary" },
  ];

  const MSS_METRICS = [
    { key: "mss_fluency", label: "Fluency" },
    { key: "mss_pron", label: "Pronunciation" },
    { key: "mss_grammar", label: "Grammar" },
    { key: "mss_vocab", label: "Vocabulary" },
    { key: "mss_cefr", label: "MSS CEFR" },
    { key: "mss_toefl", label: "MSS TOEFL" },
  ];

  const OPT_METRICS = [
    { key: "wpm", label: "WPM" },
  ];

//helpers for saving choices made

const METRICS_BLOCK_START = "[[MSS_SELECTED_METRICS]]";
const METRICS_BLOCK_END   = "[[/MSS_SELECTED_METRICS]]";

function placeholderFor(key) {
  return `{{${key}}}`;
}

function getSelectedMetricsFromUI() {
  const mss = Array.from(document.querySelectorAll("input.mssMetric:checked")).map(x => x.value);
  const opt = Array.from(document.querySelectorAll("input.optMetric:checked")).map(x => x.value);
  return { mss, opt };
}

function buildMetricsBlockLines(keys) {
  if (!keys.length) return "";
  const lines = keys.map(k => `- ${placeholderFor(k)}`);
  return `${METRICS_BLOCK_START}\n${lines.join("\n")}\n${METRICS_BLOCK_END}`;
}

function upsertMetricsBlock(promptText, keys) {
  const text = String(promptText || "");
  const block = buildMetricsBlockLines(keys);

  const hasStart = text.includes(METRICS_BLOCK_START);
  const hasEnd = text.includes(METRICS_BLOCK_END);

  // If no keys selected, remove the block if it exists
  if (!keys.length) {
    if (!hasStart || !hasEnd) return text;
    return text.replace(
      new RegExp(`${escapeRegExp(METRICS_BLOCK_START)}[\\s\\S]*?${escapeRegExp(METRICS_BLOCK_END)}\\n?`, "g"),
      ""
    ).trim() + "\n";
  }

  // Replace existing block
  if (hasStart && hasEnd) {
    return text.replace(
      new RegExp(`${escapeRegExp(METRICS_BLOCK_START)}[\\s\\S]*?${escapeRegExp(METRICS_BLOCK_END)}`, "g"),
      block
    );
  }

  // Append block at end (with spacing)
  const sep = text.trim() ? "\n\n" : "";
  return text.trim() + sep + block + "\n";
}

function parseMetricsFromPromptText(promptText) {
  const text = String(promptText || "");

  // 1) Prefer explicit block
  const re = new RegExp(
    `${escapeRegExp(METRICS_BLOCK_START)}([\\s\\S]*?)${escapeRegExp(METRICS_BLOCK_END)}`,
    "m"
  );
  const m = text.match(re);
  if (m && m[1]) {
    const inside = m[1];
    const keys = [];
    const pRe = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
    let mm;
    while ((mm = pRe.exec(inside)) !== null) keys.push(mm[1]);
    return Array.from(new Set(keys));
  }

  // 2) Fallback: scan whole prompt for placeholders
  const keys = [];
  const pRe = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
  let mm;
  while ((mm = pRe.exec(text)) !== null) keys.push(mm[1]);
  return Array.from(new Set(keys));
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
  // ---------------------------
  // UI helpers
  // ---------------------------
  function setStatus(msg = "", isError = false) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.classList.toggle("error", !!isError);
  }

  function showEditError(msg = "") {
    if (!els.editError) return;
    els.editError.textContent = msg || "";
    els.editError.classList.toggle("show", !!msg);
  }

  function escHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function clipPreview(text, maxLines = 3, maxChars = 420) {
    const t = String(text || "").trim();
    if (!t) return "";
    const lines = t.split("\n").slice(0, maxLines).join("\n");
    return (lines.length > maxChars ? lines.slice(0, maxChars) + "…" : lines);
  }

function syncMetricsIntoPromptText() {
  if (!els.promptText) return;

  const { mss, opt } = getSelectedMetricsFromUI();
  const all = [...mss, ...opt];

  // Update the metrics block in the prompt text
  els.promptText.value = upsertMetricsBlock(els.promptText.value, all);
}
  // ---------------------------
  // MSS modal (replaces browser alert/confirm)
  // ---------------------------
  function showModal(title, body) {
    const ov = els.mssModalOverlay;
    const t = els.mssModalTitle;
    const b = els.mssModalBody;

    if (!ov || !t || !b || !els.mssModalOk) {
      console.warn("[AIPromptManager] MSS modal missing:", title, body);
      return;
    }

    t.textContent = title || "Notice";
    b.textContent = body || "";
    ov.classList.add("show");
    ov.setAttribute("aria-hidden", "false");

    const close = () => {
      ov.classList.remove("show");
      ov.setAttribute("aria-hidden", "true");
    };

    els.mssModalOk.onclick = close;
    if (els.mssModalCloseX) els.mssModalCloseX.onclick = close;

    ov.onclick = (e) => { if (e.target === ov) close(); };

    const onKey = (ev) => {
      if (ev.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
  }

  // Minimal confirm modal using the same MSS modal body area
  // (Uses inline buttons; no new HTML required.)
  function confirmModal(title, body) {
    return new Promise((resolve) => {
      const ov = els.mssModalOverlay;
      const t = els.mssModalTitle;
      const b = els.mssModalBody;

      if (!ov || !t || !b) {
        resolve(false);
        return;
      }

      t.textContent = title || "Confirm";
      b.innerHTML = `
        <div class="viewerText">${escHtml(body || "")}</div>
        <div class="toolbar" style="margin-top:12px;">
          <button class="btn" id="mssConfirmCancel" type="button">Cancel</button>
          <button class="btn primary" id="mssConfirmOk" type="button">Delete</button>
        </div>
      `;

      ov.classList.add("show");
      ov.setAttribute("aria-hidden", "false");

      const close = (val) => {
        ov.classList.remove("show");
        ov.setAttribute("aria-hidden", "true");
        resolve(val);
      };

      const okBtn = $("mssConfirmOk");
      const cancelBtn = $("mssConfirmCancel");

      if (okBtn) okBtn.onclick = () => close(true);
      if (cancelBtn) cancelBtn.onclick = () => close(false);

      if (els.mssModalCloseX) els.mssModalCloseX.onclick = () => close(false);

      ov.onclick = (e) => { if (e.target === ov) close(false); };

      const onKey = (ev) => {
        if (ev.key === "Escape") {
          close(false);
          document.removeEventListener("keydown", onKey);
        }
      };
      document.addEventListener("keydown", onKey);
    });
  }

  // ---------------------------
  // Routing helpers
  // ---------------------------
  function getSlug() {
    const p = new URLSearchParams(location.search);
    return (p.get("slug") || "").trim();
  }

  function readToken() {
    try { return (localStorage.getItem(LS_TOKEN_KEY) || "").trim(); }
    catch { return ""; }
  }

  function redirectToLogin() {
    window.location.href = LOGIN_URL;
  }

  async function adminFetch(url, options = {}) {
    const token = readToken();
    const headers = new Headers(options.headers || {});
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  }

  // ---------------------------
  // Suggest: preamble + input collection + validation
  // ---------------------------
  function buildSuggestPreamble() {
    return [
      "SYSTEM ROLE:",
      "You are an expert instructional designer for MySpeakingScore (MSS).",
      "",
      "TASK:",
      "Generate a teacher-usable AI prompt template for feedback on a student's spoken response.",
      "This template will be stored in ai_prompts.prompt_text and later used with real submission data.",
      "",
      "CONSTRAINTS:",
      "- Use ONLY the metrics the admin selected.",
      "- Do NOT invent scores or facts.",
      "- Be practical: actionable exercises, encouraging, teacher-friendly.",
      "- Output must be a single prompt template (not JSON).",
      "",
      "AVAILABLE RUNTIME VARIABLES (placeholders):",
      "- {{question}}",
      "- {{transcript}} (clean transcript)",
      "- {{student}} (if present)",
      "- {{wpm}} (if selected)",
      "- Selected MSS scores: {{mss_fluency}}, {{mss_pron}}, {{mss_grammar}}, {{mss_vocab}}, {{mss_cefr}}, {{mss_toefl}}",
      "",
      "REQUIRED OUTPUT STRUCTURE (Markdown):",
      "1) Quick Summary (2–3 bullets)",
      "2) Strengths (2–4 bullets)",
      "3) Priority Improvements (2–4 bullets)",
      "4) Exercises (3–6 items) tied to selected metrics",
      "5) Next Attempt Plan (short checklist)",
      "",
      "TONE:",
      "Supportive, specific, teacher-friendly."
    ].join("\n");
  }

  function collectSuggestInputs() {
    const name = (els.promptName?.value || "").trim();
    const helperLanguage = (els.helperLanguage?.value || "").trim();
    const notes = (els.suggestNotes?.value || "").trim();

    const mss = Array.from(document.querySelectorAll("input.mssMetric:checked")).map(x => x.value);
    const opt = Array.from(document.querySelectorAll("input.optMetric:checked")).map(x => x.value);

    return { name, helperLanguage, notes, mss, opt };
  }

  function validateSuggestInputs(inputs) {
    if (!inputs.name) return "Please enter a Prompt Name first.";
    if (!inputs.mss || inputs.mss.length < 1) {
      return "Please select at least one MSS metric (e.g., Grammar, Fluency). WPM alone is not sufficient.";
    }
    return "";
  }

  // ---------------------------
  // Checklists
  // ---------------------------
  function buildSuggestChecklists() {
    if (els.mssChecklist) {
      els.mssChecklist.innerHTML = MSS_METRICS.map(m => `
        <label class="check">
          <input type="checkbox" class="mssMetric" value="${escHtml(m.key)}" />
          <span>${escHtml(m.label)}</span>
        </label>
      `).join("");
    }

    if (els.optChecklist) {
      els.optChecklist.innerHTML = OPT_METRICS.map(m => `
        <label class="check">
          <input type="checkbox" class="optMetric" value="${escHtml(m.key)}" />
          <span>${escHtml(m.label)}</span>
        </label>
      `).join("");
    }
  }

  function buildVarChecklist() {
    if (!els.varChecklist) return;

    els.varChecklist.innerHTML = VARS.map(v => `
      <div class="check">
        <button class="btn" type="button" data-insert="${escHtml(v.key)}" style="padding:7px 10px;">＋</button>
        <div><code>{{${escHtml(v.key)}}}</code> <span style="color:#64748b;">${escHtml(v.label)}</span></div>
      </div>
    `).join("");

    els.varChecklist.querySelectorAll("[data-insert]").forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.getAttribute("data-insert");
        insertAtCursor(els.promptText, `{{${key}}}`);
      });
    });
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.focus();
    const pos = start + text.length;
    textarea.setSelectionRange(pos, pos);
  }

  // ---------------------------
  // API
  // ---------------------------
  async function loadPrompts(slug) {
    const res = await adminFetch(`/api/admin/ai-prompts/${encodeURIComponent(slug)}`, { method: "GET" });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) { redirectToLogin(); return []; }
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);

    return Array.isArray(data.prompts) ? data.prompts : [];
  }

  async function createPrompt(slug, payload) {
    const res = await adminFetch(`/api/admin/ai-prompts/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { redirectToLogin(); return null; }
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);
    return data.prompt || null;
  }

  async function updatePrompt(slug, id, payload) {
    const res = await adminFetch(`/api/admin/ai-prompts/${encodeURIComponent(slug)}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { redirectToLogin(); return null; }
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);
    return data.prompt || null;
  }

  async function deletePrompt(slug, id) {
    const res = await adminFetch(`/api/admin/ai-prompts/${encodeURIComponent(slug)}/${id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { redirectToLogin(); return false; }
    if (!res.ok || data.ok === false) throw new Error(data.error || `http_${res.status}`);
    return true;
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function renderEmpty() {
    els.list.innerHTML = `<div style="padding:14px; color:#64748b; font-size:13px;">No prompts found.</div>`;
  }

  function renderList(prompts) {
    if (!Array.isArray(prompts) || prompts.length === 0) return renderEmpty();

    const sorted = [...prompts].sort((a, b) => {
      const ao = a.sort_order ?? 999999;
      const bo = b.sort_order ?? 999999;
      if (ao !== bo) return ao - bo;
      return Number(a.id) - Number(b.id);
    });

    els.list.innerHTML = sorted.map((p) => {
      const active = p.is_active !== false;
      const isDefault = !!p.is_default;
      const preview = clipPreview(p.prompt_text, 3, 460);

      return `
        <div class="row" data-id="${p.id}">
          <div style="min-width:0; flex:1;">
            <h3>${escHtml(p.name || "Untitled Prompt")}</h3>
            <div class="badges" style="margin-top:8px;">
              <span class="pill ${active ? "on" : ""}">${active ? "Active" : "Inactive"}</span>
              ${isDefault ? `<span class="pill default">Default</span>` : ``}
              ${p.sort_order != null ? `<span class="pill">Order: ${Number(p.sort_order)}</span>` : ``}
            </div>
            <div class="preview">${escHtml(preview)}</div>
          </div>

          <div class="rowBtns">
            <button class="btn" data-action="view" type="button">View</button>
            <button class="btn" data-action="edit" type="button">Edit</button>
            <button class="btn" data-action="del" type="button">Delete</button>
          </div>
        </div>
      `;
    }).join("");

    els.list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".row");
        const id = Number(row?.getAttribute("data-id") || 0);
        if (!id) return;

        const action = btn.getAttribute("data-action");
        const p = promptsCache.find(x => Number(x.id) === id);

        if (action === "view" && p) openViewer(p);
        if (action === "edit" && p) openEditor(p);
        if (action === "del" && p) await handleDelete(p);
      });
    });
  }

  // ---------------------------
  // Viewer Modal
  // ---------------------------
  function openViewer(p) {
    viewerPromptId = Number(p.id);
    els.viewerTitle.textContent = p.name || "Prompt";
    els.viewerMeta.textContent = `id=${p.id}`;
    els.viewerText.textContent = p.prompt_text || "";
    els.viewerOverlay.classList.add("show");
  }

  function closeViewer() {
    els.viewerOverlay.classList.remove("show");
    viewerPromptId = null;
  }

  // ---------------------------
  // Editor Modal
  // ---------------------------
 function openEditor(pOrNull) {
  showEditError("");

  if (pOrNull) {
    editPromptId = Number(pOrNull.id);
    els.editTitle.textContent = "Edit Prompt";
    els.editMeta.textContent = `id=${pOrNull.id} • slug=${currentSlug}`;
    els.promptName.value = pOrNull.name || "";
    els.promptText.value = pOrNull.prompt_text || "";
    els.helperLanguage.value = ""; // not persisted yet
    if (els.suggestNotes) els.suggestNotes.value = "";
  } else {
    editPromptId = null;
    els.editTitle.textContent = "Add Prompt";
    els.editMeta.textContent = `slug=${currentSlug}`;
    els.promptName.value = "";
    els.promptText.value = "";
    els.helperLanguage.value = "";
    if (els.suggestNotes) els.suggestNotes.value = "";
  }

  // ✅ Always sync checkbox state from current prompt text (Add or Edit)
  const selectedKeys = parseMetricsFromPromptText(els.promptText.value);

  document.querySelectorAll("input.mssMetric").forEach(cb => {
    cb.checked = selectedKeys.includes(cb.value);
  });

  document.querySelectorAll("input.optMetric").forEach(cb => {
    cb.checked = selectedKeys.includes(cb.value);
  });

  // ✅ Ensure block exists / normalized based on current checkbox state
  // (If your parse came from block, this becomes idempotent)
  syncMetricsIntoPromptText();

  els.editOverlay.classList.add("show");
  setTimeout(() => els.promptName?.focus(), 0);
}
  function closeEditor() {
    els.editOverlay.classList.remove("show");
    editPromptId = null;
    showEditError("");
  }

  async function handleDelete(p) {
    const ok = await confirmModal(
      "Delete AI Prompt",
      `Delete this prompt?\n\n"${p.name || "Untitled Prompt"}"\n\nThis cannot be undone.`
    );
    if (!ok) return;

    try {
      setStatus("Deleting…");
      await deletePrompt(currentSlug, Number(p.id));
      await refresh();
      setStatus("");
      closeViewer();
      closeEditor();
    } catch (e) {
      setStatus(`Delete failed: ${e.message || "unknown"}`, true);
    }
  }

  async function handleSave() {
    showEditError("");

    const name = (els.promptName.value || "").trim();
    const prompt_text = (els.promptText.value || "").trim();

    if (!name) return showEditError("Prompt Name is required.");
    if (!prompt_text) return showEditError("Prompt Text is required.");

    const payload = { name, prompt_text };

    try {
      setStatus("Saving…");
      els.btnSave.disabled = true;

      if (editPromptId == null) {
        await createPrompt(currentSlug, payload);
      } else {
        await updatePrompt(currentSlug, editPromptId, payload);
      }

      await refresh();
      setStatus("");
      closeEditor();
    } catch (e) {
      showEditError(`Save failed: ${e.message || "unknown"}`);
    } finally {
      els.btnSave.disabled = false;
    }
  }

  // ---------------------------
  // Suggest (stub for now; next step is AI API call)
  // ---------------------------
  async function handleSuggest() {
    showEditError("");

    const inputs = collectSuggestInputs();
    const problem = validateSuggestInputs(inputs);
    if (problem) {
      showModal("Suggest AI Prompt", problem);
      return;
    }

    // Hardwired preamble + admin selections (ready for API submission)
    const preamble = buildSuggestPreamble();

    const selections = [
      "",
      "ADMIN SELECTIONS:",
      `- Prompt name: ${inputs.name}`,
      `- Helper language: ${inputs.helperLanguage || "None (English only)"}`,
      `- MSS metrics: ${inputs.mss.join(", ")}`,
      `- Optional metrics: ${inputs.opt.length ? inputs.opt.join(", ") : "None"}`,
      `- Admin notes: ${inputs.notes || "None"}`
    ].join("\n");

    const composedRequest = `${preamble}\n${selections}`;

    // For now: show what will be sent.
    // Next: POST to your AI API endpoint and set els.promptText.value = modelOutput.
    showModal(
      "Suggest is wired (next step: AI API)",
      "Request that will be sent to the AI API:\n\n" + composedRequest
    );
  }

  // ---------------------------
  // Refresh
  // ---------------------------
  async function refresh() {
    const prompts = await loadPrompts(currentSlug);
    promptsCache = prompts;
    renderList(promptsCache);
  }

  // ---------------------------
  // Close behaviour (return to Portal)
  // ---------------------------
  function handleClosePage() {
    // If opened via window.open(), try to close.
    try { window.close(); } catch {}

    // Fallback navigation
    window.location.href = `/admin/SchoolPortal.html?slug=${encodeURIComponent(currentSlug)}`;
  }

  // ---------------------------
  // Init
  // ---------------------------
  async function init() {
    currentSlug = getSlug();
    if (els.meta) els.meta.textContent = `slug=${currentSlug || "—"}`;

    if (!currentSlug) {
      setStatus("Missing slug in URL.", true);
      renderEmpty();
      return;
    }

    const token = readToken();
    if (!token) { redirectToLogin(); return; }

    buildVarChecklist();
    buildSuggestChecklists();

    // Top buttons
    els.btnAdd?.addEventListener("click", () => openEditor(null));
    els.btnClose?.addEventListener("click", handleClosePage);
    els.btnCloseX?.addEventListener("click", handleClosePage);

    // Viewer modal close
    els.viewerClose?.addEventListener("click", closeViewer);
    els.viewerClose2?.addEventListener("click", closeViewer);
    els.viewerOverlay?.addEventListener("click", (e) => {
      if (e.target === els.viewerOverlay) closeViewer();
    });

    // Viewer edit -> opens editor
    els.viewerEdit?.addEventListener("click", () => {
      const p = promptsCache.find(x => Number(x.id) === Number(viewerPromptId));
      if (p) {
        closeViewer();
        openEditor(p);
      }
    });

    // Editor modal buttons
    els.editClose?.addEventListener("click", closeEditor);
    els.btnCancel?.addEventListener("click", closeEditor);
    els.btnSave?.addEventListener("click", handleSave);
    els.btnSuggest?.addEventListener("click", handleSuggest);
    els.editOverlay?.addEventListener("click", (e) => {
      if (e.target === els.editOverlay) closeEditor();
    });

document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t) return;

  if (t.classList.contains("mssMetric") || t.classList.contains("optMetric")) {
    syncMetricsIntoPromptText();
  }
});

    // Load prompts
    try {
      setStatus("Loading prompts…");
      await refresh();
      setStatus("");
    } catch (e) {
      setStatus(`Unable to load prompts: ${e.message || "unknown"}`, true);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();