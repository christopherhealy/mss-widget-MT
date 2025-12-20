// /public/js/dashboard-core.js Nov 27 AM (REGEN with BACKEND_BASE + cache fallback)
console.log("✅ dashboard-core.js file loaded");

(function (global) {
  "use strict";

  /* -----------------------------------------------------------
     BACKEND BASE (same pattern as widget-core)
  ----------------------------------------------------------- */
  const BACKEND_BASE = (() => {
    if (typeof window === "undefined") return "";

    const h = window.location.hostname || "";

    // Local dev: Express serves static + APIs on same origin
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h.endsWith(".local")
    ) {
      return ""; // same-origin
    }

    // Vercel: static only → talk to Render backend
    if (h.endsWith(".vercel.app")) {
      return "https://mss-widget-mt.onrender.com";
    }

    // Default: assume we are on the Node/Render host already
    return "";
  })();

  // Allow manual override via window.MSS_BACKEND_BASE, else use BACKEND_BASE
  const API_BASE =
    (typeof window !== "undefined" && window.MSS_BACKEND_BASE) ||
    BACKEND_BASE;

  const Dashboard = {};

  /* -----------------------------------------------------------
     URL + param helpers
  ----------------------------------------------------------- */
  function getParams() {
    return new URLSearchParams(window.location.search || "");
  }

  function getSlug() {
    const slug = (getParams().get("slug") || "").trim();
    return slug;
  }

  function getSubmissionId() {
    const raw = (getParams().get("submissionId") || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function isPreview() {
    return getParams().get("preview") === "1";
  }

  /* -----------------------------------------------------------
     Tiny DOM helpers
  ----------------------------------------------------------- */
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
  const iframe =
    document.getElementById("cefrGauge") ||
    document.getElementById("gaugeFrame");

  if (!iframe || !iframe.contentWindow) {
    console.log("📈 Gauge iframe not found or not ready.");
    return;
  }

  const cefr = r?.cefr ?? null;
  const score = r?.overall ?? r?.score ?? null;

  console.log("📈 Posting gauge update:", { cefr, score });

  iframe.contentWindow.postMessage(
    { type: "mss:gauge:update", cefr, score },
    "*"
  );
}
  /* -----------------------------------------------------------
     LocalStorage cache (optional fallback)
     Matches cacheDashboardResult() in widget-core
  ----------------------------------------------------------- */
  function getCachedDashboardResult(slug, submissionId) {
    if (typeof window === "undefined" || !window.localStorage) return null;

    try {
      let payload = null;

      if (slug && submissionId != null) {
        const key = `mss-dash:${slug}:${submissionId}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          payload = JSON.parse(raw);
        }
      }

      if (!payload) {
        const lastRaw = localStorage.getItem("mss-dash:last");
        if (lastRaw) {
          payload = JSON.parse(lastRaw);
        }
      }

      if (!payload || !payload.result) return null;
      console.log("🧺 Using cached dashboard result from localStorage:", {
        slug,
        submissionId,
        payload,
      });
      return payload.result; // already normalized shape
    } catch (err) {
      console.warn("getCachedDashboardResult error:", err);
      return null;
    }
  }

  /* -----------------------------------------------------------
     applyResults – main UI renderer
  ----------------------------------------------------------- */
  Dashboard.applyResults = function (r) {
    if (!r) {
      console.warn("Dashboard.applyResults called with null result");
      return;
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
      setText("wpmInfo", n + "words per minute");
    } else {
      setText("wpmInfo", "–");
    }

    buildBadges(r);

    const transcriptEl = document.getElementById("transcriptBody");
    if (transcriptEl) {
      const raw = r.transcript || "";
      const cleaned = cleanHtmlToText(raw);

      if (cleaned) {
        transcriptEl.textContent = cleaned;
        transcriptEl.classList.remove("empty");
      } else {
        transcriptEl.textContent =
          "Transcript not available for this answer.";
        transcriptEl.classList.add("empty");
      }
    }

    const notesEl = document.getElementById("notesBody");
    if (notesEl) {
      const note = r.note || r.teacher || "";
      if (note && String(note).trim()) {
        notesEl.textContent = String(note).trim();
        notesEl.classList.remove("empty");
      } else {
        notesEl.textContent =
          "No teacher notes were returned for this answer.";
        notesEl.classList.add("empty");
      }
    }

    const debugEl = document.getElementById("debugContent");
    if (debugEl) {
      debugEl.textContent = JSON.stringify(r, null, 2);
    }

    updateGauge(r);
  };

  /* -----------------------------------------------------------
     Debug toggle
  ----------------------------------------------------------- */
  function setupDebugToggle() {
    const toggle = document.getElementById("debugToggle");
    const content = document.getElementById("debugContent");
    if (!toggle || !content) return;

    toggle.addEventListener("click", () => {
      const isOpen = content.classList.toggle("show");
      toggle.classList.toggle("open", isOpen);
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      content.setAttribute("aria-hidden", isOpen ? "false" : "true");
    });
  }

  /* -----------------------------------------------------------
     DB loader (with cache fallback)
  ----------------------------------------------------------- */
  Dashboard.loadFromDB = async function (slug, submissionId) {
    const url = `${API_BASE}/api/admin/reports/${encodeURIComponent(
      slug
    )}?limit=200`;
    console.log("📡 Dashboard.loadFromDB →", {
      url,
      slug,
      submissionId,
    });

    try {
      const res = await fetch(url);
      const json = await res.json();
      console.log("📡 /api/admin/reports response:", json);

      if (!json.ok || !Array.isArray(json.tests)) {
        console.error("Dashboard: bad DB payload:", json);
        // fall through to cache
        const cached = getCachedDashboardResult(slug, submissionId);
        return cached;
      }

      let row = null;

      if (submissionId != null && !Number.isNaN(submissionId)) {
        row =
          json.tests.find((t) => Number(t.id) === submissionId) ||
          null;
      }

      if (!row) row = json.tests[0] || null;

      if (!row) {
        console.warn("Dashboard: no rows for slug", slug);
        const cached = getCachedDashboardResult(slug, submissionId);
        return cached;
      }

      console.log("📡 Dashboard selected row:", row);
      return Dashboard.mapRow(row);
    } catch (err) {
      console.error(
        "Dashboard.loadFromDB fetch error – trying local cache:",
        err
      );
      const cached = getCachedDashboardResult(slug, submissionId);
      return cached;
    }
  };

  /* -----------------------------------------------------------
     Report row → results object
  ----------------------------------------------------------- */
  Dashboard.mapRow = function (row) {
    const overall = row.vox_score != null ? Number(row.vox_score) : null;

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
     postMessage handler (fallback)
  ----------------------------------------------------------- */
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
     Preview mode
  ----------------------------------------------------------- */
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

  /* -----------------------------------------------------------
     init()
  ----------------------------------------------------------- */
  Dashboard.init = async function ({ mode = "auto" } = {}) {
    const slug = getSlug();
    const submissionId = getSubmissionId();
    const previewFlag = isPreview();

    console.log("🚀 Dashboard.init()", {
      mode,
      slug,
      submissionId,
      previewFlag,
      API_BASE,
    });

    setupDebugToggle();

    if (mode === "preview" || previewFlag) {
      Dashboard.loadPreview();
      return;
    }

    // If we have slug + submissionId, prefer DB mode
    if (mode === "db" || (slug && submissionId != null)) {
      const result = await Dashboard.loadFromDB(slug, submissionId);
      if (result) {
        Dashboard.applyResults(result);
      } else {
        console.warn(
          "Dashboard.init: no result from DB or cache, enabling postMessage fallback."
        );
        Dashboard.enablePostMessage();
      }
      return;
    }

    // Fallback: embedded/postMessage mode
    Dashboard.enablePostMessage();
  };

  function autoInit() {
    try {
      Dashboard.init();
    } catch (err) {
      console.error("Dashboard autoInit error:", err);
    }
  }

  // Auto-init when dashboards load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  global.Dashboard = Dashboard;
})(window);