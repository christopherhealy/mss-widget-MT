// notes-api.js
function createNotesApi({ slug, fetchFn }) {
  function requireArgs(entityType, entityId) {
    if (!entityType) throw new Error("missing_entity_type");
    const id = Number(entityId || 0);
    if (!id) throw new Error("missing_entity_id");
    return id;
  }

  async function list({ entityType, entityId, limit=50, offset=0 }) {
    const id = requireArgs(entityType, entityId);
    const url =
      `/api/admin/notes?slug=${encodeURIComponent(slug)}` +
      `&entity_type=${encodeURIComponent(entityType)}` +
      `&entity_id=${encodeURIComponent(String(id))}` +
      `&limit=${limit}&offset=${offset}&ts=${Date.now()}`;
    const res = await fetchFn(url, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "notes_list_failed");
    return { notes: body.notes || [], total: body.total ?? (body.notes ? body.notes.length : 0) };
  }

  async function create({ entityType, entityId, text, isPinned=false }) {
    const id = requireArgs(entityType, entityId);
    const payload = { entity_type: entityType, entity_id: id, text: String(text||"").trim(), is_pinned: !!isPinned };
    const url = `/api/admin/notes?slug=${encodeURIComponent(slug)}`;
    const res = await fetchFn(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "note_create_failed");
    return body.note;
  }

  async function update({ noteId, text, isPinned }) {
    const url = `/api/admin/notes/${encodeURIComponent(String(noteId))}?slug=${encodeURIComponent(slug)}`;
    const payload = { text: String(text||"").trim(), is_pinned: !!isPinned };
    const res = await fetchFn(url, { method:"PUT", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "note_update_failed");
    return body.note;
  }

  async function remove({ noteId }) {
    const url = `/api/admin/notes/${encodeURIComponent(String(noteId))}?slug=${encodeURIComponent(slug)}`;
    const res = await fetchFn(url, { method:"DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.error || "note_delete_failed");
    return true;
  }

  return { list, create, update, remove };
}
window.createNotesApi = createNotesApi;