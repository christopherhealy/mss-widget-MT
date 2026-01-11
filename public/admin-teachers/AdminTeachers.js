"use strict";

(function () {
  function $(id) { return document.getElementById(id); }

  // ---------------------------------
  // Auth (AdminHome-compatible)
  // ---------------------------------
  const LS_SESSION_KEY = "mssAdminSession";
  const LS_TOKEN_KEY   = "mss_admin_token";
  const LS_LEGACY_KEY  = "mss_admin_key";

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function readAuthArtifact() {
    const sess = readJson(LS_SESSION_KEY);
    const sessToken = sess && (sess.token || sess.jwt || sess.access_token || sess.accessToken);
    if (sessToken && String(sessToken).trim()) {
      return { type: "token", value: String(sessToken).trim() };
    }

    const token = (localStorage.getItem(LS_TOKEN_KEY) || "").trim();
    if (token) return { type: "token", value: token };

    const legacy = (localStorage.getItem(LS_LEGACY_KEY) || "").trim();
    if (legacy) return { type: "legacy", value: legacy };

    return { type: "none", value: "" };
  }

  function setStatus(msg, ok) {
    const el = $("status");
    if (!el) return;
    el.textContent = (ok ? "✅ " : "⚠️ ") + (msg || "");
  }

  function authFailureHint(serverError) {
    if (serverError === "bad_token" || serverError === "token_expired") {
      return "Your admin session token is expired/invalid. Please log in again (Admin Home → Log out → Log in).";
    }
    if (serverError === "missing_bearer" || serverError === "missing_admin_auth") {
      return "Missing admin session. Please log in again.";
    }
    return "Please log in again.";
  }
async function adminFetch(url, opts = {}) {
  const auth = readAuthArtifact();
  if (auth.type === "none") {
    setStatus("Missing admin token/key. Please log in again.", false);
    throw new Error("missing_admin_auth");
  }

  const headers = new Headers(opts.headers || {});
  if (auth.type === "token") headers.set("Authorization", "Bearer " + auth.value);
  if (auth.type === "legacy") headers.set("x-admin-key", auth.value);

  let res;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e) {
    console.warn("[AdminTeachers] fetch threw", { url, opts, message: e?.message, e });
    setStatus("Network error calling API (fetch failed). Check Render/Vercel routing and service health.", false);
    throw e;
  }

  if (!res.ok) {
    let body = null;
    try { body = await res.clone().json(); } catch (_) {}
    console.warn("[AdminTeachers] HTTP error", res.status, url, body);

    const err = body && body.error ? String(body.error) : ("http_" + res.status);
    if (res.status === 401) setStatus(authFailureHint(err), false);
  }

  return res;
}

  // ---------------------------------
  // Slug
  // ---------------------------------
  const params = new URLSearchParams(window.location.search);
  const SLUG = (params.get("slug") || "").trim() || "mss-demo";
  if ($("slugPill")) $("slugPill").textContent = "slug: " + SLUG;

  // ---------------------------------
  // UI state
  // ---------------------------------
  let selectedTeacherId = null;
  let selectedTeacherRow = null;

  const cache = {
    teachers: [],
    onDutyTeacherId: null,
    onDuty: null
  };

  function esc(s) { return String(s == null ? "" : s); }

  function setControlsEnabled(enabled) {
    const saveBtn = $("saveBtn");
    const inviteBtn = $("inviteBtn");
    const deactivateBtn = $("deactivateBtn");

    if (saveBtn) saveBtn.disabled = !enabled;
    if (inviteBtn) inviteBtn.disabled = !enabled;
    if (deactivateBtn) deactivateBtn.disabled = !enabled;

    const setSelected = $("btnSetSelectedOnDuty");
    if (setSelected) setSelected.disabled = !enabled;

    // Notes controls
    if ($("openNotesBtn")) $("openNotesBtn").disabled = !enabled;
    if ($("addQuickNoteBtn")) $("addQuickNoteBtn").disabled = !enabled;
    if ($("clearQuickNoteBtn")) $("clearQuickNoteBtn").disabled = !enabled;
  }

  // ---------------------------------
  // Notes API (reusable client)
  // ---------------------------------
  const NotesApi = (function () {
    function buildListUrl({ slug, entityType, entityId, status, limit, offset }) {
      const qs = new URLSearchParams();
      qs.set("slug", slug);
      qs.set("entity_type", entityType);
      qs.set("entity_id", String(entityId));
      if (status) qs.set("status", status);
      qs.set("limit", String(limit || 50));
      qs.set("offset", String(offset || 0));
      qs.set("ts", String(Date.now()));
      return "/api/admin/notes?" + qs.toString();
    }

    async function list({ slug, entityType, entityId, status = null, limit = 50, offset = 0 }) {
      const url = buildListUrl({ slug, entityType, entityId, status, limit, offset });
      const res = await adminFetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || "notes_list_failed");
      return body.notes || [];
    }

    async function create({ slug, entityType, entityId, bodyText, dueAt = null, tags = [], meta = {} }) {
      const url = "/api/admin/notes?slug=" + encodeURIComponent(slug);
      const payload = {
        entity_type: entityType,
        entity_id: Number(entityId),
        body: String(bodyText || "").trim(),
        due_at: dueAt,
        tags,
        meta
      };
      const res = await adminFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) throw new Error(body.error || "notes_create_failed");
      return body.note_id;
    }

    // Placeholders for the future:
    // async function update(...) { ... }  // requires PUT route
    // async function remove(...) { ... }  // requires DELETE route

    return { list, create };
  })();

  // ---------------------------------
  // Notes Controller (Teacher-scoped)
  // ---------------------------------
  const NotesController = (function () {
    const ENTITY_TYPE = "teacher";

    let currentEntityId = null;
    let pageLimit = 50;
    let pageOffset = 0;
    let cachedNotes = [];

    // Helpers (row normalization aligned to your SP SELECT)
    function normNote(n) {
      if (!n || typeof n !== "object") return null;

      const meta = (n.meta && typeof n.meta === "object") ? n.meta : {};
      const tags = Array.isArray(n.tags) ? n.tags : [];

      const isPinned = !!(meta.pinned === true || tags.includes("pinned"));

      return {
        raw: n,
        id: n.id != null ? Number(n.id) : null,
        body: n.body != null ? String(n.body) : "",
        status: n.status != null ? String(n.status) : null,
        due_at: n.due_at || null,
        done_at: n.done_at || null,
        tags,
        meta,
        is_pinned: isPinned,
        created_by_name: n.created_by_name != null ? String(n.created_by_name) : null,
        created_by_email: n.created_by_email != null ? String(n.created_by_email) : null,
        created_at: n.created_at || null,
        updated_at: n.updated_at || null,
        total_count: (n.total_count != null && Number.isFinite(Number(n.total_count))) ? Number(n.total_count) : null
      };
    }

    function fmtMetaLine(note) {
      const parts = [];
      if (note.is_pinned) parts.push("Pinned");
      if (note.status) parts.push("status: " + note.status);
      if (note.due_at) parts.push("due: " + note.due_at);

      if (note.created_by_name || note.created_by_email) {
        const who = [note.created_by_name || "", note.created_by_email || ""].filter(Boolean).join(" ");
        parts.push("by: " + who);
      }
      if (note.created_at) parts.push("created: " + note.created_at);
      if (note.updated_at) parts.push("updated: " + note.updated_at);
      if (note.done_at) parts.push("done: " + note.done_at);

      return parts.length ? parts.join(" • ") : "—";
    }

    function teacherLabel() {
      const name = ($("fullName")?.value || "").trim();
      const email = ($("email")?.value || "").trim();
      return (name || email || ("teacher_id=" + String(currentEntityId || "—")));
    }

    // --- UI wiring

    function setNotesPills(total, latestNote) {
      if ($("notesCountPill")) $("notesCountPill").textContent = "notes: " + (total != null ? String(total) : "—");
      if ($("notesTotalPill")) $("notesTotalPill").textContent = "total: " + (total != null ? String(total) : "—");

      // "Most recent" preview
      if (!latestNote) {
        if ($("notesPreviewEmpty")) $("notesPreviewEmpty").style.display = "block";
        if ($("notesPreview")) $("notesPreview").style.display = "none";
        return;
      }

      if ($("notesPreviewEmpty")) $("notesPreviewEmpty").style.display = "none";
      if ($("notesPreview")) $("notesPreview").style.display = "block";

      if ($("notesPreviewPinned")) $("notesPreviewPinned").style.display = latestNote.is_pinned ? "inline-flex" : "none";
      if ($("notesPreviewMeta")) $("notesPreviewMeta").textContent = fmtMetaLine(latestNote);
      if ($("notesPreviewText")) $("notesPreviewText").textContent = latestNote.body || "—";

      // Buttons are enabled once we have entity context; edit/delete require routes (future)
      if ($("notesPreviewEditBtn")) $("notesPreviewEditBtn").disabled = true;   // update route not present yet
      if ($("notesPreviewOpenBtn")) $("notesPreviewOpenBtn").disabled = false;  // opens modal
    }

    function setNotesContextUI(enabled) {
      if ($("openNotesBtn")) $("openNotesBtn").disabled = !enabled;
      if ($("addQuickNoteBtn")) $("addQuickNoteBtn").disabled = !enabled;
      if ($("clearQuickNoteBtn")) $("clearQuickNoteBtn").disabled = !enabled;

      if ($("notesRefreshBtn")) $("notesRefreshBtn").disabled = !enabled;
      if ($("notesPrevBtn")) $("notesPrevBtn").disabled = !enabled;
      if ($("notesNextBtn")) $("notesNextBtn").disabled = !enabled;

      if ($("notesFormSaveBtn")) $("notesFormSaveBtn").disabled = !enabled;
      if ($("notesFormCancelBtn")) $("notesFormCancelBtn").disabled = !enabled;

      if ($("notesDeleteConfirmBtn")) $("notesDeleteConfirmBtn").disabled = true; // delete route not present yet
    }

    function openNotesModal() {
      if ($("notesMask")) $("notesMask").style.display = "flex";
      if ($("notesTeacherLabel")) $("notesTeacherLabel").textContent = teacherLabel();
      if ($("notesContextLine")) $("notesContextLine").style.display = "block";
      if ($("notesList")) $("notesList").innerHTML = '<div class="muted">Loading…</div>';
    }

    function closeNotesModal() {
      if ($("notesMask")) $("notesMask").style.display = "none";
    }

    function renderNotesList(notes) {
      const el = $("notesList");
      if (!el) return;

      if (!notes.length) {
        el.innerHTML = '<div class="muted">No notes found.</div>';
        return;
      }

      const html = notes.map(n => {
        const pinnedChip = n.is_pinned ? '<span class="pill duty">Pinned</span>' : "";
        const metaLine = esc(fmtMetaLine(n));
        const body = esc(n.body || "");

        // Delete/Edit buttons are placeholders until routes exist
        return (
          '<div class="tRow" style="cursor:default;" data-note-id="' + esc(n.id) + '">' +
            '<div class="tTop" style="align-items:flex-start;">' +
              '<div style="flex:1; min-width:0;">' +
                '<div class="row" style="gap:8px; align-items:center;">' +
                  pinnedChip +
                  '<div class="mono muted">' + metaLine + '</div>' +
                '</div>' +
                '<div style="margin-top:8px; white-space:pre-wrap;">' + body + '</div>' +
              '</div>' +
              '<div class="row" style="gap:8px; margin-left:10px;">' +
                '<button class="btn small" type="button" disabled title="Edit requires notes update route">Edit</button>' +
                '<button class="btn small" type="button" disabled title="Delete requires notes delete route">Delete</button>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("");

      el.innerHTML = html;
    }

    async function refreshPreviewAndCounts() {
      if (!currentEntityId) {
        setNotesPills(null, null);
        return;
      }

      // For preview we only need first page
      const rows = await NotesApi.list({
        slug: SLUG,
        entityType: ENTITY_TYPE,
        entityId: currentEntityId,
        status: null,
        limit: 10,
        offset: 0
      });

      const notes = rows.map(normNote).filter(Boolean);

      // Total count if SP provides total_count; else fall back to notes.length (best effort)
      const total = notes.length && notes[0].total_count != null ? notes[0].total_count : (rows.length || 0);

      // Choose "most recent" as the first row from the SP ordering
      const latest = notes.length ? notes[0] : null;

      setNotesPills(total, latest);
    }

    async function refreshModalList() {
      if (!currentEntityId) return;

      const rows = await NotesApi.list({
        slug: SLUG,
        entityType: ENTITY_TYPE,
        entityId: currentEntityId,
        status: null,
        limit: pageLimit,
        offset: pageOffset
      });

      cachedNotes = rows.map(normNote).filter(Boolean);

      const total =
        cachedNotes.length && cachedNotes[0].total_count != null
          ? cachedNotes[0].total_count
          : (cachedNotes.length || 0);

      if ($("notesTotalPill")) $("notesTotalPill").textContent = "total: " + String(total);

      renderNotesList(cachedNotes);

      // Paging (best effort; if total_count not present, just disable next)
      const hasPrev = pageOffset > 0;
      const hasNext = (cachedNotes.length === pageLimit) && (cachedNotes[0]?.total_count != null ? (pageOffset + pageLimit < total) : true);

      if ($("notesPrevBtn")) $("notesPrevBtn").disabled = !hasPrev;
      if ($("notesNextBtn")) $("notesNextBtn").disabled = !hasNext;
    }

    async function addQuickNote() {
      if (!currentEntityId) return;

      const txt = ($("noteQuickText")?.value || "").trim();
      const pinned = !!$("noteQuickPinned")?.checked;

      if (!txt) { setStatus("Note body is required.", false); return; }

      setStatus("Saving note…", false);

      try {
        await NotesApi.create({
          slug: SLUG,
          entityType: ENTITY_TYPE,
          entityId: currentEntityId,
          bodyText: txt,
          dueAt: null,
          tags: pinned ? ["pinned"] : [],
          meta: { pinned: pinned }
        });

        if ($("noteQuickText")) $("noteQuickText").value = "";
        if ($("noteQuickPinned")) $("noteQuickPinned").checked = false;

        await refreshPreviewAndCounts();
        setStatus("Note saved.", true);
      } catch (e) {
        setStatus("Note save failed: " + (e.message || "error"), false);
      }
    }

    async function openModalAndLoad() {
      if (!currentEntityId) return;
      openNotesModal();
      try {
        if ($("notesTeacherLabel")) $("notesTeacherLabel").textContent = teacherLabel();
        await refreshModalList();
      } catch (e) {
        if ($("notesList")) $("notesList").innerHTML = '<div class="muted">Failed to load notes.</div>';
        setStatus("Notes load failed: " + (e.message || "error"), false);
      }
    }

    function clearQuick() {
      if ($("noteQuickText")) $("noteQuickText").value = "";
      if ($("noteQuickPinned")) $("noteQuickPinned").checked = false;
    }

    function bindUiOnce() {
      // At-a-glance buttons
      $("openNotesBtn")?.addEventListener("click", openModalAndLoad);
      $("notesPreviewOpenBtn")?.addEventListener("click", openModalAndLoad);

      // Quick add controls
      $("addQuickNoteBtn")?.addEventListener("click", addQuickNote);
      $("clearQuickNoteBtn")?.addEventListener("click", clearQuick);

      // Modal close buttons
      $("notesCloseBtn")?.addEventListener("click", closeNotesModal);
      $("notesDoneBtn")?.addEventListener("click", closeNotesModal);

      $("notesMask")?.addEventListener("click", function (e) {
        if (e.target === $("notesMask")) closeNotesModal();
      });

      // Modal refresh + paging
      $("notesRefreshBtn")?.addEventListener("click", function () {
        refreshModalList().catch(() => {});
      });

      $("notesPrevBtn")?.addEventListener("click", function () {
        pageOffset = Math.max(pageOffset - pageLimit, 0);
        refreshModalList().catch(() => {});
      });

      $("notesNextBtn")?.addEventListener("click", function () {
        pageOffset = pageOffset + pageLimit;
        refreshModalList().catch(() => {});
      });

      // Note: edit/delete wiring will be enabled once you add PUT/DELETE routes.
    }

    // Public entry point: called whenever selected teacher changes
    async function setEntity(entityId) {
      currentEntityId = Number(entityId || 0) || null;
      pageOffset = 0;
      cachedNotes = [];

      const enabled = !!currentEntityId;

      // Context line
      if ($("notesTeacherLabel")) $("notesTeacherLabel").textContent = teacherLabel();

      setNotesContextUI(enabled);
      await refreshPreviewAndCounts();
    }

    return { bindUiOnce, setEntity, openModalAndLoad };
  })();

  // ---------------------------------
  // Teachers List rendering
  // ---------------------------------
  function teacherRowHtml(t) {
    const name = t.full_name || "(No name)";
    const email = t.email || "";
    const active = !!t.is_active;
    const onDuty = !!t.is_on_duty;

    return (
      '<div class="tRow" data-id="' + t.id + '">' +
        '<div class="tTop">' +
          '<div>' +
            '<div class="tName">' + esc(name) + '</div>' +
            '<div class="tEmail">' + esc(email) + '</div>' +
          '</div>' +
          '<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">' +
            '<div class="pill ' + (active ? "on" : "off") + '">' + (active ? "Active" : "Inactive") + "</div>" +
            (onDuty ? '<div class="pill duty">On Duty</div>' : "") +
          "</div>" +
        "</div>" +
        '<div class="tMeta mono">id: ' + esc(t.id) + "</div>" +
      "</div>"
    );
  }

  function renderList(list) {
    cache.teachers = Array.isArray(list) ? list : [];
    const el = $("teacherList");
    if (!el) return;

    if (!cache.teachers.length) {
      el.innerHTML = '<div class="muted">No teachers found.</div>';
      return;
    }

    el.innerHTML = cache.teachers.map(teacherRowHtml).join("");

    const rows = el.querySelectorAll(".tRow");
    Array.prototype.forEach.call(rows, function (r) {
      r.addEventListener("click", function () {
        const id = Number(r.getAttribute("data-id") || 0);
        selectTeacher(id, r);
      });
    });
  }

  function setDetailVisible(show) {
    if ($("detailEmpty")) $("detailEmpty").style.display = show ? "none" : "block";
    if ($("detail")) $("detail").style.display = show ? "block" : "none";
  }

  function updatePills(t) {
    if ($("teacherIdPill")) $("teacherIdPill").textContent = "id: " + (t && t.id ? t.id : "—");

    const active = !!(t && t.is_active);
    const activePill = $("activePill");
    if (activePill) {
      activePill.textContent = active ? "Active" : "Inactive";
      activePill.className = "pill " + (active ? "on" : "off");
    }

    const dutyPill = $("dutyPill");
    if (dutyPill) dutyPill.style.display = (t && t.is_on_duty) ? "inline-flex" : "none";

    const deactivateBtn = $("deactivateBtn");
    if (deactivateBtn) deactivateBtn.textContent = active ? "Deactivate" : "Reactivate";
  }

  function loadDetailFromTeacher(t) {
    selectedTeacherId = Number(t.id || 0);

    if ($("fullName")) $("fullName").value = t.full_name || "";
    if ($("email")) $("email").value = t.email || "";
    if ($("isActive")) $("isActive").checked = !!t.is_active;

    const isOnDuty = !!(cache.onDutyTeacherId && Number(cache.onDutyTeacherId) === Number(t.id));
    if ($("isOnDuty")) $("isOnDuty").checked = isOnDuty;

    updatePills({ ...t, is_on_duty: isOnDuty });
    setDetailVisible(true);
    setControlsEnabled(true);

    // IMPORTANT: set notes entity context to THIS teacher only
    NotesController.setEntity(selectedTeacherId).catch(() => {});
  }

  function selectTeacher(id, rowEl) {
    if (!id) return;

    if (selectedTeacherRow) selectedTeacherRow.classList.remove("sel");
    selectedTeacherRow = rowEl;
    if (selectedTeacherRow) selectedTeacherRow.classList.add("sel");

    const t = cache.teachers.find(x => Number(x.id) === Number(id));
    if (!t) {
      setStatus("Teacher not found in list (refresh).", false);
      return;
    }

    loadDetailFromTeacher(t);
  }

  // ---------------------------------
  // On-duty panel UI helpers
  // ---------------------------------
  function renderOnDutyEmptyState() {
    const name = $("onDutyName");
    const email = $("onDutyEmail");
    const idPill = $("onDutyId");
    const since = $("onDutySince");

    if (name) name.textContent = "No teacher is on duty";
    if (email) email.textContent = "";
    if (idPill) idPill.textContent = "id: —";
    if (since) since.textContent = "since: —";
  }

  function renderOnDuty(onDuty) {
    const name = $("onDutyName");
    const email = $("onDutyEmail");
    const idPill = $("onDutyId");
    const since = $("onDutySince");

    if (!name && !email && !idPill && !since) return;

    if (!onDuty) return renderOnDutyEmptyState();

    if (name) name.textContent = (onDuty.full_name || onDuty.email || "On-duty teacher");
    if (email) email.textContent = onDuty.email ? ("(" + onDuty.email + ")") : "";
    if (idPill) idPill.textContent = "id: " + (onDuty.id != null ? onDuty.id : "—");

    const sinceVal = onDuty.on_duty_since || onDuty.created_at || "";
    if (since) since.textContent = "since: " + (sinceVal ? String(sinceVal) : "—");
  }

  // ---------------------------------
  // API calls (Teachers / On-duty)
  // ---------------------------------
  async function fetchOnDuty() {
    try {
      const url = "/api/admin/teachers/on-duty?slug=" + encodeURIComponent(SLUG) + "&ts=" + Date.now();
      const res = await adminFetch(url, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || body.ok === false) {
        cache.onDuty = null;
        cache.onDutyTeacherId = null;
        renderOnDutyEmptyState();
        return;
      }

      const onDuty = body.onDuty || null;
      cache.onDuty = onDuty;
      cache.onDutyTeacherId = (onDuty && onDuty.id) ? Number(onDuty.id) : null;

      renderOnDuty(onDuty);
    } catch (_) {
      cache.onDuty = null;
      cache.onDutyTeacherId = null;
      renderOnDutyEmptyState();
    }
  }

  async function fetchTeachers() {
    const q = ($("q")?.value || "").trim();
    const activeOnly = !!$("activeOnly")?.checked;

    const url =
      "/api/admin/teachers?slug=" + encodeURIComponent(SLUG) +
      "&q=" + encodeURIComponent(q) +
      "&activeOnly=" + (activeOnly ? "1" : "0") +
      "&limit=200&offset=0&ts=" + Date.now();

    setStatus("Loading teachers…", false);

    const res = await adminFetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || body.ok === false) {
      setStatus("Failed to load teachers.", false);
      await fetchOnDuty();
      return;
    }

    renderList(body.teachers || []);
    await fetchOnDuty();

    setStatus("Loaded " + (Array.isArray(body.teachers) ? body.teachers.length : 0) + " teachers", true);

    // Keep selected teacher’s duty checkbox accurate
    if (selectedTeacherId) {
      const t = cache.teachers.find(x => Number(x.id) === Number(selectedTeacherId));
      if (t) loadDetailFromTeacher(t);
    }
  }

  async function upsertTeacherCore(teacherId, email, fullName, isActive) {
    const payload = {
      teacher_id: teacherId || undefined,
      email,
      full_name: fullName || null,
      is_active: !!isActive
    };

    const url = "/api/admin/teachers?slug=" + encodeURIComponent(SLUG);

    const res = await adminFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "upsert_failed");
    return body.teacher;
  }

  async function setOnDutyTeacher(teacherIdOrNull) {
    const url = "/api/admin/teachers/on-duty?slug=" + encodeURIComponent(SLUG);
    const payload = teacherIdOrNull
      ? { teacher_id: Number(teacherIdOrNull), is_on_duty: true }
      : { is_on_duty: false };

    const res = await adminFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "on_duty_failed");
    return body.onDuty || null;
  }

  // ---------------------------------
  // Actions (Teachers)
  // ---------------------------------
  async function saveTeacher() {
    if (!selectedTeacherId) return;

    const email = ($("email")?.value || "").trim();
    const fullName = ($("fullName")?.value || "").trim();
    const isActive = !!$("isActive")?.checked;
    const wantsOnDuty = !!$("isOnDuty")?.checked;

    if (!email) { setStatus("Email is required.", false); return; }
    if (!isActive && wantsOnDuty) { setStatus("Cannot set On Duty while inactive. Activate first.", false); return; }

    setStatus("Saving teacher…", false);

    try {
      const saved = await upsertTeacherCore(selectedTeacherId, email, fullName, isActive);

      const currentlyOnDuty = !!(cache.onDutyTeacherId && Number(cache.onDutyTeacherId) === Number(selectedTeacherId));
      if (wantsOnDuty && !currentlyOnDuty) await setOnDutyTeacher(selectedTeacherId);
      if (!wantsOnDuty && currentlyOnDuty) await setOnDutyTeacher(null);

      await fetchTeachers();
      setStatus("Saved teacher.", true);

      const el = $("teacherList");
      const row = el && el.querySelector('.tRow[data-id="' + saved.id + '"]');
      if (row) selectTeacher(Number(saved.id), row);
    } catch (e) {
      setStatus("Save failed: " + (e.message || "error"), false);
    }
  }

  async function toggleActiveForSelected() {
    if (!selectedTeacherId) return;

    const t = cache.teachers.find(x => Number(x.id) === Number(selectedTeacherId));
    if (!t) { setStatus("Teacher not found (refresh).", false); return; }

    const email = ($("email")?.value || t.email || "").trim();
    const fullName = ($("fullName")?.value || t.full_name || "").trim();

    const currentlyActive = !!t.is_active;
    const nextActive = !currentlyActive;

    const isCurrentlyOnDuty = !!(cache.onDutyTeacherId && Number(cache.onDutyTeacherId) === Number(selectedTeacherId));

    if (!nextActive && isCurrentlyOnDuty) {
      setStatus("Clearing on-duty (required) …", false);
      try { await setOnDutyTeacher(null); } catch (_) {
        setStatus("Cannot deactivate while on-duty (failed to clear on-duty).", false);
        return;
      }
    }

    setStatus((nextActive ? "Reactivating" : "Deactivating") + " teacher…", false);

    try {
      const saved = await upsertTeacherCore(selectedTeacherId, email, fullName, nextActive);
      await fetchTeachers();
      setStatus(nextActive ? "Teacher reactivated." : "Teacher deactivated.", true);

      const el = $("teacherList");
      const row = el && el.querySelector('.tRow[data-id="' + saved.id + '"]');
      if (row) selectTeacher(Number(saved.id), row);
    } catch (e) {
      setStatus("Update failed: " + (e.message || "error"), false);
    }
  }

  async function setSelectedOnDutyFromPanel() {
    if (!selectedTeacherId) return;

    const t = cache.teachers.find(x => Number(x.id) === Number(selectedTeacherId));
    if (!t) { setStatus("Teacher not found (refresh).", false); return; }
    if (t.is_active !== true) { setStatus("Cannot set on-duty for an inactive teacher.", false); return; }

    setStatus("Setting on-duty…", false);
    try {
      await setOnDutyTeacher(selectedTeacherId);
      await fetchTeachers();
      setStatus("On-duty updated.", true);

      const t2 = cache.teachers.find(x => Number(x.id) === Number(selectedTeacherId));
      if (t2) loadDetailFromTeacher(t2);
    } catch (e) {
      setStatus("On-duty failed: " + (e.message || "error"), false);
    }
  }

  async function clearOnDutyFromPanel() {
    setStatus("Clearing on-duty…", false);
    try {
      await setOnDutyTeacher(null);
      await fetchTeachers();
      setStatus("On-duty cleared.", true);

      if (selectedTeacherId) {
        const t = cache.teachers.find(x => Number(x.id) === Number(selectedTeacherId));
        if (t) loadDetailFromTeacher(t);
      }
    } catch (e) {
      setStatus("Clear on-duty failed: " + (e.message || "error"), false);
    }
  }

  async function sendInvite() {
    if (!selectedTeacherId) return;
    setStatus("Invite flow not wired yet (endpoint needed).", false);
  }

  function bulkAssign() { setStatus("Bulk assign: next (student picker + endpoint).", false); }
  function bulkUnassign() { setStatus("Bulk unassign: next (student picker + endpoint).", false); }

  function goBack() {
    window.location.href = "/admin-home/AdminHome.html?slug=" + encodeURIComponent(SLUG);
  }

  // ---------------------------------
  // Modal: Add Teacher
  // ---------------------------------
  function openModal() {
    if ($("modalMask")) $("modalMask").style.display = "flex";
    if ($("mFullName")) $("mFullName").value = "";
    if ($("mEmail")) $("mEmail").value = "";
    if ($("mIsActive")) $("mIsActive").checked = true;
    if ($("mIsOnDuty")) $("mIsOnDuty").checked = false;
  }

  function closeModal() {
    if ($("modalMask")) $("modalMask").style.display = "none";
  }

  async function createTeacher() {
    const email = ($("mEmail")?.value || "").trim();
    const fullName = ($("mFullName")?.value || "").trim();
    const isActive = !!$("mIsActive")?.checked;
    const wantsOnDuty = !!$("mIsOnDuty")?.checked;

    if (!email) { setStatus("Email is required to create a teacher.", false); return; }
    if (!isActive && wantsOnDuty) { setStatus("Cannot set On Duty while inactive.", false); return; }

    setStatus("Creating teacher…", false);

    try {
      const created = await upsertTeacherCore(null, email, fullName, isActive);
      if (wantsOnDuty) await setOnDutyTeacher(created.id);

      closeModal();
      await fetchTeachers();
      setStatus("Teacher created.", true);

      const el = $("teacherList");
      const row = el && el.querySelector('.tRow[data-id="' + created.id + '"]');
      if (row) selectTeacher(Number(created.id), row);
    } catch (e) {
      setStatus("Create failed: " + (e.message || "error"), false);
    }
  }

  // ---------------------------------
  // Boot
  // ---------------------------------
  window.addEventListener("DOMContentLoaded", function () {
    $("backBtn")?.addEventListener("click", goBack);

    $("refreshBtn")?.addEventListener("click", fetchTeachers);
    $("searchBtn")?.addEventListener("click", fetchTeachers);
    $("q")?.addEventListener("keydown", function (e) { if (e.key === "Enter") fetchTeachers(); });
    $("activeOnly")?.addEventListener("change", fetchTeachers);

    $("saveBtn")?.addEventListener("click", saveTeacher);
    $("inviteBtn")?.addEventListener("click", sendInvite);

    $("deactivateBtn")?.addEventListener("click", toggleActiveForSelected);

    $("bulkAssignBtn")?.addEventListener("click", bulkAssign);
    $("bulkUnassignBtn")?.addEventListener("click", bulkUnassign);

    $("addTeacherBtn")?.addEventListener("click", openModal);
    $("closeModalBtn")?.addEventListener("click", closeModal);
    $("cancelAddBtn")?.addEventListener("click", closeModal);
    $("confirmAddBtn")?.addEventListener("click", createTeacher);

    $("modalMask")?.addEventListener("click", function (e) {
      if (e.target === $("modalMask")) closeModal();
    });

    $("btnSetSelectedOnDuty")?.addEventListener("click", setSelectedOnDutyFromPanel);
    $("btnClearOnDuty")?.addEventListener("click", clearOnDutyFromPanel);

    // Notes wiring (once)
    NotesController.bindUiOnce();

    // Initial UI state
    setControlsEnabled(false);
    renderOnDutyEmptyState();

    // Ensure notes starts blank until a teacher is selected
    NotesController.setEntity(null).catch(() => {});

    fetchTeachers().catch(function (err) {
      console.error(err);
      setStatus("Error loading page.", false);
    });
  });
})();