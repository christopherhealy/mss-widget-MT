// /admin/WidgetSurvey.js
// All-in-one Questions editor + Help editor + CSV/JSON import/export
// Now uses admin session guard via localStorage("mssAdminSession")
//
// Build: extracted from inline WidgetSurvey.html script + Dec 5 admin-session guard

// -------- SLUG + ENDPOINTS (per-school via assessments) --------
var params = new URLSearchParams(window.location.search);
var SLUG   = (params.get("slug") || "mss-demo").trim();

// 1) Resolve (or auto-create) default assessment for this school slug
function getAdminAssessUrl() {
  return "/api/admin/assessments/" + encodeURIComponent(SLUG);
}

// 2) Load/save questions by assessmentId
var QUESTIONS_BASE_URL = "/api/assessments/"; // we'll append ASSESSMENT_ID + "/questions"

// 3) Local fallback only used for export/import backup
var FALLBACK_FORM_URL  = "./form.json?ts=" + Date.now();

var ASSESSMENT_ID = null;
var SCHOOL_ID = null;

// --- Admin session helpers (shared with AdminLogin / Portal / ConfigAdmin) ---
var ADMIN_LS_KEY = "mssAdminSession";

function getAdminSession(){
  try{
    var raw = window.localStorage.getItem(ADMIN_LS_KEY);
    if (!raw) return null;
    var session = JSON.parse(raw);
    if (!session || !session.adminId || !session.email) return null;
    return session;
  }catch(e){
    console.warn("[WidgetSurvey] Failed to read admin session", e);
    return null;
  }
}

/**
 * Ensure there is a valid admin session. If not:
 *  - show an inline status (if available)
 *  - redirect back to AdminLogin
 *  - attempt to close this tab
 *  - throw to stop the current call stack
 */
function requireAdminSession(reason){
  var session = getAdminSession();
  if (session) return session;

  var msg =
    reason ||
    "Your admin session has ended. Please sign in again to edit questions.";

  try {
    if (typeof setStatus === "function") {
      setStatus(msg, false); // false ⇒ warning style
    } else {
      console.warn("[WidgetSurvey] " + msg);
    }
  } catch (e) {
    console.warn("[WidgetSurvey] Unable to show status for ended session", e);
  }

  // Send them back to the login screen
  window.location.href = "/admin-login/AdminLogin.html";

  try { window.close(); } catch (e) {
    // ignore – some browsers block this
  }

  throw new Error("Admin session missing – redirected to login.");
}

// existing state vars can stay as-is:
var schema    = null;   // simple wrapper (used for headline + export)
var survey    = [];     // the questions list
var fileHandle = null;
var aeMode    = "add";
var aeIndex   = -1;

var aeDirty   = false;

// Help modal state
var helpQuestionId    = null;
var helpQuestionText  = "";
var helpQuestionIndex = -1;   // index into survey[]

var DEFAULT_HELP_PROMPT =
  "You are trying provide help for an English Student at the CEFR B1 level.\n" +
  "You want to provide the student with two levels of help:\n\n" +
  "Here is the question for the student: [QUESTION]\n\n" +
  "We need you to provide a good answer for it two ways:\n\n" +
  "1) A reading section that would be about 60 seconds in length if read at 80 WPM.\n" +
  "   The section will be read aloud by the student while recording the answer.\n\n" +
  "2) A point-by-point summary of the answer that the student will be able to\n" +
  "   look at before he or she records an answer.\n";

/* ========= helpers ========= */
function $(id){ return document.getElementById(id); }

function setStatus(msg, ok){
  if (ok === void 0) ok = true;
  var el = $("status"); if(!el) return;
  el.textContent = (ok ? "✅ " : "⚠️ ") + msg;
  el.style.color = ok ? "green" : "#b45309";
  clearTimeout(setStatus._t);
  setStatus._t = setTimeout(function(){ el.textContent=""; }, 1800);
}

function escapeHtml(s){
  return String(s).replace(/[&<>]/g, function(c){
    return ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]);
  });
}

// ---------------------------------------------------------------------
// Admin session + School dropdown (WidgetSurvey) – Dec 5
// ---------------------------------------------------------------------

const WS_ADMIN_LS_KEY = "mssAdminSession";

// Read admin session from localStorage
function wsGetAdminSession() {
  try {
    const raw = window.localStorage.getItem(WS_ADMIN_LS_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.adminId || !session.email) return null;
    return session;
  } catch (e) {
    console.warn("[WidgetSurvey] Failed to read admin session", e);
    return null;
  }
}

// Optional “hard” check if you want to enforce login here too
function wsRequireAdminSession(reason) {
  const session = wsGetAdminSession();
  if (session) return session;

  const msg =
    reason ||
    "Your admin session has ended. Please sign in again to manage questions.";

  // If you already have a setStatus helper, use it; otherwise fall back
  try {
    if (typeof setStatus === "function") {
      setStatus(msg, true);
    } else {
      console.warn("[WidgetSurvey] " + msg);
    }
  } catch (e) {
    console.warn("[WidgetSurvey] Unable to show session warning", e);
  }

  // Send them back to the admin login
  window.location.href = "/admin-login/AdminLogin.html";

  try {
    window.close();
  } catch (_) {
    // ignore
  }

  throw new Error("Admin session missing – redirected to login.");
}

