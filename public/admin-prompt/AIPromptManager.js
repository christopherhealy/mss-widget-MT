// /public/admin-prompt/AIPromptManager.js
// v1.0 (2026-01-21) — MSSClient-only, school-scoped, “set-it-and-forget-it”
// - Removes all pre-MSSClient auth/token code (no localStorage token, no legacy adminFetch)
// - Uses MSSClient.bootGuard() once; never re-reads slug from URL
// - Centralizes API calls through apiJson() (auth + school scope enforced)
// - De-duped helpers, consistent error handling, reviewable comments
// - Supports Teachers + Admins + Super Admins (within school scope)
// - Suggest Settings (school-level) CRUD compatible with both old/new response shapes
console.log("✅ AIPromptManager.js loaded");
//Jan 21
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // =====================================================================
  // AUTH (canonical): MSSClient + actor JWT
  // Teachers, Admins, Super Admins can use Prompt Manager (within their school scope)
  // =====================================================================
  if (!window.MSSClient) {
    console.error("[AIPromptManager] MSSClient not loaded");
    window.location.href = "/admin-login/AdminLogin.html?reason=mssclient_missing";
    throw new Error("mssclient_missing");
  }

  // One-time boot: establishes canonical session + slug + authenticated fetch
  const boot = window.MSSClient.bootGuard({
    allow: ["admin", "teacher"],
    requireSlug: true,
  });

  const session = boot.session;
  const apiFetch = boot.apiFetch;
  const currentSlug = String(boot.slug || "").trim(); // canonical school scope for this page

  console.log("[AIPromptManager] boot ok", {
    actorType: session?.actorType,
    isSuperAdmin: !!session?.isSuperAdmin,
    isTeacherAdmin: !!session?.isTeacherAdmin,
    slug: currentSlug,
  });

  // Canonical JSON helper (ensures auth + school context)
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
  function updateSlugInUrl(slug) {
  if (!slug) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("slug", slug);
    window.history.replaceState({}, "", url.toString());
  } catch (e) {
    console.warn("[AIPromptManager] Could not update URL slug", e);
  }
}

  // =====================================================================
  // DOM refs
  // =====================================================================
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
    promptLanguage: $("helperLanguage"),
    promptNotes: $("suggestNotes"),
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

    // Suggest Settings (school-level)
    suggestPreamble: $("suggestPreamble"),
    suggestDefaultLanguage: $("suggestDefaultLanguage"),
    suggestDefaultNotes: $("suggestDefaultNotes"),
    suggestDefaultMetrics: $("suggestDefaultMetrics"),
    btnSaveSuggestSettings: $("btnSaveSuggestSettings"),
    suggestSettingsStatus: $("suggestSettingsStatus"),
  };

  // =====================================================================
  // In-memory state
  // =====================================================================
  let promptsCache = [];
  let viewerPrompt = null;
  let viewerPromptId = null;
  let editPromptId = null; // null = add, number = edit

  // Suggest settings state
  let suggestSettings = null;        // normalized { id, preamble_prompt_id, preamble, default_language, default_notes, default_metrics }
  let suggestDefaultMetricKeys = []; // cached selected keys

  // =====================================================================
  // Variables + Suggest metric lists
  // =====================================================================
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

  // =====================================================================
  // Metrics block helpers (embed selected metrics inside prompt text)
  // =====================================================================
  const METRICS_BLOCK_START = "[[MSS_SELECTED_METRICS]]";
  const METRICS_BLOCK_END = "[[/MSS_SELECTED_METRICS]]";

  function placeholderFor(key) { return `{{${key}}}`; }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildMetricsBlockLines(keys) {
    if (!keys.length) return "";
    const lines = keys.map((k) => `- ${placeholderFor(k)}`);
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
      return (
        text
          .replace(
            new RegExp(
              `${escapeRegExp(METRICS_BLOCK_START)}[\\s\\S]*?${escapeRegExp(METRICS_BLOCK_END)}\\n?`,
              "g"
            ),
            ""
          )
          .trim() + "\n"
      );
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

  function getSelectedMetricsFromUI() {
    const mss = Array.from(document.querySelectorAll("input.mssMetric:checked")).map((x) => x.value);
    const opt = Array.from(document.querySelectorAll("input.optMetric:checked")).map((x) => x.value);
    return { mss, opt };
  }

  function syncMetricsIntoPromptText() {
    if (!els.promptText) return;
    const { mss, opt } = getSelectedMetricsFromUI();
    els.promptText.value = upsertMetricsBlock(els.promptText.value, [...mss, ...opt]);
  }

  // =====================================================================
  // UI helpers
  // =====================================================================
  function setStatus(msg = "", isError = false) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.classList.toggle("error", !!isError);
  }

  function setSuggestSettingsStatus(msg = "", isError = false) {
    if (!els.suggestSettingsStatus) return;
    els.suggestSettingsStatus.textContent = msg || "";
    els.suggestSettingsStatus.classList.toggle("error", !!isError);
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

  // =====================================================================
  // MSS modal (replaces alert/confirm)
  // =====================================================================
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

  // =====================================================================
  // Suggest Settings UI (defaults checklist)
  // =====================================================================
  function getAllMetricDefs() {
    return [...MSS_METRICS, ...OPT_METRICS].filter((x) => x && x.key && x.label);
  }

  function renderSuggestDefaultMetricsChecklist() {
    if (!els.suggestDefaultMetrics) return;

    const defs = getAllMetricDefs();
    if (!defs.length) {
      els.suggestDefaultMetrics.innerHTML = `<div class="hint">No metric definitions found.</div>`;
      return;
    }

    els.suggestDefaultMetrics.innerHTML = defs.map((m) => `
      <label class="check">
        <input type="checkbox" data-key="${escHtml(m.key)}" />
        <span>${escHtml(m.label)}</span>
      </label>
    `).join("");

    // Apply cached selection
    if (Array.isArray(suggestDefaultMetricKeys) && suggestDefaultMetricKeys.length) {
      const set = new Set(suggestDefaultMetricKeys.map((k) => String(k).toLowerCase()));
      Array.from(els.suggestDefaultMetrics.querySelectorAll("input[type=checkbox][data-key]"))
        .forEach((cb) => {
          const k = String(cb.getAttribute("data-key") || "").toLowerCase();
          cb.checked = set.has(k);
        });
    }
  }

  function readSuggestSettingsFromUI() {
    const preamble = String(els.suggestPreamble?.value || "").trim();
    const default_language = String(els.suggestDefaultLanguage?.value || "").trim();
    const default_notes = String(els.suggestDefaultNotes?.value || "").trim();

    const metricKeys = Array.from(
      els.suggestDefaultMetrics?.querySelectorAll("input[type=checkbox][data-key]") || []
    )
      .filter((cb) => cb.checked)
      .map((cb) => String(cb.getAttribute("data-key") || "").trim())
      .filter(Boolean);

    return { preamble, default_language, default_notes, default_metrics: metricKeys };
  }

  function applySuggestSettingsToUI(s) {
    // Normalize to one internal shape
    suggestSettings = {
      id: s?.id != null ? Number(s.id) : (suggestSettings?.id ?? null),
      preamble_prompt_id: s?.preamble_prompt_id != null ? Number(s.preamble_prompt_id) : (suggestSettings?.preamble_prompt_id ?? null),
      preamble: String(s?.preamble || ""),
      default_language: String(s?.default_language || ""),
      default_notes: String(s?.default_notes || ""),
      default_metrics: Array.isArray(s?.default_metrics) ? s.default_metrics : [],
    };

    if (els.suggestPreamble) els.suggestPreamble.value = suggestSettings.preamble;
    if (els.suggestDefaultLanguage) els.suggestDefaultLanguage.value = suggestSettings.default_language;
    if (els.suggestDefaultNotes) els.suggestDefaultNotes.value = suggestSettings.default_notes;

    suggestDefaultMetricKeys = suggestSettings.default_metrics
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    renderSuggestDefaultMetricsChecklist();
  }

  // =====================================================================
  // Checklists (metrics + variable inserts)
  // =====================================================================
  function buildSuggestChecklists() {
    if (els.mssChecklist) {
      els.mssChecklist.innerHTML = MSS_METRICS.map((m) => `
        <label class="check">
          <input type="checkbox" class="mssMetric" value="${escHtml(m.key)}" />
          <span>${escHtml(m.label)}</span>
        </label>
      `).join("");
    }

    if (els.optChecklist) {
      els.optChecklist.innerHTML = OPT_METRICS.map((m) => `
        <label class="check">
          <input type="checkbox" class="optMetric" value="${escHtml(m.key)}" />
          <span>${escHtml(m.label)}</span>
        </label>
      `).join("");
    }
  }

  function buildVarChecklist() {
    if (!els.varChecklist) return;

    els.varChecklist.innerHTML = VARS.map((v) => `
      <div class="check">
        <button class="btn" type="button" data-insert="${escHtml(v.key)}" style="padding:7px 10px;">＋</button>
        <div>
          <code>{{${escHtml(v.key)}}}</code>
          <span style="color:#64748b;">${escHtml(v.label)}</span>
        </div>
      </div>
    `).join("");

    els.varChecklist.querySelectorAll("[data-insert]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = String(btn.getAttribute("data-insert") || "").trim();
        if (!key) return;
        insertAtCursor(els.promptText, `{{${key}}}`);
      });
    });
  }

  function insertAtCursor(textarea, text) {
    if (!textarea) return;

    const value = String(textarea.value || "");
    const insert = String(text || "");

    const start = (typeof textarea.selectionStart === "number") ? textarea.selectionStart : value.length;
    const end = (typeof textarea.selectionEnd === "number") ? textarea.selectionEnd : value.length;

    textarea.value = value.slice(0, start) + insert + value.slice(end);
    textarea.focus();

    const pos = start + insert.length;
    try { textarea.setSelectionRange(pos, pos); } catch { /* noop */ }
  }

 
 
  // =====================================================================
  // Rendering
  // =====================================================================
  function renderEmpty() {
    if (!els.list) return;
    els.list.innerHTML = `<div style="padding:14px; color:#64748b; font-size:13px;">No prompts found.</div>`;
  }

  function renderList(prompts) {
    if (!els.list) return;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      renderEmpty();
      return;
    }

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
              <span class="pill ${active ? "on" : ""}">
                ${active ? "Active" : "Inactive"}
              </span>
              ${isDefault ? `<span class="pill default">Default</span>` : ""}
              ${p.sort_order != null ? `<span class="pill">Order: ${Number(p.sort_order)}</span>` : ""}
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
        const p = promptsCache.find((x) => Number(x.id) === id);
        if (!p) return;

        if (action === "view") openViewer(p);
        if (action === "edit") openEditor(p);
        if (action === "del") await handleDelete(p);
      });
    });
  }

  // =====================================================================
  // Viewer modal
  // =====================================================================
  function openViewer(p) {
    viewerPrompt = p;
    viewerPromptId = Number(p.id);

    if (els.viewerTitle) els.viewerTitle.textContent = p.name || "Prompt";
    if (els.viewerMeta) els.viewerMeta.textContent = `id=${p.id} • slug=${currentSlug}`;
    if (els.viewerText) els.viewerText.textContent = p.prompt_text || "";

    if (els.viewerOverlay) els.viewerOverlay.classList.add("show");
  }

  function closeViewer() {
    if (els.viewerOverlay) els.viewerOverlay.classList.remove("show");
    viewerPromptId = null;
    viewerPrompt = null;
  }

  // =====================================================================
  // Editor modal
  // =====================================================================
  function openEditor(pOrNull) {
    showEditError("");

    if (!els.promptName || !els.promptText || !els.promptLanguage || !els.promptNotes) {
      console.error("[openEditor] missing DOM refs");
      return;
    }

    if (pOrNull) {
      editPromptId = Number(pOrNull.id);
      if (els.editTitle) els.editTitle.textContent = "Edit Prompt";
      if (els.editMeta) els.editMeta.textContent = `id=${pOrNull.id} • slug=${currentSlug}`;
      els.promptName.value = pOrNull.name || "";
      els.promptText.value = pOrNull.prompt_text || "";
      els.promptLanguage.value = pOrNull.language || "";
      els.promptNotes.value = pOrNull.notes || "";
    } else {
      editPromptId = null;
      if (els.editTitle) els.editTitle.textContent = "Add Prompt";
      if (els.editMeta) els.editMeta.textContent = `slug=${currentSlug}`;
      els.promptName.value = "";
      els.promptText.value = "";
      els.promptLanguage.value = "";
      els.promptNotes.value = "";
    }

    const selectedKeys = parseMetricsFromPromptText(els.promptText.value);

    document.querySelectorAll("input.mssMetric").forEach((cb) => { cb.checked = selectedKeys.includes(cb.value); });
    document.querySelectorAll("input.optMetric").forEach((cb) => { cb.checked = selectedKeys.includes(cb.value); });

    // Ensure prompt text contains the metrics block consistent with current selections
    syncMetricsIntoPromptText();

    if (els.editOverlay) els.editOverlay.classList.add("show");
    setTimeout(() => els.promptName.focus(), 0);
  }

  function closeEditor() {
    if (els.editOverlay) els.editOverlay.classList.remove("show");
    editPromptId = null;
    showEditError("");
  }

  // =====================================================================
  // Delete / Save
  // =====================================================================
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

    const name = (els.promptName?.value || "").trim();
    const prompt_text = (els.promptText?.value || "").trim();
    const language = (els.promptLanguage?.value || "").trim();
    const notes = (els.promptNotes?.value || "").trim();

    if (!name) return showEditError("Prompt Name is required.");
    if (!prompt_text) return showEditError("Prompt Text is required.");

    const payload = { name, prompt_text, notes, language };

    try {
      setStatus("Saving…");
      if (els.btnSave) els.btnSave.disabled = true;

      if (editPromptId == null) {
        const saved = await createPrompt(currentSlug, payload);
        if (saved?.id) editPromptId = Number(saved.id);
      } else {
        await updatePrompt(currentSlug, editPromptId, payload);
      }

      await refresh();
      setStatus("Saved ✓");
    } catch (e) {
      showEditError(`Save failed: ${e.message || "unknown"}`);
    } finally {
      if (els.btnSave) els.btnSave.disabled = false;
    }
  }

  // =====================================================================
  // Suggest Settings flow
  // =====================================================================
  async function refreshSuggestSettings() {
    // If the card isn't present on a reused page, no-op
    if (!els.suggestPreamble || !els.btnSaveSuggestSettings) return;

    // Render checklist skeleton early so checkboxes exist
    renderSuggestDefaultMetricsChecklist();

    try {
      setSuggestSettingsStatus("Loading…");
      const s = await loadSuggestSettings(currentSlug);
      if (s) applySuggestSettingsToUI(s);
      setSuggestSettingsStatus("Loaded ✓");
    } catch (e) {
      console.error("[AIPromptManager] refreshSuggestSettings failed:", e);
      setSuggestSettingsStatus(`Load failed: ${e.message || "unknown"}`, true);
    }
  }

  async function handleSaveSuggestSettings() {
    try {
      setSuggestSettingsStatus("Saving…");
      if (els.btnSaveSuggestSettings) els.btnSaveSuggestSettings.disabled = true;

      const ui = readSuggestSettingsFromUI();
      if (!ui.preamble) {
        setSuggestSettingsStatus("Preamble is required.", true);
        return;
      }

      const saved = await saveSuggestSettings(currentSlug, ui);
      if (saved) applySuggestSettingsToUI(saved);

      setSuggestSettingsStatus("Saved ✓");
    } catch (e) {
      console.error("[AIPromptManager] handleSaveSuggestSettings failed:", e);
      setSuggestSettingsStatus(`Save failed: ${e.message || "unknown"}`, true);
    } finally {
      if (els.btnSaveSuggestSettings) els.btnSaveSuggestSettings.disabled = false;
    }
  }

   // =====================================================================
  // Suggest generation
  // =====================================================================

  function collectSuggestInputs() {
    const name = String(els.promptName?.value || "").trim();
    const helperLanguage = String(els.promptLanguage?.value || "").trim();
    const notes = String(els.promptNotes?.value || "").trim();

    const mss = Array.from(document.querySelectorAll("input.mssMetric:checked")).map((x) => x.value);
    const opt = Array.from(document.querySelectorAll("input.optMetric:checked")).map((x) => x.value);

    return { name, helperLanguage, notes, mss, opt };
  }

  function validateSuggestInputs(inputs) {
    if (!inputs.name) return "Please enter a Prompt Name first.";
    if (!inputs.mss || inputs.mss.length < 1) {
      return "Please select at least one MSS metric (e.g., Grammar, Fluency). WPM alone is not sufficient.";
    }
    return "";
  }

  // =====================================================================
  // API (Prompts CRUD) — MSSClient + actor JWT
  // =====================================================================

    async function createPrompt(slug, payload) {
    const data = await apiJson(`/api/admin/ai-prompts/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return data.prompt || null;
  }

  async function updatePrompt(slug, id, payload) {
    const data = await apiJson(`/api/admin/ai-prompts/${encodeURIComponent(slug)}/${Number(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return data.prompt || null;
  }

  async function deletePrompt(slug, id) {
    await apiJson(`/api/admin/ai-prompts/${encodeURIComponent(slug)}/${Number(id)}`, { method: "DELETE" });
    return true;
  }

  // =====================================================================
  // API (Suggest Settings) — school-level defaults
  // Supports BOTH backend shapes:
  // 1) old: { suggest: {...} }
  // 2) new: { preamble, default_language, default_notes, default_selected_metrics, preamble_prompt_id }
  // =====================================================================

  async function loadSuggestSettings(slug) {
    const data = await apiJson(
      `/api/admin/ai-prompts/${encodeURIComponent(slug)}/suggest-settings`,
      { method: "GET" }
    );

    const s = data.suggest || data;

    return {
      id: s.id != null ? Number(s.id) : null,
      preamble_prompt_id: s.preamble_prompt_id != null ? Number(s.preamble_prompt_id) : null,
      preamble: String(s.preamble || s.prompt_text || ""),
      default_language: String(s.default_language || ""),
      default_notes: String(s.default_notes || ""),
      default_metrics: Array.isArray(s.default_selected_metrics)
        ? s.default_selected_metrics.map((x) => String(x || "").trim()).filter(Boolean)
        : (Array.isArray(s.default_metrics)
            ? s.default_metrics.map((x) => String(x || "").trim()).filter(Boolean)
            : []),
    };
  }

  async function saveSuggestSettings(slug, payload) {
    // Backend requires: preamble (required). ID is optional (upsert by schoolId anyway).
    // Send both keys during transition for compatibility.
    const body = {
      // Optional (helps if your DB table uses id / preamble_prompt_id)
      id: payload.id != null ? Number(payload.id) : null,

      preamble: String(payload.preamble || ""),

      default_language: String(payload.default_language || ""),
      default_notes: String(payload.default_notes || ""),

      default_selected_metrics: Array.isArray(payload.default_metrics) ? payload.default_metrics : [],
      default_metrics: Array.isArray(payload.default_metrics) ? payload.default_metrics : [],
    };

    const data = await apiJson(
      `/api/admin/ai-prompts/${encodeURIComponent(slug)}/suggest-settings`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const s = data.suggest || data;

    return {
      id: s.id != null ? Number(s.id) : (body.id != null ? Number(body.id) : null),
      preamble_prompt_id: s.preamble_prompt_id != null ? Number(s.preamble_prompt_id) : null,
      preamble: String(s.preamble || s.prompt_text || ""),
      default_language: String(s.default_language || ""),
      default_notes: String(s.default_notes || ""),
      default_metrics: Array.isArray(s.default_selected_metrics)
        ? s.default_selected_metrics
        : (Array.isArray(s.default_metrics) ? s.default_metrics : []),
    };
  }

  // =====================================================================
  // Suggest generation API
  // =====================================================================

  async function suggestPrompt(slug, payload) {
    const data = await apiJson(`/api/admin/ai-prompts/${encodeURIComponent(slug)}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Your server returns: { prompt_text, suggested_prompt_text, model, ... }
    const text = String(data.prompt_text || data.suggested_prompt_text || "").trim();
    return { text, model: data.model || "" };
  }

  // =====================================================================
  // Suggest Settings UI glue
  // =====================================================================

  function readSuggestSettingsFromUI() {
    const preamble = String(els.suggestPreamble?.value || "").trim();
    const default_language = String(els.suggestDefaultLanguage?.value || "").trim();
    const default_notes = String(els.suggestDefaultNotes?.value || "").trim();

    const metricKeys = Array.from(
      els.suggestDefaultMetrics?.querySelectorAll("input[type=checkbox][data-key]") || []
    )
      .filter((cb) => cb.checked)
      .map((cb) => String(cb.getAttribute("data-key") || "").trim())
      .filter(Boolean);

    return { preamble, default_language, default_notes, default_metrics: metricKeys };
  }

  function applySuggestSettingsToUI(s) {
    suggestSettings = {
      id: s?.id != null ? Number(s.id) : (suggestSettings?.id ?? null),
      preamble_prompt_id:
        s?.preamble_prompt_id != null
          ? Number(s.preamble_prompt_id)
          : (suggestSettings?.preamble_prompt_id ?? null),
      preamble: String(s?.preamble || ""),
      default_language: String(s?.default_language || ""),
      default_notes: String(s?.default_notes || ""),
      default_metrics: Array.isArray(s?.default_metrics) ? s.default_metrics : [],
    };

    if (els.suggestPreamble) els.suggestPreamble.value = suggestSettings.preamble;
    if (els.suggestDefaultLanguage) els.suggestDefaultLanguage.value = suggestSettings.default_language;
    if (els.suggestDefaultNotes) els.suggestDefaultNotes.value = suggestSettings.default_notes;

    suggestDefaultMetricKeys = suggestSettings.default_metrics
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    // re-render + apply checks
    renderSuggestDefaultMetricsChecklist();
  }

  async function refreshSuggestSettings() {
    // If the Suggest Settings card isn't on this page, no-op (future reuse)
    if (!els.suggestPreamble || !els.btnSaveSuggestSettings) return;

    // Ensure checklist skeleton exists so we can check boxes
    renderSuggestDefaultMetricsChecklist();

    try {
      setSuggestSettingsStatus("Loading…");
      const s = await loadSuggestSettings(currentSlug);
      if (s) applySuggestSettingsToUI(s);
      setSuggestSettingsStatus("Loaded ✓");
    } catch (e) {
      console.error("[AIPromptManager] refreshSuggestSettings failed:", e);
      setSuggestSettingsStatus(`Load failed: ${e.message || "unknown"}`, true);
    }
  }

  async function handleSaveSuggestSettings() {
    if (!els.btnSaveSuggestSettings) return;

    try {
      setSuggestSettingsStatus("Saving…");
      els.btnSaveSuggestSettings.disabled = true;

      const ui = readSuggestSettingsFromUI();
      if (!ui.preamble) {
        setSuggestSettingsStatus("Preamble is required.", true);
        return;
      }

      // Prefer preamble_prompt_id, fallback to id if you ever use it
      const idToSend =
        (suggestSettings && (suggestSettings.preamble_prompt_id || suggestSettings.id)) || null;

      const saved = await saveSuggestSettings(currentSlug, {
        id: idToSend,
        ...ui,
      });

      if (saved) applySuggestSettingsToUI(saved);
      setSuggestSettingsStatus("Saved ✓");
    } catch (e) {
      console.error("[AIPromptManager] handleSaveSuggestSettings failed:", e);
      setSuggestSettingsStatus(`Save failed: ${e.message || "unknown"}`, true);
    } finally {
      els.btnSaveSuggestSettings.disabled = false;
    }
  }

  // =====================================================================
  // Rendering
  // =====================================================================

  function renderEmpty() {
    if (!els.list) return;
    els.list.innerHTML =
      `<div style="padding:14px; color:#64748b; font-size:13px;">No prompts found.</div>`;
  }

  function renderList(prompts) {
    if (!els.list) return;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      renderEmpty();
      return;
    }

    const sorted = [...prompts].sort((a, b) => {
      const ao = a.sort_order ?? 999999;
      const bo = b.sort_order ?? 999999;
      if (ao !== bo) return ao - bo;
      return Number(a.id) - Number(b.id);
    });

    els.list.innerHTML = sorted
      .map((p) => {
        const active = p.is_active !== false;
        const isDefault = !!p.is_default;
        const preview = clipPreview(p.prompt_text, 3, 460);

        return `
          <div class="row" data-id="${Number(p.id)}">
            <div style="min-width:0; flex:1;">
              <h3>${escHtml(p.name || "Untitled Prompt")}</h3>
              <div class="badges" style="margin-top:8px;">
                <span class="pill ${active ? "on" : ""}">
                  ${active ? "Active" : "Inactive"}
                </span>
                ${isDefault ? `<span class="pill default">Default</span>` : ""}
                ${p.sort_order != null ? `<span class="pill">Order: ${Number(p.sort_order)}</span>` : ""}
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
      })
      .join("");

    els.list.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".row");
        const id = Number(row?.getAttribute("data-id") || 0);
        if (!id) return;

        const action = String(btn.getAttribute("data-action") || "");
        const p = promptsCache.find((x) => Number(x.id) === id);

        if (action === "view" && p) openViewer(p);
        if (action === "edit" && p) openEditor(p);
        if (action === "del" && p) await handleDelete(p);
      });
    });
  }

  // =====================================================================
  // Viewer modal
  // =====================================================================

  function openViewer(p) {
    viewerPrompt = p;
    viewerPromptId = Number(p.id);

    if (els.viewerTitle) els.viewerTitle.textContent = p.name || "Prompt";
    if (els.viewerMeta) els.viewerMeta.textContent = `id=${p.id} • slug=${currentSlug}`;
    if (els.viewerText) els.viewerText.textContent = p.prompt_text || "";

    if (els.viewerOverlay) els.viewerOverlay.classList.add("show");
  }

  function closeViewer() {
    if (els.viewerOverlay) els.viewerOverlay.classList.remove("show");
    viewerPromptId = null;
    viewerPrompt = null;
  }

  // =====================================================================
  // Editor modal
  // =====================================================================

  function openEditor(pOrNull) {
    showEditError("");

    if (!els.editOverlay || !els.promptName || !els.promptText || !els.promptLanguage || !els.promptNotes) {
      console.error("[AIPromptManager] openEditor missing DOM refs");
      return;
    }

    if (pOrNull) {
      editPromptId = Number(pOrNull.id);
      if (els.editTitle) els.editTitle.textContent = "Edit Prompt";
      if (els.editMeta) els.editMeta.textContent = `id=${pOrNull.id} • slug=${currentSlug}`;
      els.promptName.value = pOrNull.name || "";
      els.promptText.value = pOrNull.prompt_text || "";
      els.promptLanguage.value = pOrNull.language || "";
      els.promptNotes.value = pOrNull.notes || "";
    } else {
      editPromptId = null;
      if (els.editTitle) els.editTitle.textContent = "Add Prompt";
      if (els.editMeta) els.editMeta.textContent = `slug=${currentSlug}`;
      els.promptName.value = "";
      els.promptText.value = "";
      els.promptLanguage.value = "";
      els.promptNotes.value = "";
    }

    // Apply metric checkboxes based on embedded block (or placeholder scan)
    const selectedKeys = parseMetricsFromPromptText(els.promptText.value || "");
    document.querySelectorAll("input.mssMetric").forEach((cb) => {
      cb.checked = selectedKeys.includes(cb.value);
    });
    document.querySelectorAll("input.optMetric").forEach((cb) => {
      cb.checked = selectedKeys.includes(cb.value);
    });

    // Ensure prompt text has an up-to-date metrics block
    syncMetricsIntoPromptText();

    els.editOverlay.classList.add("show");
    setTimeout(() => els.promptName.focus(), 0);
  }

  function closeEditor() {
    if (els.editOverlay) els.editOverlay.classList.remove("show");
    editPromptId = null;
    showEditError("");
  }

  // =====================================================================
  // CRUD handlers
  // =====================================================================

  async function handleDelete(p) {
    const ok = await confirmModal(
      "Delete AI Prompt",
      `Delete this prompt?\n\n"${p.name || "Untitled Prompt"}"\n\nThis cannot be undone.`,
      "Delete"
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

    const name = String(els.promptName?.value || "").trim();
    const prompt_text = String(els.promptText?.value || "").trim();
    const language = String(els.promptLanguage?.value || "").trim();
    const notes = String(els.promptNotes?.value || "").trim();

    if (!name) return showEditError("Prompt Name is required.");
    if (!prompt_text) return showEditError("Prompt Text is required.");

    const payload = { name, prompt_text, notes, language };

    try {
      setStatus("Saving…");
      if (els.btnSave) els.btnSave.disabled = true;

      if (editPromptId == null) {
        const saved = await createPrompt(currentSlug, payload);
        if (saved?.id) editPromptId = Number(saved.id);
      } else {
        await updatePrompt(currentSlug, editPromptId, payload);
      }

      await refresh();
      setStatus("Saved ✓");
    } catch (e) {
      showEditError(`Save failed: ${e.message || "unknown"}`);
    } finally {
      if (els.btnSave) els.btnSave.disabled = false;
    }
  }

  // =====================================================================
  // Suggest handler
  // =====================================================================

  async function handleSuggest() {
    showEditError("");

    const inputs = collectSuggestInputs();
    const problem = validateSuggestInputs(inputs);
    if (problem) {
      showModal("Suggest AI Prompt", problem);
      return;
    }

    // Prefer settings defaults if inputs are blank
    const defaults = suggestSettings || {};
    const language = inputs.helperLanguage || defaults.default_language || "";
    const notes = inputs.notes || defaults.default_notes || "";

    // Metrics: prefer explicit selection; fallback to Suggest Settings defaults
    const selected_metrics = [...(inputs.mss || []), ...(inputs.opt || [])];
    const metricsToSend =
      selected_metrics.length > 0
        ? selected_metrics
        : (Array.isArray(defaults.default_metrics) ? defaults.default_metrics : []);

    try {
      setStatus("Suggesting…");
      if (els.btnSuggest) els.btnSuggest.disabled = true;

      const { text } = await suggestPrompt(currentSlug, {
        language,
        notes,
        selected_metrics: metricsToSend,
      });

      if (!text) {
        showModal("Suggest AI Prompt", "Suggest returned empty prompt_text.");
        return;
      }

      // Apply to editor
      if (els.promptText) {
        els.promptText.value = text;
        // Keep metrics block consistent after apply (if any checkboxes are selected)
        syncMetricsIntoPromptText();
      }

      setStatus("Suggestion applied.");
    } catch (err) {
      console.error("[AIPromptManager] handleSuggest failed", err);
      showModal("Suggest AI Prompt", `Suggest failed: ${err?.message || "error"}`);
    } finally {
      if (els.btnSuggest) els.btnSuggest.disabled = false;
    }
  }

  // =====================================================================
  // Refresh (prompts list)
  // =====================================================================

  async function loadPrompts(slug) {
  const data = await apiJson(
    `/api/admin/ai-prompts/${encodeURIComponent(slug)}`,
    { method: "GET" }
  );
  return Array.isArray(data.prompts) ? data.prompts : [];
}

  // =====================================================================
  // Close behaviour
  // =====================================================================

  function handleClosePage() {
    try {
      window.close();
    } catch {
      /* noop */
    }
    window.location.href = `/admin/SchoolPortal.html?slug=${encodeURIComponent(currentSlug)}`;
  }
// =====================================================================
// Refresh (prompts list)
// =====================================================================
async function refresh() {
  const prompts = await loadPrompts(currentSlug);
  promptsCache = prompts;
  renderList(promptsCache);
}
  // =====================================================================
  // Init
  // =====================================================================

  async function init() {
  // Canonical slug is established by MSSClient.bootGuard() once.
if (!currentSlug) {
  setStatus("Missing slug in session (bootGuard.slug).", true);
  renderEmpty();
  return;
}

// Keep URL in sync (useful for deep links / refresh)
updateSlugInUrl(currentSlug);
  // Keep URL in sync with canonical scope (prevents missing_school_scope)
  updateSlugInUrl(currentSlug);

  if (els.meta) els.meta.textContent = `slug=${currentSlug || "—"}`;

  if (!currentSlug) {
    setStatus("Missing slug in URL/session.", true);
    renderEmpty();
    return;
  }
    // Build UI scaffolding
    buildVarChecklist();
    buildSuggestChecklists();
    renderSuggestDefaultMetricsChecklist(); // safe if section exists

    // Wire buttons/events
    els.btnAdd?.addEventListener("click", () => openEditor(null));
    els.btnClose?.addEventListener("click", handleClosePage);
    els.btnCloseX?.addEventListener("click", handleClosePage);

    els.viewerClose?.addEventListener("click", closeViewer);
    els.viewerClose2?.addEventListener("click", closeViewer);
    els.viewerOverlay?.addEventListener("click", (e) => {
      if (e.target === els.viewerOverlay) closeViewer();
    });

    els.viewerEdit?.addEventListener("click", () => {
      if (!viewerPrompt) return;
      const p = viewerPrompt;
      closeViewer();
      openEditor(p);
    });

    els.editClose?.addEventListener("click", closeEditor);
    els.btnCancel?.addEventListener("click", closeEditor);
    els.btnSave?.addEventListener("click", handleSave);
    els.btnSuggest?.addEventListener("click", handleSuggest);

    els.editOverlay?.addEventListener("click", (e) => {
      if (e.target === els.editOverlay) closeEditor();
    });

    // Metric checkbox -> keep metrics block in sync
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t && (t.classList.contains("mssMetric") || t.classList.contains("optMetric"))) {
        syncMetricsIntoPromptText();
      }
    });

    // Suggest Settings save wiring (optional section)
    els.btnSaveSuggestSettings?.addEventListener("click", handleSaveSuggestSettings);

    // Load Suggest Settings once (optional section)
    await refreshSuggestSettings();

    // Load prompts list
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