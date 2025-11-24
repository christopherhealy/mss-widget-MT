// public/js/dashboard-core.js — shared MSS dashboard logic
// Uses v_submission_scores (including transcript_clean)
console.log("✅ dashboard-core.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const STATE = {
    slug: null,
    rows: [],
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    STATE.slug = resolveSlug() || "mss-demo";

    // Optional label for current slug
    const slugLabel = $("dashSlug");
    if (slugLabel) slugLabel.textContent = STATE.slug;

    $("refreshBtn")?.addEventListener("click", loadData);
    $("downloadCsvBtn")?.addEventListener("click", onDownloadCsv);

    loadData();
  }

  /* ------------------------------------------------------------------
     SLUG RESOLUTION
     ------------------------------------------------------------------ */

  function resolveSlug() {
    // 1) ?slug= in URL
    try {
      const params = new URLSearchParams(window.location.search || "");
      const fromUrl = (params.get("slug") || "").trim();
      if (fromUrl) return fromUrl;
    } catch {
      // ignore
    }

    // 2) data-slug on a root container (e.g. #mss-dashboard-root)
    const root =
      $("mss-dashboard-root") ||
      $("mss-widget-root") ||
      document.body;
    if (root && root.dataset && root.dataset.slug) {
      const ds = root.dataset.slug.trim();
      if (ds) return ds;
    }

    // 3) Last widget result in sessionStorage
    try {
      const raw = sessionStorage.getItem("mss-widget-latest-result");
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.slug) {
          return String(obj.slug).trim();
        }
      }
    } catch {
      // ignore
    }

    // 4) fallback
    return null;
  }

  /* ------------------------------------------------------------------
     LOAD DATA FROM /api/dashboard/submissions
     ------------------------------------------------------------------ */

  async function loadData() {
    setStatus("Loading submissions…");

    const tableBody = $("resultsBody");
    if (tableBody) tableBody.innerHTML = "";

    try {
      const qs = new URLSearchParams({
        slug: STATE.slug,
        limit: "500",
      });

      const res = await fetch(`/api/dashboard/submissions?${qs.toString()}`);
      const json = await res.json();

      if (!res.ok || !json.ok) {
        console.error("Dashboard load error:", json);
        setStatus(json.message || "Could not load submissions.");
        return;
      }

      STATE.rows = json.rows || [];
      renderTable();
      setStatus(`Loaded ${STATE.rows.length} submissions.`);
    } catch (err) {
      console.error("Dashboard fetch exception:", err);
      setStatus("Network error while loading submissions.");
    }
  }

  function setStatus(msg) {
    const el = $("dashStatus");
    if (el) el.textContent = msg || "";
    else console.log("STATUS:", msg);
  }

  /* ------------------------------------------------------------------
     TABLE RENDERING
     ------------------------------------------------------------------ */

  function renderTable() {
    const tbody = $("resultsBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!STATE.rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 12;
      td.textContent = "No submissions found yet.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const row of STATE.rows) {
      const tr = document.createElement("tr");

      // 1) Date / time
      tr.appendChild(tdCell(formatDateTime(row.submitted_at)));

      // 2) Question (shortened to keep table readable)
      tr.appendChild(tdCell(shorten(row.question, 80)));

      // 3) Vox
      tr.appendChild(tdCell(num(row.vox_score)));

      // 4) CEFR
      tr.appendChild(tdCell(row.mss_cefr || ""));

      // 5–8) Elsa subscores
      tr.appendChild(tdCell(num(row.mss_fluency)));
      tr.appendChild(tdCell(num(row.mss_grammar)));
      tr.appendChild(tdCell(num(row.mss_pron)));
      tr.appendChild(tdCell(num(row.mss_vocab)));

      // 9–11) TOEFL / IELTS / PTE
      tr.appendChild(tdCell(num(row.mss_toefl)));
      tr.appendChild(tdCell(num(row.mss_ielts)));
      tr.appendChild(tdCell(num(row.mss_pte)));

      // 12) Transcript button
      const transcriptTd = document.createElement("td");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mss-btn mss-btn-small";
      btn.textContent = "Transcript";
      btn.addEventListener("click", () => showTranscript(row));
      transcriptTd.appendChild(btn);
      tr.appendChild(transcriptTd);

      tbody.appendChild(tr);
    }
  }

  function tdCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text == null ? "" : String(text);
    return cell;
  }

  function formatDateTime(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function num(v) {
    if (v == null) return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    return n.toFixed(1).replace(/\.0$/, "");
  }

  function shorten(str, max) {
    if (!str) return "";
    const s = String(str);
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  /* ------------------------------------------------------------------
     TRANSCRIPT VIEWER (uses transcript_clean)
     ------------------------------------------------------------------ */

  function showTranscript(row) {
    const clean = row.transcript_clean || "";

    const modal = $("transcriptModal");
    const body = $("transcriptBody");
    const title = $("transcriptTitle");

    // If no modal markup exists on this dashboard version, just alert.
    if (!modal || !body) {
      alert(clean || "No transcript available.");
      return;
    }

    if (title) {
      title.textContent =
        "Transcript – " + formatDateTime(row.submitted_at || "");
    }

    body.textContent = clean || "No transcript available.";

    modal.classList.add("open");

    const closeBtn = $("transcriptCloseBtn");
    if (closeBtn && !closeBtn._mssBound) {
      closeBtn.addEventListener("click", () => {
        modal.classList.remove("open");
      });
      closeBtn._mssBound = true;
    }
  }

  /* ------------------------------------------------------------------
     CSV DOWNLOAD (always includes Transcript column)
     ------------------------------------------------------------------ */

 function onDownloadCsv() {
  console.log("✅ NEW dashboard-core onDownloadCsv is running");

  if (!STATE.rows.length) {
    setStatus("No rows to export.");
    return;
  }

  const headers = [
    "Submission ID",
    "Submitted At",
    "Slug",
    "Question",
    "Vox Score",
    "CEFR",
    "Fluency",
    "Grammar",
    "Pronunciation",
    "Vocabulary",
    "TOEFL",
    "IELTS",
    "PTE",
    "Transcript",
  ];

  const lines = [];
  lines.push(toCsvRow(headers));

  for (const r of STATE.rows) {
    const transcript = normalizeTranscriptForCsv(r.transcript_clean || "");

    const row = [
      r.id,
      r.submitted_at,
      r.slug,
      r.question,
      r.vox_score,
      r.mss_cefr,
      r.mss_fluency,
      r.mss_grammar,
      r.mss_pron,
      r.mss_vocab,
      r.mss_toefl,
      r.mss_ielts,
      r.mss_pte,
      transcript,
    ];
    lines.push(toCsvRow(row));
  }

  // Add UTF-8 BOM so Excel chooses the right encoding
  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `mss-submissions-${STATE.slug}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);

  setStatus(`CSV downloaded (${STATE.rows.length} rows).`);
}

 function normalizeTranscriptForCsv(value) {
  if (!value) return "";

  let s = String(value);

  // 1) Strip any HTML tags like <span style="...">...</span>
  s = s.replace(/<[^>]*>/g, "");

  // 2) Normalise whitespace and non-breaking spaces
  s = s.replace(/\u00A0/g, " ");   // NBSP → space
  s = s.replace(/\s+/g, " ").trim();

  return s;
}