// URL params: we may get assessmentId and/or slug from the Portal
const wsUrlParams = new URLSearchParams(window.location.search);
let WS_CURRENT_SLUG = wsUrlParams.get("slug") || null;

// Multi-school state just for WidgetSurvey
let WS_SCHOOLS = [];      // [{ id, slug, name, ... }]
let WS_CURRENT_SCHOOL = null;

// DOM ref for the new dropdown
const wsSchoolSelectEl = document.getElementById("ws-school-select");

/**
 * Keep the WidgetSurvey school dropdown in sync with WS_CURRENT_SCHOOL/SLUG.
 * This does *not* change which questions are loaded yet – it’s just UI.
 */
function wsSyncSchoolSelectUi() {
  if (!wsSchoolSelectEl || !WS_SCHOOLS.length) return;

  if (WS_CURRENT_SCHOOL) {
    wsSchoolSelectEl.value = WS_CURRENT_SCHOOL.slug;
  } else if (WS_CURRENT_SLUG) {
    wsSchoolSelectEl.value = WS_CURRENT_SLUG;
  }

  // Disable if there is only one school (Mary’s case)
  wsSchoolSelectEl.disabled = WS_SCHOOLS.length === 1;
}

/**
 * Load schools for this admin (same backend as SchoolPortal/ConfigAdmin)
 * and populate the [ School ▼ ] dropdown.
 */
