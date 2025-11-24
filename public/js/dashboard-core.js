// public/js/dashboard-core.js
// Nov 16, 2025 – MSS Widget MT dashboard logic

"use strict";

(function () {
  /* ------------ DOM helpers ------------ */

  const $ = (id) => document.getElementById(id);

  function setText(id, value) {
    const el = $(id);
    if (!el) return;
    if (value === null || value === undefined || value === "") {
      el.textContent = "—";
    } else {
      el.textContent = String(value);
    }
  }

  function setBar(idFill, idScore, value, max) {
    const fill = $(idFill);
    const score = $(idScore);

    if (!fill || !score || value == null || isNaN(value)) {
      if (fill) fill.style.width = "0%";
      if (score) score.textContent = "—";
      return;
    }

    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    fill.style.width = pct.toFixed(1) + "%";
    score.textContent = String(value);
  }

  function sanitizeTranscript(raw) {
    if (!raw) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = raw;
    const text = tmp.textContent || tmp.innerText || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /* ------------ WPM / duration helpers ------------ */

  function estimateWpm(transcript, lengthSec) {
    if (!transcript) return null;

    const words = transcript.split(/\s+/).filter(Boolean).length;
    const dur = safeNum(lengthSec);

    if (!dur || dur <= 0) return null;

    const wpm = Math.round((words / dur) * 60);

    if (!Number.isFinite(wpm) || wpm <= 0) return null;
    // Clamp to a sane range so we never show wild values like 19300
    if (wpm > 350) return 350;
    return wpm;
  }

  /* ------------ Payload normalization ------------ */

  function normalizePayload(raw) {
    if (!raw || typeof raw !== "object") return null;

    // MSS / Vox body sometimes lives one level down; unwrap if needed
    const body = raw.body || raw.data || raw.result || raw.results || raw;
    const elsa = body.elsa_results || {};

    const toefl =
      safeNum(body.toefl) ??
      safeNum(body.toefl_score) ??
      safeNum(elsa.toefl_score);
    const ielts =
      safeNum(body.ielts) ??
      safeNum(body.ielts_score) ??
      safeNum(elsa.ielts_score);
    const pte =
      safeNum(body.pte) ?? safeNum(body.pte_score) ?? safeNum(elsa.pte_score);

    const cefr = (
      body.cefr ||
      body.cefr_level ||
      elsa.cefr_level ||
      ""
    )
      .toString()
      .toUpperCase();

    const transcript =
      body.transcript ||
      body.cleanedTranscript ||
      body.asrTranscript ||
      "";

    const lengthSec =
      safeNum(body.lengthSec) ||
      safeNum(body.length_sec) ||
      safeNum(body.durationSec) ||
      safeNum(body.audioDurationSec);

    let wpm = safeNum(body.wpm || body.words_per_minute);
    if (wpm == null) {
      wpm = estimateWpm(transcript, lengthSec);
    } else if (wpm > 350) {
      // Hard clamp for obviously bogus values
      wpm = 350;
    }

    const fileName = body.fileName || body.file || "answer.wav";
    const timestamp =
      body.timestamp || body.createdAt || body.ts || body.time || "";
    const question = body.question || "";

    return {
      toefl,
      ielts,
      pte,
      cefr,
      transcript,
      lengthSec,
      wpm,
      fileName,
      timestamp,
      question,
    };
  }

  /* ------------ Session storage wiring ------------ */

  function loadResultFromSession() {
    let raw = null;

    try {
      const params = new URLSearchParams(window.location.search || "");
      const sessionId = (params.get("session") || "").trim();

      if (sessionId) {
        raw = sessionStorage.getItem("mss-widget-session-" + sessionId);
      }

      if (!raw) {
        raw = sessionStorage.getItem("mss-widget-latest-result");
      }

      if (!raw) {
        console.warn("Dashboard: no stored MSS result found in sessionStorage.");
        return null;
      }

      const parsed = JSON.parse(raw);
      console.log("📊 Dashboard loaded raw payload:", parsed);
      return normalizePayload(parsed);
    } catch (e) {
      console.warn("Dashboard: failed to read/parse stored result:", e);
      return null;
    }
  }

  /* ------------ Rendering ------------ */

  function renderDashboard(m) {
    if (!m) {
      // Leave placeholders; nothing to render yet
      return;
    }

    const {
      toefl,
      ielts,
      pte,
      cefr,
      transcript,
      lengthSec,
      wpm,
      fileName,
      timestamp,
      question,
    } = m;

    // Headline + CEFR + question
    if (question) setText("dashQuestion", question);
    setText("dashCefr", cefr ? "CEFR " + cefr : "CEFR —");

    // Main numeric scores
    setText("scoreToefl", toefl);
    setText("scoreIelts", ielts);
    setText("scorePte", pte);
    setText("scoreWpm", wpm);

    // Bars – use typical max ranges
    setBar("barToefl", "barToeflScore", toefl, 30);
    setBar("barIelts", "barIeltsScore", ielts, 9);
    setBar("barPte", "barPteScore", pte, 90);
    setBar("barWpm", "barWpmScore", wpm, 200);

    // Transcript
    const txEl = $("dashTranscript");
    if (txEl) {
      txEl.textContent = sanitizeTranscript(transcript);
    }

    // Meta line
    if (timestamp) {
      setText("dashTimestamp", "Time: " + timestamp);
    } else {
      setText("dashTimestamp", "Time: —");
    }

    setText("dashFile", "File: " + (fileName || "answer.wav"));
  }

  /* ------------ Init ------------ */

  document.addEventListener("DOMContentLoaded", () => {
    const normalized = loadResultFromSession();
    renderDashboard(normalized);
  });
})();