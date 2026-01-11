/* public/js/notes-widget.js
   Notes Widget (v1) — DOM + state wiring for Notes blocks

   Requirements:
   - Caller provides:
     - api: { list(), create(), update?(), remove?() }  (your notes-api.js instance)
     - getEntity(): returns { type, id, label }
     - els: map of element IDs (from your HTML)
     - setStatus(msg, ok) optional
*/

(function () {
  "use strict";

  function byId(id) { return id ? document.getElementById(id) : null; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Normalizes returned note rows from sp_notes_for_entity (defensive)
  function normNote(n) {
    if (!n || typeof n !== "object") return null;
    const noteId =
      n.note_id != null ? Number(n.note_id) :
      n.id != null ? Number(n.id) :
      n.noteId != null ? Number(n.noteId) : null;

    // Canonical "body" field per your POST route
    const body =
      n.body != null ? String(n.body) :
      n.text != null ? String(n.text) :
      n.note_body != null ? String(n.note_body) : "";

    const createdAt = n.created_at || n.createdAt || n.created || null;
    const updatedAt = n.updated_at || n.updatedAt || null;
    const dueAt = n.due_at || n.dueAt || null;
    const status = n.status || n.note_status || null;

    // We’ll treat pinned as: meta.pinned === true OR tags includes "pinned"
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const meta = (n.meta && typeof n.meta === "object") ? n.meta : {};
    const isPinned = !!(meta.pinned === true || tags.includes("pinned"));

    return {
      raw: n,
      note_id: noteId,
      body,
      created_at: createdAt,
      updated_at: updatedAt,
      due_at: dueAt,
      status,
      tags,
      meta,
      is_pinned: isPinned
    };
  }

  function fmtMetaLine(note) {
    const parts = [];
    if (note.is_pinned) parts.push("Pinned");
    if (note.status) parts.push("status: " + note.status);
    if (note.due_at) parts.push("due: " + note.due_at);
    if (note.created_at) parts.push("created: " + note.created_at);
    return parts.length ? parts.join(" • ") : "—";
  }

  function mountNotesWidget(opts) {
    if (!opts || typeof opts !== "object") throw new Error("missing_opts");
    const api = opts.api;
    const getEntity = opts.getEntity;
    const els = opts.els || {};
    const setStatus = typeof opts.setStatus === "function"
      ? opts.setStatus
      : function () {};

    if (!api || typeof api.list !== "function" || typeof api.create !== "function") {
      throw new Error("notes_api_missing_list_or_create");
    }
    if (typeof getEntity !== "function") throw new Error("missing_getEntity");

    // Resolve DOM
    const $openBtn = byId(els.openBtn);
    const $countPill = byId(els.countPill);

    const $quickText = byId(els.quickText);
    const $quickPinned = byId(els.quickPinned);
    const $quickAddBtn = byId(els.quickAddBtn);
    const $quickClearBtn = byId(els.quickClearBtn);

    const $previewEmpty = byId(els.previewEmpty);
    const $previewBox = byId(els.previewBox);
    const $previewText = byId(els.previewText);
    const $previewMeta = byId(els.previewMeta);
    const $previewPinned = byId(els.previewPinned);
    const $previewEditBtn = byId(els.previewEditBtn);
    const $previewOpenBtn = byId(els.previewOpenBtn);

    const $mask = byId(els.modalMask);
    const $closeBtn = byId(els.modalCloseBtn);
    const $doneBtn = byId(els.modalDoneBtn);
    const $refreshBtn = byId(els.modalRefreshBtn);
    const $contextLabel = byId(els.modalContextLabel);
    const $totalPill = byId(els.modalTotalPill);
    const $list = byId(els.modalList);

    const $formTitle = byId(els.formTitle);
    const $editingPill = byId(els.formEditingPill);
    const $formText = byId(els.formText);
    const $formPinned = byId(els.formPinned);
    const $formSaveBtn = byId(els.formSaveBtn);
    const $formCancelBtn = byId(els.formCancelBtn);

    const $prevBtn = byId(els.notesPrevBtn);
    const $nextBtn = byId(els.notesNextBtn);

    const $delMask = byId(els.delMask);
    const $delMeta = byId(els.delMeta);
    const $delText = byId(els.delText);
    const $delConfirmBtn = byId(els.delConfirmBtn);
    const $delCancelBtn1 = byId(els.delCancelBtn1);
    const $delCancelBtn2 = byId(els.delCancelBtn2);

    // Internal state
    const state = {
      entityType: null,
      entityId: null,
      label: null,

      // paging
      limit: 50,
      offset: 0,

      // current data
      notes: [],
      total: 0,
      preview: null,

      // edit mode
      editingNoteId: null,

      // delete confirm
      deletingNote: null,

      // lifecycle
      mounted: true
    };

    function setEnabled(el, enabled) {
      if (!el) return;
      el.disabled = !enabled;
    }

    function closeModal() {
      if ($mask) $mask.style.display = "none";
    }
    function openModal() {
      if ($mask) $mask.style.display = "flex";
    }
    function closeDelete() {
      if ($delMask) $delMask.style.display = "none";
      state.deletingNote = null;
      if ($delConfirmBtn) $delConfirmBtn.disabled = true;
    }
    function openDelete() {
      if ($delMask) $delMask.style.display = "flex";
    }

    function getCurrentEntityOrNull() {
      const e = getEntity() || {};
      const type = String(e.type || "").trim();
      const id = Number(e.id || 0);
      const label = String(e.label || "").trim();
      if (!type || !Number.isFinite(id) || id <= 0) return null;
      return { type, id, label };
    }

    function clearUIForNoEntity() {
      state.entityType = null;
      state.entityId = null;
      state.label = null;

      if ($countPill) $countPill.textContent = "notes: —";
      setEnabled($openBtn, false);

      if ($previewEmpty) $previewEmpty.style.display = "block";
      if ($previewBox) $previewBox.style.display = "none";

      if ($previewText) $previewText.textContent = "—";
      if ($previewMeta) $previewMeta.textContent = "—";
      if ($previewPinned) $previewPinned.style.display = "none";

      setEnabled($previewEditBtn, false);
      setEnabled($previewOpenBtn, false);

      // quick add disabled without selected entity
      setEnabled($quickAddBtn, false);
      setEnabled($quickClearBtn, false);

      if ($list) $list.innerHTML = '<div class="muted">Select an entity to view notes.</div>';
      if ($totalPill) $totalPill.textContent = "total: —";
      if ($contextLabel) $contextLabel.textContent = "—";
      setEnabled($refreshBtn, false);
      setEnabled($prevBtn, false);
      setEnabled($nextBtn, false);

      resetForm();
    }

    function resetForm() {
      state.editingNoteId = null;
      if ($formTitle) $formTitle.textContent = "Add note";
      if ($editingPill) { $editingPill.style.display = "none"; $editingPill.textContent = "editing: —"; }
      if ($formText) $formText.value = "";
      if ($formPinned) $formPinned.checked = false;
      setEnabled($formCancelBtn, false);
      setEnabled($formSaveBtn, false);
    }

    function setFormEdit(note) {
      state.editingNoteId = note.note_id;
      if ($formTitle) $formTitle.textContent = "Edit note";
      if ($editingPill) {
        $editingPill.style.display = "inline-flex";
        $editingPill.textContent = "editing: " + note.note_id;
      }
      if ($formText) $formText.value = note.body || "";
      if ($formPinned) $formPinned.checked = !!note.is_pinned;
      setEnabled($formCancelBtn, true);
      setEnabled($formSaveBtn, true);
    }

    function renderPreview(note) {
      state.preview = note || null;
      const has = !!note;

      if ($previewEmpty) $previewEmpty.style.display = has ? "none" : "block";
      if ($previewBox) $previewBox.style.display = has ? "block" : "none";

      if (!has) {
        setEnabled($previewEditBtn, false);
        setEnabled($previewOpenBtn, false);
        if ($previewPinned) $previewPinned.style.display = "none";
        return;
      }

      if ($previewPinned) $previewPinned.style.display = note.is_pinned ? "inline-flex" : "none";
      if ($previewMeta) $previewMeta.textContent = fmtMetaLine(note);
      if ($previewText) $previewText.textContent = note.body || "";

      // Edit enabled only if api.update exists
      setEnabled($previewEditBtn, typeof api.update === "function");
      setEnabled($previewOpenBtn, true);
    }

    function renderCount(total) {
      if ($countPill) $countPill.textContent = "notes: " + (Number.isFinite(total) ? String(total) : "—");
      setEnabled($openBtn, state.entityId != null);
    }

    function renderListItems(notes, total) {
      if (!$list) return;
      const safeNotes = Array.isArray(notes) ? notes : [];

      if ($totalPill) $totalPill.textContent = "total: " + (Number.isFinite(total) ? String(total) : String(safeNotes.length));
      if (!safeNotes.length) {
        $list.innerHTML = '<div class="muted">No notes yet.</div>';
        return;
      }

      // Minimal row layout that matches your existing CSS
      const html = safeNotes.map(function (n) {
        const pinnedPill = n.is_pinned ? '<span class="pill duty">Pinned</span>' : "";
        const metaLine = esc(fmtMetaLine(n));
        const body = esc(n.body || "");
        const id = n.note_id != null ? String(n.note_id) : "";

        const canEdit = typeof api.update === "function";
        const canDelete = typeof api.remove === "function";

        return (
          '<div class="tRow" data-note-id="' + esc(id) + '" style="cursor:default;">' +
            '<div class="tTop" style="align-items:flex-start;">' +
              '<div style="flex:1; min-width:0;">' +
                '<div class="row" style="gap:8px; align-items:center;">' +
                  pinnedPill +
                  '<div class="mono muted">' + metaLine + '</div>' +
                '</div>' +
                '<div style="margin-top:8px; white-space:pre-wrap;">' + body + '</div>' +
              '</div>' +
              '<div class="row" style="gap:8px; margin-left:10px; align-items:flex-start;">' +
                '<button class="btn small" data-act="edit" ' + (canEdit ? "" : "disabled") + '>Edit</button>' +
                '<button class="btn small" data-act="delete" ' + (canDelete ? "" : "disabled") + '>Delete</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("");

      $list.innerHTML = html;

      // wire row buttons
      var buttons = $list.querySelectorAll("button[data-act]");
      Array.prototype.forEach.call(buttons, function (btn) {
        btn.addEventListener("click", function (e) {
          const row = btn.closest(".tRow");
          const noteId = row ? Number(row.getAttribute("data-note-id") || 0) : 0;
          const act = btn.getAttribute("data-act");
          const note = state.notes.find(x => Number(x.note_id) === Number(noteId));
          if (!note) return;

          if (act === "edit") {
            if (typeof api.update !== "function") {
              setStatus("Edit not available yet (no update endpoint wired).", false);
              return;
            }
            setFormEdit(note);
            // keep modal open
            return;
          }

          if (act === "delete") {
            if (typeof api.remove !== "function") {
              setStatus("Delete not available yet (no delete endpoint wired).", false);
              return;
            }
            confirmDelete(note);
            return;
          }
        });
      });
    }

    async function loadPreviewAndCount() {
      const ent = getCurrentEntityOrNull();
      if (!ent) {
        clearUIForNoEntity();
        return;
      }

      state.entityType = ent.type;
      state.entityId = ent.id;
      state.label = ent.label;

      if ($contextLabel) $contextLabel.textContent = ent.label || ("#" + ent.id);

      setEnabled($refreshBtn, true);

      // Enable quick add buttons based on selection
      setEnabled($quickAddBtn, true);
      setEnabled($quickClearBtn, true);

      // Fetch first page and use first note as preview (assumes SP orders pinned/created desc)
      try {
        const out = await api.list({
          entityType: ent.type,
          entityId: ent.id,
          status: null,
          limit: 1,
          offset: 0
        });

        const rawNotes = (out && out.notes) ? out.notes : [];
        const notes = rawNotes.map(normNote).filter(Boolean);
        const total =
          (out && Number.isFinite(out.total)) ? out.total :
          (typeof out.count === "number") ? out.count :
          (notes.length);

        renderCount(total);
        renderPreview(notes.length ? notes[0] : null);
      } catch (e) {
        // Don’t break the page—just show empty state
        renderCount(0);
        renderPreview(null);
        setStatus("Notes preview failed: " + (e.message || "error"), false);
      }
    }

    async function loadListPage() {
      const ent = getCurrentEntityOrNull();
      if (!ent) {
        clearUIForNoEntity();
        return;
      }

      state.entityType = ent.type;
      state.entityId = ent.id;
      state.label = ent.label;

      if ($list) $list.innerHTML = '<div class="muted">Loading…</div>';

      try {
        const out = await api.list({
          entityType: ent.type,
          entityId: ent.id,
          status: null,
          limit: state.limit,
          offset: state.offset
        });

        // api.list may return raw rows, or {notes,total}
        const rawNotes = out && out.notes ? out.notes : (Array.isArray(out) ? out : []);
        const notes = rawNotes.map(normNote).filter(Boolean);

        const total =
          (out && Number.isFinite(out.total)) ? out.total :
          (out && Number.isFinite(out.count)) ? out.count :
          // If SP doesn’t return total, we approximate with current page
          notes.length;

        state.notes = notes;
        state.total = total;

        renderListItems(notes, total);

        // paging controls
        const hasPrev = state.offset > 0;
        const hasNext = (state.offset + state.limit) < total;
        setEnabled($prevBtn, hasPrev);
        setEnabled($nextBtn, hasNext);

        // Also refresh preview/count so the page stays consistent
        renderCount(total);
        renderPreview(notes.length ? notes[0] : null);

        setEnabled($refreshBtn, true);
      } catch (e) {
        if ($list) $list.innerHTML = '<div class="muted">Failed to load notes.</div>';
        setEnabled($prevBtn, false);
        setEnabled($nextBtn, false);
        setStatus("Notes list failed: " + (e.message || "error"), false);
      }
    }

    async function quickAdd() {
      const ent = getCurrentEntityOrNull();
      if (!ent) { setStatus("Select a teacher before adding notes.", false); return; }

      const body = ($quickText ? String($quickText.value || "").trim() : "");
      const pinned = !!($quickPinned && $quickPinned.checked);

      if (!body) { setStatus("Note body is required.", false); return; }

      // Encode pinned in meta to avoid schema changes; backend stores meta jsonb already.
      const meta = pinned ? { pinned: true } : {};

      setStatus("Adding note…", false);
      try {
        await api.create({
          entityType: ent.type,
          entityId: ent.id,
          body: body,
          dueAt: null,
          tags: [],
          meta: meta
        });

        if ($quickText) $quickText.value = "";
        if ($quickPinned) $quickPinned.checked = false;

        // After create: refresh preview/count; if modal open, refresh list
        await loadPreviewAndCount();
        if ($mask && $mask.style.display === "flex") {
          state.offset = 0;
          await loadListPage();
        }

        setStatus("Note added.", true);
      } catch (e) {
        setStatus("Add note failed: " + (e.message || "error"), false);
      }
    }

    function confirmDelete(note) {
      state.deletingNote = note;
      if ($delMeta) $delMeta.textContent = fmtMetaLine(note);
      if ($delText) $delText.textContent = note.body || "";
      if ($delConfirmBtn) $delConfirmBtn.disabled = false;
      openDelete();
    }

    async function doDelete() {
      const note = state.deletingNote;
      if (!note || !note.note_id) return;

      if (typeof api.remove !== "function") {
        setStatus("Delete not available yet (no delete endpoint wired).", false);
        return;
      }

      setStatus("Deleting note…", false);
      try {
        await api.remove({ noteId: note.note_id });
        closeDelete();
        resetForm();
        state.offset = 0;
        await loadListPage();
        await loadPreviewAndCount();
        setStatus("Note deleted.", true);
      } catch (e) {
        setStatus("Delete failed: " + (e.message || "error"), false);
      }
    }

    async function saveForm() {
      const ent = getCurrentEntityOrNull();
      if (!ent) { setStatus("Select a teacher first.", false); return; }

      const text = ($formText ? String($formText.value || "").trim() : "");
      const pinned = !!($formPinned && $formPinned.checked);

      if (!text) { setStatus("Note body is required.", false); return; }

      // If editingNoteId exists => update; else create
      const editingId = state.editingNoteId;

      // meta pinned in both create/update
      const meta = pinned ? { pinned: true } : {};

      try {
        if (editingId && typeof api.update === "function") {
          setStatus("Saving note…", false);
          await api.update({ noteId: editingId, body: text, meta: meta, tags: [] });
          resetForm();
          await loadListPage();
          await loadPreviewAndCount();
          setStatus("Note updated.", true);
          return;
        }

        // Create new note
        setStatus("Saving note…", false);
        await api.create({ entityType: ent.type, entityId: ent.id, body: text, dueAt: null, tags: [], meta: meta });
        resetForm();
        state.offset = 0;
        await loadListPage();
        await loadPreviewAndCount();
        setStatus("Note added.", true);
      } catch (e) {
        setStatus("Save failed: " + (e.message || "error"), false);
      }
    }

    function openAllNotes() {
      const ent = getCurrentEntityOrNull();
      if (!ent) { setStatus("Select a teacher to view notes.", false); return; }
      if ($contextLabel) $contextLabel.textContent = ent.label || ("#" + ent.id);
      openModal();
      state.offset = 0;
      loadListPage();
    }

    function bind() {
      // Open modal buttons
      if ($openBtn) $openBtn.addEventListener("click", openAllNotes);
      if ($previewOpenBtn) $previewOpenBtn.addEventListener("click", openAllNotes);

      // Preview edit -> open modal and load edit form
      if ($previewEditBtn) {
        $previewEditBtn.addEventListener("click", function () {
          if (!state.preview) return;
          if (typeof api.update !== "function") {
            setStatus("Edit not available yet (no update endpoint wired).", false);
            return;
          }
          openModal();
          state.offset = 0;
          loadListPage().then(function () {
            // After list loads, set edit mode for preview note
            const note = state.preview;
            if (note) setFormEdit(note);
          });
        });
      }

      // Close modal
      function closeIfMaskClick(e) {
        if (e.target === $mask) closeModal();
      }
      if ($mask) $mask.addEventListener("click", closeIfMaskClick);

      if ($closeBtn) $closeBtn.addEventListener("click", closeModal);
      if ($doneBtn) $doneBtn.addEventListener("click", closeModal);

      // Refresh
      if ($refreshBtn) $refreshBtn.addEventListener("click", loadListPage);

      // Quick add
      if ($quickAddBtn) $quickAddBtn.addEventListener("click", quickAdd);
      if ($quickClearBtn) {
        $quickClearBtn.addEventListener("click", function () {
          if ($quickText) $quickText.value = "";
          if ($quickPinned) $quickPinned.checked = false;
        });
      }

      // Enable quick add when typing
      if ($quickText) {
        $quickText.addEventListener("input", function () {
          const ent = getCurrentEntityOrNull();
          const hasEnt = !!ent;
          setEnabled($quickAddBtn, hasEnt);
          setEnabled($quickClearBtn, hasEnt);
        });
      }

      // Form save/cancel
      if ($formText) {
        $formText.addEventListener("input", function () {
          // Enable save when modal open and entity selected
          const ent = getCurrentEntityOrNull();
          const can = !!ent;
          setEnabled($formSaveBtn, can);
          setEnabled($formCancelBtn, state.editingNoteId != null);
        });
      }
      if ($formSaveBtn) $formSaveBtn.addEventListener("click", saveForm);
      if ($formCancelBtn) {
        $formCancelBtn.addEventListener("click", function () {
          resetForm();
          setEnabled($formCancelBtn, false);
        });
      }

      // Paging
      if ($prevBtn) {
        $prevBtn.addEventListener("click", function () {
          state.offset = Math.max(state.offset - state.limit, 0);
          loadListPage();
        });
      }
      if ($nextBtn) {
        $nextBtn.addEventListener("click", function () {
          state.offset = state.offset + state.limit;
          loadListPage();
        });
      }

      // Delete confirm modal
      function closeDelIfMaskClick(e) {
        if (e.target === $delMask) closeDelete();
      }
      if ($delMask) $delMask.addEventListener("click", closeDelIfMaskClick);
      if ($delCancelBtn1) $delCancelBtn1.addEventListener("click", closeDelete);
      if ($delCancelBtn2) $delCancelBtn2.addEventListener("click", closeDelete);
      if ($delConfirmBtn) $delConfirmBtn.addEventListener("click", doDelete);
    }

    // Public API for the page
    async function refresh() {
      // Called when the selected entity changes (teacher selection)
      resetForm();
      await loadPreviewAndCount();
    }

    function destroy() {
      state.mounted = false;
      // (v1) we are not removing listeners; OK for your current single-page usage.
    }

    // Init
    bind();
    clearUIForNoEntity();

    return { refresh, open: openAllNotes, close: closeModal, destroy };
  }

  // Expose globally
  window.MSSNotesWidget = {
    mountNotesWidget: mountNotesWidget
  };
})();