async function wsFetchSchoolsForWidgetSurvey() {
  if (!wsSchoolSelectEl) {
    // Layout without dropdown → nothing to do
    return;
  }

  const session = wsRequireAdminSession(
    "Your admin session has ended. Please sign in again to manage questions."
  );

  const ADMIN_EMAIL = session.email;
  const ADMIN_ID = session.adminId || session.id;

  try {
    const qs = new URLSearchParams();
    if (ADMIN_EMAIL) qs.set("email", ADMIN_EMAIL);
    if (ADMIN_ID) qs.set("adminId", String(ADMIN_ID));

    let url = "/api/admin/my-schools";
    const query = qs.toString();
    if (query) url += `?${query}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || data.ok === false) {
      console.warn("[WidgetSurvey] my-schools error:", data);
      return;
    }

    WS_SCHOOLS = Array.isArray(data.schools) ? data.schools : [];
    wsSchoolSelectEl.innerHTML = "";

    if (!WS_SCHOOLS.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No schools found";
      wsSchoolSelectEl.appendChild(opt);
      wsSchoolSelectEl.disabled = true;
      return;
    }

    // Decide current school:
    // 1) If URL slug matches, prefer that.
    // 2) Otherwise first school.
    if (
      !WS_CURRENT_SLUG ||
      !WS_SCHOOLS.some((s) => String(s.slug) === String(WS_CURRENT_SLUG))
    ) {
      WS_CURRENT_SCHOOL = WS_SCHOOLS[0];
      WS_CURRENT_SLUG = WS_CURRENT_SCHOOL.slug;
    } else {
      WS_CURRENT_SCHOOL =
        WS_SCHOOLS.find(
          (s) => String(s.slug) === String(WS_CURRENT_SLUG)
        ) || WS_SCHOOLS[0];
      WS_CURRENT_SLUG = WS_CURRENT_SCHOOL.slug;
    }

    if (WS_SCHOOLS.length === 1) {
      // Mary: single school, show it and lock the control
      const s = WS_SCHOOLS[0];
      const opt = document.createElement("option");
      opt.value = s.slug;
      opt.textContent = s.name || s.slug;
      wsSchoolSelectEl.appendChild(opt);
      wsSchoolSelectEl.disabled = true;
    } else {
      // Multi-school: normal dropdown
      WS_SCHOOLS.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.slug;
        opt.textContent = s.name || s.slug;
        wsSchoolSelectEl.appendChild(opt);
      });
      wsSchoolSelectEl.disabled = false;
    }

    wsSyncSchoolSelectUi();
  } catch (err) {
    console.error("[WidgetSurvey] wsFetchSchoolsForWidgetSurvey failed", err);
  }
}

/**
 * OPTIONAL: handle change of school.
 *
 * For now this is read-only: we just snap back and gently remind the admin
 * that they should use the School Portal to open the Question Editor for
 * a different school. Once we refactor the loader, we can replace this
 * with real per-school switching.
 */
function wsWireSchoolSelectEvents() {
  if (!wsSchoolSelectEl) return;

  wsSchoolSelectEl.addEventListener("change", async function () {
    const newSlug = wsSchoolSelectEl.value;
    if (!newSlug || newSlug === WS_CURRENT_SLUG) {
      wsSyncSchoolSelectUi();
      return;
    }

    const school =
      WS_SCHOOLS.find(function (s) { return String(s.slug) === String(newSlug); }) ||
      null;
    const schoolName = school && school.name ? school.name : newSlug;

    const title =
      'Change schools to "' +
      schoolName +
      '"? Don\'t forget to save your changes.';

    // twoBtnConfirm(title, cancelLabel, okLabel)
    const ok = await twoBtnConfirm(title, "Stay", "Switch");

    if (!ok) {
      // User chose "Stay" → revert dropdown to current school
      wsSyncSchoolSelectUi();
      return;
    }

    // Proceed with the switch
    WS_CURRENT_SLUG   = newSlug;
    WS_CURRENT_SCHOOL = school || WS_CURRENT_SCHOOL || null;
    SLUG              = newSlug;

    // Update assessment lookup endpoint for the new slug
    ADMIN_ASSESS_URL =
      "/api/admin/assessments/" + encodeURIComponent(SLUG);

    // Keep the control in sync
    wsSchoolSelectEl.value = newSlug;

    // Update the URL (?slug=...) and clear any old assessmentId
    try {
      var url = new URL(window.location.href);
      url.searchParams.set("slug", newSlug);
      url.searchParams.delete("assessmentId");
      window.history.replaceState({}, "", url.toString());
    } catch (e) {
      console.warn("[WidgetSurvey] unable to update URL for slug switch", e);
    }

    // Reset state and reload questions for the new school
    ASSESSMENT_ID = null;
    SCHOOL_ID     = null;
    schema        = { headline: "Questions for " + SLUG };
    survey        = [];
    render();

    setStatus("Loading questions for " + schoolName + "…", false);

    try {
      await load();
    } catch (err) {
      console.error("[WidgetSurvey] reload failed after school switch", err);
      setStatus("Failed to load questions for " + schoolName, false);
    }
  });
}

function summarize(q){
  var text = (q && typeof q === "object") ? (q.question || q.text || "") : (q || "");
  var parts = String(text).split(/\n+/);
  var head = escapeHtml(parts[0] || "");
  var rest = escapeHtml(parts.slice(1).join("\n"));
  var extra = rest
    ? '<div class="muted" style="margin-top:4px;white-space:pre-line">' + rest + "</div>"
    : "";
  return '<div class="qtext"><div class="qfirst">' + head + "</div>" + extra + "</div>";
}

function openAddModal(){
  aeMode = "add"; aeIndex = -1; aeDirty = false;
  $("aeTitle").textContent = "Add Question";
  $("aeTextarea").value = "";
  showOverlay("aeOverlay", true);
}

function openEditModal(i){
  aeMode = "edit"; aeIndex = i; aeDirty = false;
  var item = survey[i];
  var text = item && typeof item === "object" ? (item.question || item.text || "") : (item || "");
  $("aeTitle").textContent = "Edit Question";
  $("aeTextarea").value = text;
  showOverlay("aeOverlay", true);
}

function getMerged(){
  // avoid object spread – keep it ES2015-safe
  var base = schema ? JSON.parse(JSON.stringify(schema)) : {};
  base.survey = survey.slice();
  return base;
}

/* ========= render list ========= */
function move(i, d){
  var j = i + d; if (j < 0 || j >= survey.length) return;
  var tmp = survey[i]; survey[i] = survey[j]; survey[j] = tmp;
  render();
}
function moveTo(i, dest){
  if (i < 0 || i >= survey.length) return;
  if (dest < 0) dest = 0;
  if (dest > survey.length - 1) dest = survey.length - 1;
  if (i === dest) return;
  var item = survey.splice(i, 1)[0];
  survey.splice(dest, 0, item);
  render();
}

function render(){
  var list = $("list");
  if (!survey.length){
    list.innerHTML =
      '<div class="muted">No questions found. Click <b>＋ Add</b> or use <b>Import</b>/<b>CSV Import</b>.</div>';
    return;
  }

  var html = "";
  for (var i = 0; i < survey.length; i++){
    var item    = survey[i];
    var hasHelp = !!(item && item.hasHelp);

    html +=
      '<div class="row" data-idx="' + i + '" draggable="true"' +
        (hasHelp ? ' data-has-help="1"' : '') + '>' +
        '<div class="idx" title="Drag to reorder">' + (i + 1) + '</div>' +
        '<div>' + summarize(item) + '</div>' +
        '<div class="ctrls">' +
          '<button type="button" class="btn" data-act="edit">Edit</button>' +
          '<button type="button" class="btn" data-act="help">' +
            'Help' + (hasHelp ? ' •' : '') +
          '</button>' +
          '<button type="button" class="btn" data-act="top">Top</button>' +
          '<button type="button" class="btn" data-act="up">Up</button>' +
          '<button type="button" class="btn" data-act="down">Down</button>' +
          '<button type="button" class="btn" data-act="bottom">Bottom</button>' +
          '<button type="button" class="btn" data-act="remove">✕</button>' +
        '</div>' +
      '</div>';
  }

  list.innerHTML = html;
  wireDnd(list);
}

/* ========= DnD ========= */
function wireDnd(container){
  var ph = null, dragging = null, src = null;

  var rows = container.querySelectorAll(".row");
  Array.prototype.forEach.call(rows, function(row){
    row.dataset.allow = "";
    row.addEventListener("dragstart", start);
    row.addEventListener("dragend", end);
    var idxEl = row.querySelector(".idx");
    if (idxEl){
      idxEl.addEventListener("pointerdown", function(){
        row.dataset.allow = "1";
      }, {passive:true});
    }
  });

  container.addEventListener("dragover", over);
  container.addEventListener("drop", drop);

  function start(e){
    var row = e.currentTarget;
    if (row.dataset.allow !== "1"){
      e.preventDefault();
      return;
    }
    row.dataset.allow = "";
    dragging = row;
    src = +row.dataset.idx;
    row.classList.add("dragging");
    ph = document.createElement("div");
    ph.className = "placeholder";
    ph.style.height = row.getBoundingClientRect().height + "px";
    row.after(ph);
    e.dataTransfer.effectAllowed = "move";
    try{
      e.dataTransfer.setData("text/plain", String(src));
      e.dataTransfer.setDragImage(row.querySelector(".idx") || row, 16, 16);
    }catch(_) {}
    console.log("[DnD] dragstart from index", src);
  }

  function over(e){
    if (!dragging || !ph) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    var after = getAfter(container, e.clientY);
    if (!after) container.appendChild(ph);
    else container.insertBefore(ph, after);
  }

  function drop(e){
    if (!dragging || !ph) return;
    e.preventDefault();

    var target = 0;
    var children = Array.prototype.slice.call(container.children);
    for (var i = 0; i < children.length; i++){
      var c = children[i];
      if (c === ph) break;
      if (c.classList && c.classList.contains("row")) target++;
    }

    var from = src;
    if (from < target) target--;
    console.log("[DnD] drop from", from, "to", target);

    cleanup();
    if (from == null || from === target) return;

    var m = survey.splice(from, 1)[0];
    survey.splice(target, 0, m);
    render();
  }

  function end(){
    cleanup();
  }

  function cleanup(){
    Array.prototype.forEach.call(
      container.querySelectorAll(".row"),
      function(r){ r.dataset.allow = ""; }
    );
    if (dragging) dragging.classList.remove("dragging");
    dragging = null;
    src = null;
    if (ph) ph.remove();
    ph = null;
  }

  function getAfter(container, y){
    var rows = Array.prototype.slice.call(
      container.querySelectorAll(".row:not(.dragging)")
    );
    var best = {offset: -Infinity, element: null};
    rows.forEach(function(ch){
      var box = ch.getBoundingClientRect();
      var off = y - box.top - box.height / 2;
      if (off < 0 && off > best.offset){
        best.offset = off;
        best.element = ch;
      }
    });
    return best.element;
  }
}

/* ========= Modals / confirms ========= */

function showOverlay(id, show){
  var el = $(id); if (!el) return;
  el.style.display = show ? "flex" : "none";
  el.setAttribute("aria-hidden", show ? "false" : "true");
}

function wireAddEdit(){
  var ta = $("aeTextarea");
  ta.addEventListener("input", function(){ aeDirty = true; });

  $("aeCancel").addEventListener("click", function(){
    $("aeTextarea").value = "";
    aeDirty = false;
    showOverlay("aeOverlay", false);
  });

  $("aeSave").addEventListener("click", function(){
    var v = ta.value.trim();
    if (!v){ setStatus("Nothing to save", false); return; }

    if (aeMode === "add") {
      survey.push({ id: null, question: v });
    } else if (aeMode === "edit" && aeIndex > -1) {
      var item = survey[aeIndex];
      if (item && typeof item === "object") {
        item.question = v;
      } else {
        survey[aeIndex] = { id: null, question: v };
      }
    }

    aeDirty = false;
    render();
    setStatus("Saved");
  });

  $("aeSaveNew").addEventListener("click", function(){
    var v = ta.value.trim();
    if (!v){ setStatus("Nothing to save", false); return; }

    if (aeMode === "edit" && aeIndex > -1) {
      var item = survey[aeIndex];
      if (item && typeof item === "object") {
        item.question = v;
      } else {
        survey[aeIndex] = { id: null, question: v };
      }
    } else {
      survey.push({ id: null, question: v });
    }

    render();
    ta.value = "";
    aeMode = "add";
    aeIndex = -1;
    aeDirty = false;
    setStatus("Saved. Ready for next.");
  });

  $("aeClose").addEventListener("click", function(){
    if (aeDirty && $("aeTextarea").value.trim()){
      triConfirm("Save your question?", "No", "Cancel", "Save").then(function(choice){
        if (choice === "save"){
          var v = $("aeTextarea").value.trim();
          if (aeMode === "add") {
            survey.push({ id: null, question: v });
          } else if (aeMode === "edit" && aeIndex > -1) {
            var item = survey[aeIndex];
            if (item && typeof item === "object") {
              item.question = v;
            } else {
              survey[aeIndex] = { id: null, question: v };
            }
          }
          render();
          aeDirty = false;
          showOverlay("aeOverlay", false);
          setStatus("Saved");
        }else if (choice === "nosave"){
          aeDirty = false;
          showOverlay("aeOverlay", false);
        }
      });
    }else{
      showOverlay("aeOverlay", false);
    }
  });
}

function twoBtnConfirm(title, cancelLabel, okLabel){
  if (cancelLabel === void 0) cancelLabel = "Cancel";
  if (okLabel === void 0) okLabel = "OK";

  return new Promise(function(resolve){
    var ov = $("confirmOverlay");
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = "";
    var ok = $("confirmOk"), cancel = $("confirmCancel");
    ok.textContent = okLabel; cancel.textContent = cancelLabel;
    ov.style.display = "flex"; ov.setAttribute("aria-hidden","false");
    var done = function(v){
      ov.style.display = "none"; ov.setAttribute("aria-hidden","true");
      ok.onclick = cancel.onclick = null;
      resolve(v);
    };
    ok.onclick = function(){ done(true); };
    cancel.onclick = function(){ done(false); };
  });
}

function triConfirm(title,left,mid,right){
  if (left === void 0) left = "No";
  if (mid  === void 0) mid  = "Cancel";
  if (right=== void 0) right= "Yes";

  return new Promise(function(resolve){
    var ov = $("confirmOverlay");
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = "";
    var ok = $("confirmOk"), cancel = $("confirmCancel");
    var wrap = ok.parentNode;
    wrap.innerHTML = "";
    var L = document.createElement("button");
    L.className = "btn"; L.type = "button"; L.textContent = left;
    var M = document.createElement("button");
    M.className = "btn"; M.type = "button"; M.textContent = mid;
    var R = document.createElement("button");
    R.className = "btn primary"; R.type = "button"; R.textContent = right;
    wrap.appendChild(L); wrap.appendChild(M); wrap.appendChild(R);
    ov.style.display = "flex"; ov.setAttribute("aria-hidden","false");

    var cleanup = function(){
      ov.style.display = "none"; ov.setAttribute("aria-hidden","true");
      wrap.innerHTML = "";
      wrap.appendChild(cancel);
      wrap.appendChild(ok);
    };

    L.onclick = function(){ cleanup(); resolve("nosave"); };
    M.onclick = function(){ cleanup(); resolve("cancel"); };
    R.onclick = function(){ cleanup(); resolve("save"); };
  });
}

/* ========= Nov 14 Save to DB with file fallback ========= */
async function saveToServer(){
  // 🔐 Session check before saving
  requireAdminSession(
    "Your admin session has ended. Please sign in again before saving questions."
  );

  if (!ASSESSMENT_ID){
    console.error("[WidgetSurvey] no ASSESSMENT_ID – cannot save.");
    setStatus("No assessmentId – cannot save.", false);
    return "error";
  }

  // Normalize for API: keep id (may be null), sort_order, question text
  var payloadQuestions = survey
  .map(function(item, idx){
    var q = (item && typeof item === "object") ? item : { question: item };
    var text = (q.question || q.text || "").toString().trim();
    if (!text) return null;

    // If we already have a sort_order, keep it; otherwise fall back to idx+1
    var order =
      (q.sort_order != null && q.sort_order !== "")
        ? q.sort_order
        : (idx + 1);

    return {
      id:        q.id || null,
      sort_order: order,
      question:  text
    };
  })
  .filter(function(q){ return q !== null; });

  console.log("[WidgetSurvey] payloadQuestions =", JSON.stringify(payloadQuestions, null, 2));

  if (!payloadQuestions.length){
    setStatus("No questions to save", false);
    return "error";
  }

  var payload = { questions: payloadQuestions };

  try {
    var url = QUESTIONS_BASE_URL + encodeURIComponent(ASSESSMENT_ID) + "/questions";
    console.log("[WidgetSurvey] saving questions to", url, "for slug", SLUG, "payload:", payload);

    var res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok){
      var errBody = null;
      try { errBody = await res.json(); } catch (_) {}
      console.error("Save failed with status", res.status, "body:", errBody);
      setStatus("Server save failed (" + res.status + ")", false);
      return "error";
    }

    setStatus("Saved to server", true);

    try { await load(); } catch (_) {}
    return "server";
  } catch (err) {
    console.error("Save error:", err);
    setStatus("Server save error", false);
    return "error";
  }
}

async function saveToFilePicker(jsonObj, suggestedName){
  if (suggestedName === void 0) suggestedName = "form.json";
  var blob = new Blob([JSON.stringify(jsonObj,null,2)], {type:"application/json"});

  if (!("showSaveFilePicker" in window)){
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.setAttribute("download", suggestedName);
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    return "download";
  }

  try{
    if (fileHandle){
      var perm = await fileHandle.requestPermission({mode:"readwrite"});
      if (perm === "granted"){
        var w1 = await fileHandle.createWritable();
        await w1.write(blob); await w1.close();
        return "saved";
      }
    }
    fileHandle = await window.showSaveFilePicker({
      suggestedName: suggestedName,
      types:[{description:"JSON", accept:{"application/json":[".json"]}}]
    });
    var w2 = await fileHandle.createWritable();
    await w2.write(blob); await w2.close();
    return "saved";
  }catch(e){
    console.warn("Save canceled/failed:", e);
    return "canceled";
  }
}

/* ========= Nov 14 Load (DB → bootstrap → form.json) ========= */
async function load(){
  // 🔐 Block if the admin has logged out from the Portal
  requireAdminSession(
    "Your admin session has ended. Please sign in again to edit questions."
  );

  setStatus("Loading…", false);

  try {
    console.log("[WidgetSurvey] resolving assessment for slug=", SLUG, "via", getAdminAssessUrl());
    var aRes = await fetch(getAdminAssessUrl() + "?ts=" + Date.now(), { cache: "no-store" });
    if (!aRes.ok) throw new Error("assessment lookup failed: " + aRes.status);

    var aBody = await aRes.json().catch(function(){ return {}; });
    if (!aBody || !aBody.assessmentId) {
      throw new Error("no assessmentId in response");
    }

    ASSESSMENT_ID = aBody.assessmentId;
    console.log("[WidgetSurvey] using assessmentId=", ASSESSMENT_ID);

    if (aBody.schoolId || aBody.school_id){
      SCHOOL_ID = aBody.schoolId || aBody.school_id;
      console.log("[WidgetSurvey] using schoolId=", SCHOOL_ID, "for slug", SLUG);
    }

    schema = { headline: "Questions for " + SLUG };

    var qUrl = QUESTIONS_BASE_URL + encodeURIComponent(ASSESSMENT_ID) + "/questions";
    console.log("[WidgetSurvey] loading questions from", qUrl);

    var qRes = await fetch(qUrl + "?ts=" + Date.now(), {
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });

    if (qRes.ok) {
      var qBody = await qRes.json().catch(function(){ return {}; });

      survey = [];

      if (qBody && Array.isArray(qBody.questions)) {
        survey = qBody.questions
          .map(function(row, idx){
            var order =
              (row.sort_order != null && row.sort_order !== "")
                ? row.sort_order
                : (row.position != null && row.position !== "")
                  ? row.position
                  : (idx + 1);

            return {
              id:        row.id || null,
              question:  row.question != null ? String(row.question) : "",
              sort_order: order,
              hasHelp: !!(row.hasHelp || row.has_help)
            };
          })
          .filter(function(item){
            return item.question.trim() !== "";
          })
          .sort(function(a, b){
            return a.sort_order - b.sort_order;
          });
      }
    } else if (qRes.status === 404) {
      console.warn("[WidgetSurvey] questions 404 – starting empty list");
      survey = [];
    } else {
      throw new Error("questions load failed: " + qRes.status);
    }

    $("meta").textContent =
      "Questions for " + SLUG +
      " • assessmentId=" + ASSESSMENT_ID +
      " • " + (new Date()).toLocaleString();

    render();
    setStatus("Loaded.", true);
  } catch (err) {
    console.error("[WidgetSurvey] load failed", err);
    setStatus("Failed to load from DB – starting empty list", false);
    schema = { headline: "Questions for " + SLUG };
    survey = [];
    render();
  }
}

/* ========= Finished dialog ========= */
function showFinishDialog(){
  return new Promise(function(resolve){
    var ov = $("finishOverlay");
    ov.style.display = "flex";
    ov.setAttribute("aria-hidden","false");
    var save   = $("finishSave");
    var noSave = $("finishNoSave");
    var cancel = $("finishCancel");

    var close = function(result){
      ov.style.display = "none";
      ov.setAttribute("aria-hidden","true");
      save.onclick = noSave.onclick = cancel.onclick = null;
      resolve(result);
    };

    save.onclick   = function(){ close("save"); };
    noSave.onclick = function(){ close("nosave"); };
    cancel.onclick = function(){ close("cancel"); };
  });
}

async function finishedFlow(){
  var choice = await showFinishDialog();
  if (choice === "save"){
    var r = await saveToServer();
    if (r !== "server"){
      return;
    }
  }
}

function confirmRemove(i){
  twoBtnConfirm("Remove this question?", "Cancel", "Remove").then(function(ok){
    if (!ok) return;
    survey.splice(i, 1);
    render();
    setStatus("Question removed");
  });
}

/* ========= Row actions / boot ========= */
function wireRowActions(){
  var listEl = $("list");
  listEl.addEventListener("click", function(e){
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var row = btn.closest(".row"); if (!row) return;
    var i = +row.dataset.idx;
    switch(btn.dataset.act){
      case "edit":   openEditModal(i); break;
      case "help":   openHelpFor(i);   break;
      case "top":    moveTo(i,0); break;
      case "up":     move(i,-1); break;
      case "down":   move(i,1); break;
      case "bottom": moveTo(i,survey.length-1); break;
      case "remove": confirmRemove(i); break;
    }
  });
}

window.addEventListener("DOMContentLoaded", async function () {
  console.log('🧩 MSS Questions Admin for slug="' + SLUG + '"');

  // Early guard (load() also checks)
  requireAdminSession(
    "Your admin session has ended. Please sign in again to edit questions."
  );

  // Keep WS_CURRENT_SLUG in sync with the main SLUG
  if (!WS_CURRENT_SLUG) {
    WS_CURRENT_SLUG = SLUG;
  }

  // --- NEW: wire & populate the [ School ▼ ] dropdown ---
  wsWireSchoolSelectEvents();
  await wsFetchSchoolsForWidgetSurvey();

  // --- Existing boot sequence (unchanged) ---
  load();

  wireRowActions();
  $("addBtnTop").addEventListener("click", openAddModal);
  $("addBtnBottom").addEventListener("click", openAddModal);
  wireAddEdit();
  wireHelpModal();

  // Export
  $("exportBtnTop").addEventListener("click", function () {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(getMerged(), null, 2)], {
        type: "application/json",
      })
    );
    a.setAttribute("download", "form.json");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
    }, 1000);
    setStatus("Exported");
  });
  $("exportBtnBottom").addEventListener("click", function () {
    $("exportBtnTop").click();
  });

  // Save-to-file (manual)
  var saveMerged = async function () {
    var r = await saveToFilePicker(getMerged(), "form.json");
    setStatus(
      r === "saved"
        ? "Saved to file"
        : r === "download"
        ? "Downloaded"
        : "Canceled",
      r !== "canceled"
    );
  };

  $("saveToFileBtnTop").addEventListener("click", saveMerged);
  $("saveToFileBtnBottom").addEventListener("click", saveMerged);

  // Finished (Save dialog)
  $("finishedBtnTop").addEventListener("click", finishedFlow);
  $("finishedBtnBottom").addEventListener("click", finishedFlow);

  // JSON import
  (function wireImportJson() {
    var f = $("importJson");
    f.addEventListener("change", async function (e) {
      var file = (e.target.files && e.target.files[0]) || null;
      e.target.value = "";
      if (!file) return;
      try {
        var parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== "object")
          throw new Error("Invalid JSON object.");
        schema = parsed;
        survey = Array.isArray(parsed.survey)
          ? parsed.survey.map(function (q) {
              if (q && typeof q === "object") {
                return {
                  id: q.id || null,
                  question:
                    q.question != null
                      ? String(q.question)
                      : String(q || ""),
                };
              }
              return { id: null, question: String(q || "") };
            })
          : [];

        setStatus("Imported JSON");
        render();
        $("meta").textContent =
          (schema.headline || "My Speaking Score") +
          " • " +
          new Date().toLocaleString();
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    });
  })();

/* ========= Help modal: open + wiring ========= */

function openHelpFor(index){
  // 🔐 Don’t allow help editing without an admin session
  requireAdminSession(
    "Your admin session has ended. Please sign in again to edit question help."
  );

  var q = survey[index];
  if (!q){
    setStatus("No question found for help", false);
    return;
  }

  var id   = q.id || q.question_id || q.questionId;
  var text = q.question || q.text || String(q);

  if (!id){
    setStatus("This question has no ID yet – save questions first.", false);
    return;
  }

  helpQuestionId     = id;
  helpQuestionText   = text;
  helpQuestionIndex  = index;

  $("helpQuestionText").textContent = text;

  var url = "/api/admin/help/" +
            encodeURIComponent(SLUG) + "/" +
            encodeURIComponent(id);

  console.log("[WidgetSurvey] load help for questionId=", id, "via", url);

  fetch(url, { cache: "no-store" })
    .then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(body){
      $("helpMax").value = body.maxhelp || "";
      $("helpMin").value = body.minhelp || "";

      var template = DEFAULT_HELP_PROMPT.replace("[QUESTION]", text);

      var prompt = body.prompt || "";
      var isLegacy =
        !prompt ||
        prompt.indexOf("Here is the question for the student") === -1;

      $("helpPrompt").value = isLegacy ? template : prompt;

      if (helpQuestionIndex > -1 && survey[helpQuestionIndex]){
        survey[helpQuestionIndex].hasHelp =
          !!(body.maxhelp || body.minhelp || body.prompt);
      }
      render();

      showOverlay("helpOverlay", true);
      setStatus(body.exists ? "Loaded existing help" : "No help yet – ready to add");
    })
    .catch(function(err){
      console.error("Help load error", err);
      setStatus("Failed to load help", false);
    });
}

function wireHelpModal(){
  $("helpCancel").addEventListener("click", function(){
    showOverlay("helpOverlay", false);
  });

  var copyBtn = $("copyPromptBtn");
  if (copyBtn){
    copyBtn.addEventListener("click", function(){
      var txt = $("helpPrompt").value || "";
      if (!txt.trim()){
        setStatus("Nothing to copy", false);
        return;
      }
      navigator.clipboard.writeText(txt).then(function(){
        var old = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(function(){ copyBtn.textContent = old; }, 700);
        setStatus("Prompt copied", true);
      }).catch(function(err){
        console.error("Clipboard copy failed", err);
        setStatus("Clipboard blocked by browser", false);
      });
    });
  }

  $("helpSave").addEventListener("click", function(){
    // 🔐 Session check before saving help
    requireAdminSession(
      "Your admin session has ended. Please sign in again to save help."
    );

    if (!helpQuestionId){
      setStatus("No question selected for help", false);
      return;
    }

    var body = {
      maxhelp:  $("helpMax").value || "",
      minhelp:  $("helpMin").value || "",
      prompt:   $("helpPrompt").value || DEFAULT_HELP_PROMPT
    };

    var params   = new URLSearchParams(window.location.search);
    var adminKey = (params.get("adminKey") || "").trim();
    var headers  = { "Content-Type": "application/json" };
    if (adminKey) headers["X-ADMIN-KEY"] = adminKey;

    var url = "/api/admin/help/" +
              encodeURIComponent(SLUG) + "/" +
              encodeURIComponent(helpQuestionId);

    console.log("[WidgetSurvey] saving help to", url, "body=", body);

    fetch(url, {
      method: "PUT",
      headers: headers,
      body: JSON.stringify(body)
    })
      .then(function(res){
        if (!res.ok){
          return res.text().then(function(txt){
            var msg = "Help save failed (" + res.status + ")";
            console.error(msg, "response:", txt);
            throw new Error(msg);
          });
        }
        return res.text().catch(function(){ return ""; });
      })
      .then(function(){
        if (helpQuestionIndex > -1 && survey[helpQuestionIndex]){
          survey[helpQuestionIndex].hasHelp =
            !!(body.maxhelp || body.minhelp || body.prompt);
        }
        render();

        setStatus("Help saved", true);
        showOverlay("helpOverlay", false);
      })
      .catch(function(err){
        console.error("Help save error", err);
        setStatus("Failed to save help", false);
      });
  });
}

/* ========= CSV helpers ========= */

function normalizeCell(s){
  if (s == null) return "";
  var t = String(s).replace(/\r\n/g,"\n").trim();
  t = t.replace(/\n+/g," // ").replace(/\s*\/\/\s*/g," // ");
  return t;
}

function parseCSV(text){
  var rows = [];
  var field = "", row = [], inQ = false;
  for (var i = 0; i < text.length; i++){
    var c = text[i], n = text[i+1];
    if (inQ){
      if (c === '"' && n === '"'){ field += '"'; i++; }
      else if (c === '"'){ inQ = false; }
      else { field += c; }
    }else{
      if (c === '"'){ inQ = true; }
      else if (c === ","){ row.push(field); field = ""; }
      else if (c === "\n"){ row.push(field); field = ""; rows.push(row); row = []; }
      else if (c !== "\r"){ field += c; }
    }
  }
  row.push(field); rows.push(row);
  while(rows.length && rows[rows.length-1].every(function(v){ return String(v).trim()===""; })){
    rows.pop();
  }
  return rows;
}

function findSingleDataColumn(rows){
  var max = 0;
  rows.forEach(function(r){ if (r.length > max) max = r.length; });
  var idx = -1;
  for (var c = 0; c < max; c++){
    var has = rows.some(function(r){
      return r[c] != null && String(r[c]).trim() !== "";
    });
    if (has){
      if (idx !== -1) return -1;
      idx = c;
    }
  }
  return idx;
}

  // CSV import
  (function wireImportCsv() {
    var f = $("importCsv");
    f.addEventListener("change", async function (e) {
      var file = (e.target.files && e.target.files[0]) || null;
      e.target.value = "";
      if (!file) return;
      var rows = parseCSV(await file.text());
      if (!rows.length) {
        setStatus("CSV is empty", false);
        return;
      }
      var col = findSingleDataColumn(rows);
      if (col === -1) {
        alert("CSV must contain exactly one column with data.");
        return;
      }
      var first = String(rows[0][col] || "").trim().toLowerCase();
      var hasHeader = first === "name" || first === "title";
      var start = hasHeader ? 1 : 0;
      var qs = rows
        .slice(start)
        .map(function (r) {
          var t = normalizeCell(r[col]);
          return t ? { id: null, question: t } : null;
        })
        .filter(function (item) {
          return !!item;
        });
      if (!qs.length) {
        setStatus("No questions parsed", false);
        return;
      }
      var choice = await triConfirm(
        "Append to existing questions?",
        "Replace",
        "Cancel",
        "Append"
      );
      if (choice === "cancel") return;
      if (choice === "save") survey = survey.concat(qs);
      else if (choice === "nosave") survey = qs.slice();
      render();
      setStatus("CSV imported");
    });
  })();
});

