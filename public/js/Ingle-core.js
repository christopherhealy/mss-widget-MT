/* Ingle-core.js — v0.7
   - Reuses widget-core.js for recording + submit
   - DEV: always authed as tickittaskit@gmail.com
   - Always shows tomorrow preview (until daily endpoint is wired)
   - Feed rows are SINGLE LINE:
       @handle | play | CEFR gradient bar | streak/total | like/follow
   - Newest row appears automatically AFTER scoring returns (actual score + CEFR)
     via a CustomEvent fired by widget-core.js: "ingle:scored"
   - Like button toggles red + heart glyph
*/

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const DEV_ALWAYS_AUTH = true;
  const DEV_EMAIL = "tickittaskit@gmail.com";
  const DEV_HANDLE = "tickittaskit";

  const authKey = "ingle_authed_v0";
  const isAuthed = () => localStorage.getItem(authKey) === "1";
  const setAuthed = () => localStorage.setItem(authKey, "1");

  function showAuth(on) {
    const gate = $("authGate");
    if (gate) gate.style.display = on ? "" : "none";
  }

  function setStatus(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  function ensureEmailInput() {
    let el = $("ingleEmail");
    if (!el) {
      el = document.createElement("input");
      el.type = "email";
      el.id = "ingleEmail";
      el.style.display = "none";
      document.body.appendChild(el);
    }
    return el;
  }

  function initDateAndTomorrowPreview() {
    const d = new Date();
    const todayKey = d.toISOString().slice(0, 10);

    const dateEl = $("ingleDate");
    if (dateEl) dateEl.textContent = todayKey;

    // Always show tomorrow preview (until daily endpoint is wired)
    const tomorrowEl = $("tomorrowPreview");
    if (tomorrowEl) {
      const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tKey = t.toISOString().slice(0, 10);
      const cur = (tomorrowEl.textContent || "").trim();
      if (!cur || /^loading/i.test(cur)) {
        tomorrowEl.textContent =
          `(${tKey}) Should people be expected to respond to text messages immediately? Why or why not?`;
      }
    }
  }

  function wireAuthButtons() {
    const ids = ["btnGoogle", "btnApple", "btnWhatsApp", "btnWeChat", "btnSMS", "btnEmail"];
    ids.forEach((id) => {
      const btn = $(id);
      if (!btn) return;

      btn.addEventListener("click", () => {
        if (DEV_ALWAYS_AUTH) {
          showAuth(false);
          return;
        }

        setAuthed();
        const email = String($("ingleEmail")?.value || "").trim().toLowerCase();
        if (!email) {
          setStatus("Please enter your email to submit.");
          $("ingleEmail")?.focus();
          return;
        }

        showAuth(false);
        setStatus("Signed in (prototype). Submitting now…");
        $("submitBtn")?.click();
      });
    });
  }

  function interceptSubmit() {
    const submitBtn = $("submitBtn");
    if (!submitBtn) return;

    // capture phase so we run before widget-core's click handler if we ever re-enable auth gate
    submitBtn.addEventListener(
      "click",
      (e) => {
        if (DEV_ALWAYS_AUTH || isAuthed()) return; // allow through

        e.preventDefault();
        e.stopImmediatePropagation();
        showAuth(true);
        setStatus("Sign in to submit your Ingle (prototype).");
      },
      true
    );
  }

  // -------------------------
  // CEFR bar utilities
  // -------------------------

  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

  function posFromCefr(cefr) {
    const c = String(cefr || "").toUpperCase().trim();
    if (c === "A1") return 0.08;
    if (c === "A2") return 0.23;
    if (c === "B1") return 0.40;
    if (c === "B2") return 0.60;
    if (c === "C1") return 0.78;
    if (c === "C2") return 0.93;
    return 0.50;
  }

  function posFromScore0to100(score) {
    const s = Number(score);
    if (!Number.isFinite(s)) return 0.5;
    return clamp01(s / 100);
  }

  // Prefer a true 0..1 if it exists; else normalize 0..100; else fallback to CEFR map
  function extractCefr(mss) {
    const elsa = mss?.elsa_results || mss?.elsa || {};
    return (
      elsa?.cefr_level ||
      mss?.cefr ||
      mss?.cefr_level ||
      mss?.scores?.cefr ||
      mss?.details?.cefr ||
      null
    );
  }

  function extractScore01(mss) {
    const s01 =
      mss?.score01 ??
      mss?.overall?.score01 ??
      null;

    if (Number.isFinite(Number(s01))) return clamp01(Number(s01));

    const s100 =
      mss?.vox_score ??
      mss?.score ??
      mss?.overall_score ??
      mss?.overall?.score ??
      null;

    if (Number.isFinite(Number(s100))) {
      const n = Number(s100);
      // If it already looks like 0..1, keep it
      if (n <= 1.2) return clamp01(n);
      return clamp01(n / 100);
    }

    const cefr = extractCefr(mss);
    return posFromCefr(cefr);
  }

  // -------------------------
  // FEED: single-line row
  // -------------------------

  function ensureFeed() {
    return $("feedList") || null;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function wireLike(btn) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const liked = btn.classList.toggle("liked");
      btn.textContent = liked ? "♥" : "♡";
    });
  }

  function wireFollow(btn) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const following = btn.classList.toggle("following");
      btn.textContent = following ? "✓" : "＋";
    });
  }

  // audioUrl: optional (dev uses local object URL)
  // dashboardUrl: optional (available from /api/widget/submit when you want it)
  function prependIngleRow({ handle, cefr, streak, total, audioUrl, dashboardUrl, pos01 }) {
    const feed = ensureFeed();
    if (!feed) return;

    const safeHandle = escapeHtml(handle || "anon");
    const safeCefr = escapeHtml(cefr || "—");
    const leftPct = Math.round(clamp01(pos01 ?? posFromCefr(cefr)) * 100);

    const hasAudio = !!audioUrl;
    const hasDash = !!dashboardUrl;

    const row = document.createElement("div");
    row.className = "ingle-row ingle-row-new";
    row.dataset.audioUrl = audioUrl || "";
    row.dataset.dashboardUrl = dashboardUrl || "";

    row.innerHTML = `
      <div class="ingle-user">@${safeHandle}</div>

      <div class="ingle-playcell">
        <button class="ingle-play" type="button" ${(!hasAudio && !hasDash) ? "disabled" : ""} aria-label="Play">
          ▶
        </button>
      </div>

      <div class="ingle-bar-wrap">
        <div class="ingle-bar">
          <div class="ingle-marker" style="left:${leftPct}%;"></div>
        </div>
        <div class="ingle-cefr-pill" style="left:${leftPct}%;">${safeCefr}</div>
      </div>

      <div class="ingle-meta">
        <span title="streak">🔥 <strong>${Number(streak || 0)}</strong></span>
        <span title="all-time ingles">🎯 <strong>${Number(total || 0)}</strong></span>
      </div>

      <div class="ingle-actions">
        <button type="button" class="ingle-act" aria-label="Like">♡</button>
        <button type="button" class="ingle-act" aria-label="Follow">＋</button>
      </div>
    `;

    // Play behavior
    row.querySelector(".ingle-play")?.addEventListener("click", () => {
      const aUrl = row.dataset.audioUrl || "";
      const dUrl = row.dataset.dashboardUrl || "";

      if (aUrl) return playInline(aUrl);
      if (dUrl) return window.open(dUrl, "_blank", "noopener,noreferrer");
    });

    // Like/Follow toggles
    wireLike(row.querySelector('[aria-label="Like"]'));
    wireFollow(row.querySelector('[aria-label="Follow"]'));

    feed.prepend(row);
    setTimeout(() => row.classList.remove("ingle-row-new"), 450);
  }

  // Simple inline player: reuse existing #playerWrap/#player
  function playInline(url) {
    const wrap = $("playerWrap");
    const player = $("player");
    if (!wrap || !player) return;

    try {
      player.src = url;
      wrap.style.display = "";
      player.play().catch(() => {});
      setStatus("Playing…");
    } catch {
      // ignore
    }
  }

  // Expose for other scripts (optional)
  window.INGLE = {
    prependIngleRow,
    posFromScore0to100,
    posFromCefr,
  };

  // -------------------------
  // Listen for real scoring event from widget-core.js
  // widget-core should dispatch:
  //   window.dispatchEvent(new CustomEvent("ingle:scored", { detail: { mss, localBlobUrl, dashboardUrl? } }));
  // -------------------------
  window.addEventListener("ingle:scored", (ev) => {
    const d = ev.detail || {};
    const mss = d.mss || {};

    const cefr = extractCefr(mss) || "—";
    const score01 = extractScore01(mss);

    // For demo: assume your identity
    prependIngleRow({
      handle: DEV_HANDLE,
      cefr,
      streak: 45,
      total: 1203,
      pos01: score01,
      audioUrl: d.localBlobUrl || "",
      dashboardUrl: d.dashboardUrl || "",
    });

    // Optional: update mini score section if you are using it
    const scoreWrap = $("scoreWrap");
    const cefrLabel = $("cefrLabel");
    const scoreMarker = $("scoreMarker");
    const scorePill = $("scoreCefrPill");

    if (scoreWrap) scoreWrap.style.display = "";
    if (cefrLabel) cefrLabel.textContent = cefr;

    const pct = Math.round(score01 * 100);
    if (scoreMarker) scoreMarker.style.left = `${pct}%`;
    if (scorePill) {
      scorePill.style.left = `${pct}%`;
      scorePill.textContent = cefr;
    }
  });

  // -------------------------
  // Boot
  // -------------------------

  document.addEventListener("DOMContentLoaded", () => {
    initDateAndTomorrowPreview();

    const emailEl = ensureEmailInput();
    if (DEV_ALWAYS_AUTH) {
      setAuthed();
      if (!emailEl.value) emailEl.value = DEV_EMAIL;
      showAuth(false);
      setStatus(`Signed in (dev): ${DEV_EMAIL}`);
    } else {
      showAuth(false);
    }

    wireAuthButtons();
    interceptSubmit();

    // Seed rows (single-line, mostly for layout testing)
    prependIngleRow({ handle: "chen",  cefr: "C1", streak: 7,  total: 41,   pos01: posFromCefr("C1") });
    prependIngleRow({ handle: "maria", cefr: "B1", streak: 12, total: 88,   pos01: posFromCefr("B1") });
    prependIngleRow({ handle: DEV_HANDLE, cefr: "B2", streak: 45, total: 1203, pos01: posFromCefr("B2") });
  });
})();