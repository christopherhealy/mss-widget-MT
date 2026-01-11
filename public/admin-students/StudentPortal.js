"use strict";

(function () {
  function $(id) { return document.getElementById(id); }
  function setStatus(msg, ok) {
    var el = $("status");
    if (!el) return;
    el.textContent = (ok ? "✅ " : "⚠️ ") + msg;
  }

  var params = new URLSearchParams(window.location.search);
  var SLUG = (params.get("slug") || "mss-demo").trim();

  var selectedId = null;

  function esc(s){ return String(s||""); }

  function rowHtml(s) {
    var name = s.full_name || "(No name)";
    var active = s.is_active ? "Active" : "Inactive";
    var id = s.student_id || s.id; // tolerate either shape

    return (
      '<div class="spRow" data-id="' + id + '">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;">' +
          '<div><div style="font-weight:600;">' + esc(name) + '</div>' +
          '<div class="muted">' + esc(s.email || "") + '</div></div>' +
          '<div class="pill' + (s.is_active ? "" : " off") + '">' + active + "</div>" +
        "</div>" +
        '<div class="muted" style="margin-top:6px;">' +
          "Submissions: " + (s.submissions_count || 0) +
          (s.last_submission_at ? (" • Last: " + new Date(s.last_submission_at).toLocaleString()) : "") +
        "</div>" +
      "</div>"
    );
  }


  async function fetchList() {
    var q = ($("spQ").value || "").trim();
    var tag = ($("spTag").value || "").trim();
    var activeOnly = !!$("spActiveOnly").checked;

    var url = "/api/teacher/students?slug=" + encodeURIComponent(SLUG) +
    "&q=" + encodeURIComponent(q) +
    "&activeOnly=" + (activeOnly ? "1" : "0") +   // FIX Jan 8
    "&tag=" + encodeURIComponent(tag) +
    "&ts=" + Date.now();

    setStatus("Loading students…", false);

    var res = await adminFetch(url, { cache: "no-store" }); // FIX Jan 8
    var body = await res.json().catch(function(){ return {}; });

    if (!res.ok || body.ok === false) {
      setStatus("Failed to load students", false);
      console.warn("students load error", body);
      return;
    }

    var list = Array.isArray(body.students) ? body.students : [];
    var el = $("spList");
    el.innerHTML = list.length ? list.map(rowHtml).join("") : '<div class="muted">No students found.</div>';

    setStatus("Loaded " + list.length + " students", true);

    // wire clicks
    var rows = el.querySelectorAll(".spRow");
    Array.prototype.forEach.call(rows, function(r){
      r.addEventListener("click", function(){
        selectStudent(Number(r.getAttribute("data-id")));
      });
    });
  }

  async function selectStudent(id) {
    if (!id) return;
    selectedId = id;

    var url = "/api/teacher/students/" + encodeURIComponent(id) +
    "?slug=" + encodeURIComponent(SLUG) + "&ts=" + Date.now();

    setStatus("Loading student…", false);

    var res = await adminFetch(url, { cache: "no-store" }); // FIX Jan 8
    var body = await res.json().catch(function(){ return {}; });

    if (!res.ok || body.ok === false || !body.student) {
      setStatus("Failed to load student", false);
      console.warn("student get error", body);
      return;
    }

    renderDetail(body);
    setStatus("Loaded student", true);
  }

  function renderDetail(payload) {
    $("spDetailEmpty").style.display = "none";
    $("spDetail").style.display = "block";

    var s = payload.student || {};
    var stats = payload.stats || {};

    $("dName").textContent = s.full_name || "(No name)";
    $("dEmail").textContent = s.email || "";
    $("dId").textContent = String(s.id || "");
    $("dPhone").textContent = s.phone || "";
    $("dExternal").textContent = s.external_id || "";
    $("dL1").textContent = s.l1 || "";
    $("dStarted").textContent = s.date_started ? String(s.date_started) : "";
    $("dTags").textContent = Array.isArray(s.tags) ? s.tags.join(", ") : "";
    $("dSummary").value = s.summary || "";

    var pill = $("dActivePill");
    pill.textContent = s.is_active ? "Active" : "Inactive";
    pill.className = "pill" + (s.is_active ? "" : " off");

    $("dStats").textContent =
      "Submissions: " + (stats.submissions_count || 0) +
      (stats.last_submission_at ? (" • Last: " + new Date(stats.last_submission_at).toLocaleString()) : "") +
      (stats.last_cefr ? (" • CEFR: " + stats.last_cefr) : "") +
      (stats.last_toefl_est != null ? (" • TOEFL: " + stats.last_toefl_est) : "");
  }

  async function saveProfile() {
    if (!selectedId) return;

    var url =
    "/api/teacher/students/" + encodeURIComponent(selectedId) +
    "/profile?slug=" + encodeURIComponent(SLUG) + "&ts=" + Date.now(); // FIX


    var body = {
      slug: SLUG,
      summary: ($("dSummary").value || "").trim()
      // later: phone, tags, etc.
    };

    var res = await adminFetch(url, {                 // FIX
       method: "PUT",
       body: JSON.stringify(body)
    });

    var out = await res.json().catch(function(){ return {}; });
    if (!res.ok || out.ok === false) {
      setStatus("Save failed", false);
      return;
    }
    setStatus("Saved profile", true);
    await selectStudent(selectedId);
    await fetchList();
  }

  // boot
  window.addEventListener("DOMContentLoaded", function(){
    $("spSearchBtn").addEventListener("click", fetchList);
    $("spQ").addEventListener("keydown", function(e){ if (e.key === "Enter") fetchList(); });

    $("dSaveBtn").addEventListener("click", saveProfile);

    fetchList().catch(function(err){
      console.error(err);
      setStatus("Error loading page", false);
    });
  });
})();