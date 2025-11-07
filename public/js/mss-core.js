// public/js/mss-core.js
// Shared helpers for MSS Widget + Dashboard
// Exposes a single global: window.MSSCore

(function (global) {
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeMssPayload(raw) {
    if (!raw) return {
      raw: raw,
      score: null,
      cefr: null,
      toefl: null,
      ielts: null,
      pte: null,
      fluency: null,
      grammar: null,
      pronunciation: null,
      vocabulary: null,
      transcript: ''
    };

    const outer = raw.payload || raw.result || raw.received || raw;
    const r = outer.received || outer;
    const elsa = r.elsa_results || r.elsa || {};

    const cefr =
      (elsa.cefr_level ||
        r.cefr_level ||
        r.cefr ||
        (typeof r.cefr === "string" ? r.cefr : "") || "")
        .toString()
        .toUpperCase()
        .trim() || null;

    return {
      raw: raw,

      // overall score
      score: num(r.score),

      // CEFR + test equivalents
      cefr,
      toefl: num(elsa.toefl_score),
      ielts: num(elsa.ielts_score),
      pte: num(elsa.pte_score),

      // subscores (0–100)
      fluency: num(elsa.fluency),
      grammar: num(elsa.grammar),
      pronunciation: num(elsa.pronunciation),
      vocabulary: num(elsa.vocabulary),

      // transcript (raw HTML or text)
      transcript:
        r.transcript || r.rawTranscript || outer.transcript || ""
    };
  }

  function ratingLabel(score) {
    if (score == null) return "–";
    if (score >= 90) return "Excellent";
    if (score >= 80) return "Strong";
    if (score >= 70) return "Good";
    if (score >= 60) return "Fair";
    return "Needs work";
  }

  function stripTranscript(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = String(html);
    const text = div.textContent || div.innerText || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function listenForMssResult(handler) {
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d) return;

      const looksLikeMss =
        d.type === "mss:result" ||
        d.type === "mss-result" ||
        d.type === "mssScore" ||
        d.result ||
        d.meta ||
        d.elsa_results ||
        d.received;

      if (!looksLikeMss) return;

      const normalized = normalizeMssPayload(d);
      try {
        handler(normalized, d);
      } catch (err) {
        console.error("MSSCore handler error:", err);
      }
    });
  }

  global.MSSCore = {
    normalizeMssPayload,
    listenForMssResult,
    ratingLabel,
    stripTranscript
  };
})(window);