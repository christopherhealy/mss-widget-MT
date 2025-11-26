// /public/js/vox-dashboard.js — shared logic for Vox Dashboards 2 & 3
console.log("✅ vox-dashboard.js loaded");

(function (global) {
  "use strict";

  const Dashboard = {};

  /* -----------------------------------------------------------
   * URL helpers
   * --------------------------------------------------------- */
  function params() {
    return new URLSearchParams(window.location.search || "");
  }

  function getSlug() {
    return (params().get("slug") || "").trim();
  }

  function getSubmissionId() {
    const raw = (params().get("submissionId") || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function isPreview() {
    return params().get("preview") === "1";
  }

  /* -----------------------------------------------------------
   * Tiny DOM helpers
   * --------------------------------------------------------- */
  function setText(id, value, emptyLabel) {
    const el = document.getElementById(id);
    if (!el) return;
    if (value == null || value === "") {
      el.textContent =
        emptyLabel != null
          ? emptyLabel
          : "–";
    } else {
      el.textContent = value;
    }
  }

  function fmtScore(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "–.–";
    return n.toFixed(2);
  }

  function cleanHtmlToText(html) {
    if (!html) return "";
    let src = String(html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n");

    const tmp = document.createElement("div");
    tmp.innerHTML = src;

    let text = tmp.textContent || tmp.innerText || "";
    text = text.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n");
    text = text.replace(/[ \t\u2000-\u200B]+/g, " ");

    return text.trim();
  }

  function buildBadges(r) {
    const container = document.getElementById("summaryBadges");
    if (!container) return;
    container.innerHTML = "";

    if (!r) {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = "Waiting for results…";
      container.appendChild(span);
      return;
    }

    const add = (label, kind) => {
      const span = document.createElement("span");
      span.className = "badge" + (kind ? " " + kind : "");
      span.textContent = label;
      container.appendChild(span);
    };

    if (r.toefl) add("TOEFL " + r.toefl, "good");
    if (r.ielts) add("IELTS " + r.ielts, "good");
    if (r.pte) add("PTE " + r.pte, "good");
    if (r.cefr) add("CEFR " + r.cefr, "good");

    if (r.wpm != null) {
      const wpm = Number(r.wpm);
      if (wpm < 80) add("Try speaking a bit faster", "warn");
      else if (wpm > 180) add("Try slowing down slightly", "warn");
      else add("Nice pacing", "good");
    }

    if (!container.children.length) {
      add("No standardized score mapping available", "");
    }
  }

  function updateGauge(r) {
    const iframe = document.getElementById("cefrGauge");
    if (!iframe || !iframe.contentWindow) {
      console.log("📈 Gauge iframe not ready");
      return;
    }

    const cefr = r && r.cefr ? r.cefr : null;
    const score =
      r && r.overall != null
        ? r.overall
        : r && r.score != null
        ? r.score
        : null;

    console.log("📈 Posting gauge update:", { cefr, score });

    iframe.contentWindow.postMessage(
      {
        type: "mss:gauge:update",
        cefr,
        score,
      },
      "*"
    );
  }

  /* -----------------------------------------------------------
   * Main renderer
   * --------------------------------------------------------- */
  Dashboard.applyResults = function (r) {
    if (!r) {
      console.warn("Dashboard.applyResults called with null result");
    }

    console.log("🎨 Dashboard.applyResults()", r);

    const sessionId = r.sessionId || r.session || "–";
    setText("sessionIdLabel", sessionId);

    const overall =
      r.overall != null
        ? r.overall
        : r.score != null
        ? r.score
        : null;
    setText("overallScore", fmtScore(overall));

    setText("cefrLevel", r.cefr || "–");

    const eqParts = [];
    if (r.toefl) eqParts.push("TOEFL " + r.toefl);
    if (r.ielts) eqParts.push("IELTS " + r.ielts);
    if (r.pte) eqParts.push("PTE " + r.pte);
    setText("testEquivalencies", eqParts.join(" · ") || "–");

    if (r.lengthSec != null) {
      const sec = Math.round(Number(r.lengthSec) || 0);
      setText("lengthInfo", "Length: " + sec + "s");
    } else {
      setText("lengthInfo", "Length: –");
    }

    if (r.wpm != null) {
      const n = Math.round(Number(r.wpm) || 0);
      setText("wpmInfo", n + " words per minute");
    } else {
      setText("wpmInfo", "–");
    }

    buildBadges(r);

    const transcriptEl = document.getElementById("transcriptBody");
    if (transcriptEl) {
      const raw = r.transcript || "";
      const cleaned = cleanHtmlToText(raw);
      transcriptEl.textContent =
        cleaned ||
        "Transcript not available for this answer.";
    }

    const notesEl = document.getElementById("notesBody");
    if (notesEl) {
      const note = r.note || r.teacher || "";
      notesEl.textContent =
        (note && String(note).trim()) ||
        "No teacher notes were returned for this answer.";
    }

    const debugEl = document.getElementById("debugContent");
    if (debugEl) {
      debugEl.textContent = JSON.stringify(r, null, 2);
    }

    updateGauge(r);
  };

  /* -----------------------------------------------------------
   * DB loader
   * --------------------------------------------------------- */
  Dashboard.loadFromDB = async function (slug, submissionId) {
    const url = `/api/admin/reports/${encodeURIComponent(slug)}?limit=200`;
    console.log("📡 Dashboard.loadFromDB →", { url, slug, submissionId });

    const res = await fetch(url);
    const json = await res.json();

    console.log("📡 /api/admin/reports response:", json);

    if (!json.ok || !Array.isArray(json.tests)) {
      console.error("Dashboard: bad DB payload:", json);
      return null;
    }

    let row = null;

    if (submissionId != null && !Number.isNaN(submissionId)) {
      row =
        json.tests.find((t) => Number(t.id) === submissionId) || null;
    }

    if (!row) row = json.tests[0] || null;
    if (!row) {
      console.warn("Dashboard: no rows for slug", slug);
      return null;
    }

    console.log("📡 Dashboard selected row:", row);
    return Dashboard.mapRow(row);
  };

  Dashboard.mapRow = function (row) {
    const overall =
      row.vox_score != null ? Number(row.vox_score) : null;

    const mapped = {
      sessionId: row.id,
      overall,
      score: overall,
      cefr: row.mss_cefr || row.cefr || null,
      toefl:
        row.mss_toefl != null
          ? row.mss_toefl
          : row.toefl != null
          ? row.toefl
          : null,
      ielts:
        row.mss_ielts != null
          ? row.mss_ielts
          : row.ielts != null
          ? row.ielts
          : null,
      pte:
        row.mss_pte != null
          ? row.mss_pte
          : row.pte != null
          ? row.pte
          : null,
      lengthSec:
        row.length_sec != null
          ? row.length_sec
          : row.length != null
          ? row.length
          : null,
      wpm: row.wpm != null ? row.wpm : null,
      transcript: row.transcript_clean || row.transcript || "",
      note: null,
    };

    console.log("🧮 Dashboard.mapRow →", mapped);
    return mapped;
  };

  /* -----------------------------------------------------------
   * Preview + postMessage fallback
   * --------------------------------------------------------- */
  Dashboard.loadPreview = function () {
    console.log("🎭 Dashboard.loadPreview()");
    Dashboard.applyResults({
      sessionId: "demo-preview",
      overall: 3.15,
      cefr: "B2",
      toefl: 95,
      ielts: 7.0,
      pte: 65,
      lengthSec: 43,
      wpm: 140,
      transcript:
        "This is a sample transcript. When you record an answer in the widget, your words will be shown here so you can review your performance.",
      note: "Preview mode only – these values are not stored.",
    });
  };

  Dashboard.enablePostMessage = function () {
    console.log("📥 Dashboard listening for postMessage mss-results");
    window.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type !== "mss-results") return;
      const payload = data.payload || {};
      Dashboard.applyResults(payload);
    });
  };

  /* -----------------------------------------------------------
   * init + autoInit
   * --------------------------------------------------------- */
  Dashboard.init = async function ({ mode = "auto" } = {}) {
    const slug = getSlug();
    const submissionId = getSubmissionId();
    const previewFlag = isPreview();

    console.log("🚀 Vox Dashboard.init()", {
      mode,
      slug,
      submissionId,
      previewFlag,
    });

    if (mode === "preview" || previewFlag) {
      Dashboard.loadPreview();
      return;
    }

    if (mode === "db" || (slug && submissionId != null)) {
      const result = await Dashboard.loadFromDB(slug, submissionId);
      if (result) {
        Dashboard.applyResults(result);
      } else {
        console.warn(
          "Vox Dashboard.init: no result from DB, falling back to postMessage."
        );
        Dashboard.enablePostMessage();
      }
      return;
    }

    Dashboard.enablePostMessage();
  };

  function autoInit() {
    try {
      Dashboard.init();
    } catch (err) {
      console.error("Vox Dashboard autoInit error:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  global.VoxDashboard = Dashboard;
})(window);