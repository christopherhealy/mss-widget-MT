/* Ingle.js — Feb 3 2026 (regen / cleanup + CEFR range filter)
   Purpose
   - UI + feed layer for Ingle (daily prompt + live results).
   - Aligns with routes/ingles.routes.js:
       GET  /api/ingles/today -> { ok, dateKey, tomorrowDateKey, today:{question_pk,question}, tomorrow:{...} }
       GET  /api/ingles/dev/step?dir=prev|next&from=QUESTION_PK -> { ok, today:{question_pk,question}, tomorrow:{...} }
       GET  /api/ingles/feed?date=YYYY-MM-DD&limit=N -> { ok, items:[...] }
       POST /api/ingles/submit -> handled by ingle-core.js (NOT here)
   Key design decision
   - ingle-core.js owns submit:
       Record/upload -> /api/vox -> /api/ingles/submit -> dispatch "ingle:scored"
   - ingle.js reacts to "ingle:scored" (UI only), and loads/re-hydrates the feed.
   - No submit interception in this file (removes double-submit / blob scope bugs).

   New in this regen
   - Client-side CEFR range filter (min/max) using two sliders:
       #cefrMin (0..5) and #cefrMax (0..5)
     plus:
       #cefrBar (visual fill) and #cefrLabel (text label)
*/

(function () {
  "use strict";

  // -------------------------
  // Minimal global state (safe initializer)
  // -------------------------
  const DEFAULT_FILTER = {
    cefr: { min: "A1", max: "C2", snapToMyLast: true },
    followingOnly: false,
    withAudioOnly: false,
  };

  // Use existing state if another file created it (e.g., ingle-core.js)
  window.INGLE_STATE = window.INGLE_STATE || {
    feed: { dateKey: null, items: [], lastFetchedAt: 0 },
    filter: structuredClone(DEFAULT_FILTER),
    myLastCefr: null,
  };

  // -------------------------
  // CEFR ordering + range helpers
  // -------------------------
  const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

  function cefrToIndex(cefr) {
    const c = String(cefr || "").trim().toUpperCase();
    const i = CEFR_ORDER.indexOf(c);
    return i >= 0 ? i : null;
  }

  function inCefrRange(cefr, min, max) {
    const i = cefrToIndex(cefr);
    const a = cefrToIndex(min);
    const b = cefrToIndex(max);
    if (i == null || a == null || b == null) return false;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return i >= lo && i <= hi;
  }

  // -------------------------
  // DOM helpers
  // -------------------------
  const $ = (id) => document.getElementById(id);

  function setStatus(msg) {
    const el = $("status");
    if (el) el.textContent = String(msg || "");
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

  // -------------------------
  // DEV identity / auth gate (prototype)
  // -------------------------
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
        setStatus("Signed in (prototype). You can submit now.");
      });
    });
  }

  function interceptSubmitForAuthGate() {
    const submitBtn = $("submitBtn");
    if (!submitBtn) return;

    submitBtn.addEventListener(
      "click",
      (e) => {
        if (DEV_ALWAYS_AUTH || isAuthed()) return;

        e.preventDefault();
        e.stopImmediatePropagation();
        showAuth(true);
        setStatus("Sign in to submit your Ingle (prototype).");
      },
      true
    );
  }

  // -------------------------
  // Date helpers (UTC keys)
  // -------------------------
  function toDateKeyUTC(d) {
    return new Date(d).toISOString().slice(0, 10);
  }

  function addDaysUTC(dateKey, days) {
    const d = new Date(`${dateKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + Number(days || 0));
    return toDateKeyUTC(d);
  }

  let viewedDateKey = toDateKeyUTC(new Date());

  const isLocalhost =
    typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1");

  function showDevNavIfLocal() {
    const nav = $("devNav");
    if (nav) nav.style.display = isLocalhost ? "" : "none";

    const lbl = $("devDateLabel");
    if (lbl) lbl.textContent = viewedDateKey;
  }

  function setHeaderDate(dateKey) {
    const dateEl = $("ingleDate");
    if (dateEl) dateEl.textContent = dateKey || "—";

    const lbl = $("devDateLabel");
    if (lbl) lbl.textContent = dateKey || "—";
  }

  let currentTodayPk = null;
  let currentTomorrowPk = null;

  // -------------------------
  // Today / Tomorrow question loader
  // -------------------------
  async function loadTodayTomorrow(dateKey) {
    const q = dateKey ? `?date=${encodeURIComponent(dateKey)}` : "";

    try {
      const res = await fetch(`/api/ingles/today${q}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data || !data.ok) throw new Error(data?.error || "bad_response");

      viewedDateKey = data.dateKey || dateKey || viewedDateKey;
      setHeaderDate(viewedDateKey);

      const todayQ = data?.today?.question || data?.todayQuestion || "—";
      const todayPk = data?.today?.question_pk ?? null;
      currentTodayPk = Number.isFinite(Number(todayPk)) ? Number(todayPk) : null;

      const qEl = $("question");
      if (qEl) qEl.textContent = todayQ;

      const tKey = data.tomorrowDateKey || addDaysUTC(viewedDateKey, 1);
      const tomorrowQ = data?.tomorrow?.question || data?.tomorrowQuestion || "—";
      const tomPk = data?.tomorrow?.question_pk ?? null;
      currentTomorrowPk = Number.isFinite(Number(tomPk)) ? Number(tomPk) : null;

      const tEl = $("tomorrowPreview");
      if (tEl) tEl.textContent = `(${tKey}) ${tomorrowQ}`;

      window.__INGLE_DATEKEY = viewedDateKey;
      window.__INGLE_TODAY_PK = currentTodayPk;
      window.__INGLE_TODAY = data?.today || null;
      window.__INGLE_TOMORROW = data?.tomorrow || null;

      return data;
    } catch (err) {
      console.warn("⚠️ loadTodayTomorrow failed:", err);

      const todayKey = dateKey || viewedDateKey || toDateKeyUTC(new Date());
      viewedDateKey = todayKey;
      setHeaderDate(todayKey);

      window.__INGLE_DATEKEY = todayKey;
      window.__INGLE_TODAY_PK = null;
      window.__INGLE_TODAY = null;
      window.__INGLE_TOMORROW = null;

      const qEl = $("question");
      if (qEl && (!qEl.textContent || /^loading/i.test(qEl.textContent))) {
        qEl.textContent =
          "Do you think kids should be paid for getting good grades? Why or why not?";
      }

      const tEl = $("tomorrowPreview");
      if (tEl && (!tEl.textContent || /^loading/i.test(tEl.textContent))) {
        const tKey = addDaysUTC(todayKey, 1);
        tEl.textContent =
          `(${tKey}) Should people be expected to respond to text messages immediately? Why or why not?`;
      }

      currentTodayPk = null;
      currentTomorrowPk = null;
      return null;
    }
  }

  // -------------------------
  // DEV stepping by question_pk
  // -------------------------
  async function devStep(dir) {
    if (!isLocalhost) return;

    if (!currentTodayPk) {
      setStatus("Dev step unavailable: current question_pk not loaded yet.");
      return;
    }

    try {
      const url = `/api/ingles/dev/step?dir=${encodeURIComponent(dir)}&from=${encodeURIComponent(
        String(currentTodayPk)
      )}`;

      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data || !data.ok) throw new Error(data?.error || "bad_response");

      const todayRow = data.today || {};
      const tomRow = data.tomorrow || {};

      const todayPk = todayRow.question_pk ?? null;
      const tomPk = tomRow.question_pk ?? null;

      currentTodayPk = Number.isFinite(Number(todayPk)) ? Number(todayPk) : currentTodayPk;
      currentTomorrowPk = Number.isFinite(Number(tomPk)) ? Number(tomPk) : currentTomorrowPk;

      const qEl = $("question");
      if (qEl) qEl.textContent = todayRow.question || "—";

      const lbl = $("devDateLabel");
      if (lbl) lbl.textContent = `${viewedDateKey} • pk ${currentTodayPk}`;

      const tEl = $("tomorrowPreview");
      if (tEl) {
        const tKey = addDaysUTC(viewedDateKey, 1);
        tEl.textContent = `(${tKey}) ${tomRow.question || "—"}`;
      }

      await refreshLiveFeed(viewedDateKey);
    } catch (err) {
      console.warn("⚠️ devStep failed:", err);
      setStatus("Dev step failed—check server logs / route wiring.");
    }
  }

  function wireDevDateSteppers() {
    const prev = $("devPrevDay");
    const next = $("devNextDay");
    if (!prev || !next) return;

    prev.addEventListener("click", () => devStep("prev"));
    next.addEventListener("click", () => devStep("next"));
  }

  // -------------------------
  // Score / CEFR helpers (existing)
  // -------------------------
  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

  function posFromCefr(cefr) {
    const c = String(cefr || "").toUpperCase().trim();
    const map = { A1: 1 / 6, A2: 2 / 6, B1: 3 / 6, B2: 4 / 6, C1: 5 / 6, C2: 6 / 6 };
    const x = map[c] ?? 0.5;
    return Math.max(0.01, Math.min(0.99, x));
  }

  function posFromScore0to100(score) {
    const s = Number(score);
    if (!Number.isFinite(s)) return 0.5;
    return clamp01(s / 100);
  }

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
    const s01 = mss?.score01 ?? mss?.overall?.score01 ?? null;
    if (Number.isFinite(Number(s01))) return clamp01(Number(s01));

    const s100 = mss?.vox_score ?? mss?.score ?? mss?.overall_score ?? mss?.overall?.score ?? null;
    if (Number.isFinite(Number(s100))) {
      const n = Number(s100);
      if (n <= 1.2) return clamp01(n);
      return clamp01(n / 100);
    }

    return posFromCefr(extractCefr(mss));
  }

  // -------------------------
  // Inline player controls
  // -------------------------
  function playInline(url) {
    const wrap = $("playerWrap");
    const player = $("player");
    if (!wrap || !player) return;

    try {
      player.src = url;
      wrap.style.display = "";
      player.play().catch(() => {});
      setStatus("Playing…");
    } catch {}
  }

  function stopInline() {
    const wrap = $("playerWrap");
    const player = $("player");
    if (!player) return;

    try {
      player.pause();
      player.currentTime = 0;
      player.src = "";
    } catch {}

    if (wrap) wrap.style.display = "none";
  }

  function clearAllRowPlayingState() {
    document.querySelectorAll(".ingle-row.is-playing").forEach((r) => {
      r.classList.remove("is-playing");
      const s = r.querySelector(".ingle-stop");
      if (s) s.disabled = true;
    });
  }

  function ensurePlayerEndedHook() {
    const player = $("player");
    if (!player || player.__ingleHooked) return;
    player.__ingleHooked = true;

    player.addEventListener("ended", () => {
      clearAllRowPlayingState();
      setStatus("Finished.");
    });
  }

  // -------------------------
  // FEED rendering (STATEFUL + FILTERED)
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

  function getFilteredFeedItems() {
  const st = ensureCefrFilterState();
  const items = (window.INGLE_STATE?.feed?.items || []);

  if (st.mode === "ALL") return items;

  const min = Number(st.min);
  const max = Number(st.max);

  return items.filter((it) => {
    const cefr = it.cefr || it.mss_cefr || null;
    const p = (cefr && typeof posFromCefr === "function")
      ? Number(posFromCefr(cefr))
      : 0.5;
    return p >= min && p <= max;
  });
}

  function renderFeedItems(items) {
    const feed = ensureFeed();
    if (!feed) return;

    // Stop playback and clear rows
    stopInline();
    clearAllRowPlayingState();
    feed.innerHTML = "";

    for (const item of items) {
      const cefr = item.cefr || "—";
      prependIngleRow({
        handle: item.handle || "anon",
        cefr,
        streak: item.streak ?? 0,
        total: item.total ?? 0,
        pos01: posFromCefr(cefr),
        audioUrl: item.audioUrl || "",
        dashboardUrl: item.dashboardUrl || "",
      });
    }
  }

  function renderIngleFeedFromState() {
    const items = getFilteredFeedItems();
    renderFeedItems(items);
  }

  async function refreshLiveFeed(dateKey, limit = 50) {
    const dk = String(dateKey || "").trim();
    if (!dk) return null;

    const res = await fetch(
      `/api/ingles/feed?date=${encodeURIComponent(dk)}&limit=${encodeURIComponent(limit)}&ts=${Date.now()}`,
      { credentials: "include", cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data?.error || `feed_http_${res.status}`);

    const items = Array.isArray(data.items) ? data.items : [];
    window.INGLE_STATE.feed.dateKey = dk;
    window.INGLE_STATE.feed.items = items;
    window.INGLE_STATE.feed.lastFetchedAt = Date.now();

    renderIngleFeedFromState();
    return data;
  }

  function prependIngleRow({ handle, cefr, streak, total, audioUrl, dashboardUrl, pos01 }) {
    const feed = ensureFeed();
    if (!feed) return;

    ensurePlayerEndedHook();

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
      <div class="ingle-user">${safeHandle}</div>

      <div class="ingle-playcell">
        <button class="ingle-play" type="button"
          ${(!hasAudio && !hasDash) ? "disabled" : ""}
          aria-label="Play" title="Play">▶</button>

        <button class="ingle-stop" type="button" disabled
          aria-label="Stop" title="Stop">■</button>
      </div>

      <div class="ingle-bar-wrap">
        <div class="ingle-bar">
          <div class="ingle-marker" style="left:${leftPct}%;"></div>
        </div>
        <div class="ingle-cefr-pill" style="left:${leftPct}%;">${safeCefr}</div>
      </div>

      <div class="ingle-meta">
        <span title="Ingle Streak">🔥 <strong>${Number(streak || 0)}</strong></span>
        <span title="Ingles to date">🎯 <strong>${Number(total || 0)}</strong></span>
      </div>

      <div class="ingle-actions">
        <button type="button" class="ingle-act" aria-label="Like" title="Like">♡</button>
        <button type="button" class="ingle-act" aria-label="Follow" title="Follow">＋</button>
      </div>
    `;

    const playBtn = row.querySelector(".ingle-play");
    const stopBtn = row.querySelector(".ingle-stop");

    playBtn?.addEventListener("click", () => {
      const aUrl = row.dataset.audioUrl || "";
      const dUrl = row.dataset.dashboardUrl || "";

      if (aUrl) {
        clearAllRowPlayingState();
        stopInline();
        playInline(aUrl);

        row.classList.add("is-playing");
        if (stopBtn) stopBtn.disabled = false;
        return;
      }

      if (dUrl) window.open(dUrl, "_blank", "noopener,noreferrer");
    });

    stopBtn?.addEventListener("click", () => {
      stopInline();
      row.classList.remove("is-playing");
      if (stopBtn) stopBtn.disabled = true;
      setStatus("Stopped.");
    });

    wireLike(row.querySelector('[aria-label="Like"]'));
    wireFollow(row.querySelector('[aria-label="Follow"]'));

    feed.prepend(row);
    setTimeout(() => row.classList.remove("ingle-row-new"), 450);
  }

  // -------------------------
  // CEFR Range Filter UI (two sliders + bar paint)
  // -------------------------
  function paintCefrBar(lo, hi) {
    const bar = $("cefrBar");
    if (!bar) return;

    const pct = (i) => (i / 5) * 100;
    const a = pct(lo);
    const b = pct(hi);

    bar.style.background = `
      linear-gradient(to right,
        rgba(0,0,0,0.08) 0%,
        rgba(0,0,0,0.08) ${a}%,
        rgba(0,0,0,0.25) ${a}%,
        rgba(0,0,0,0.25) ${b}%,
        rgba(0,0,0,0.08) ${b}%,
        rgba(0,0,0,0.08) 100%
      )
    `;
  }

  function ensureIngleState() {
  if (!window.INGLE_STATE || typeof window.INGLE_STATE !== "object") {
    window.INGLE_STATE = {};
  }
  if (!window.INGLE_STATE.feed || typeof window.INGLE_STATE.feed !== "object") {
    window.INGLE_STATE.feed = { items: [], dateKey: null };
  }
}

function normalizeCefrFilterState() {
  ensureIngleState();

  const cur = window.INGLE_STATE.cefrFilter;

  // Legacy: "ALL"
  if (typeof cur === "string") {
    window.INGLE_STATE.cefrFilter = { mode: cur.toUpperCase(), min: 0, max: 1 };
    return window.INGLE_STATE.cefrFilter;
  }

  // Missing / invalid
  if (!cur || typeof cur !== "object") {
    window.INGLE_STATE.cefrFilter = { mode: "ALL", min: 0, max: 1 };
    return window.INGLE_STATE.cefrFilter;
  }

  // Ensure required fields
  const mode = String(cur.mode || "ALL").toUpperCase();
  let min = Number(cur.min);
  let max = Number(cur.max);

  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  if (min > max) [min, max] = [max, min];

  // clamp
  min = Math.max(0, Math.min(1, min));
  max = Math.max(0, Math.min(1, max));

  cur.mode = mode;
  cur.min = min;
  cur.max = max;
  return cur;
}

/**
 * setCefrFilter(next)
 * - "ALL" -> full range
 * - {min,max} where min/max are 0..1
 * - "B2" (optional) -> snaps to that CEFR position +- a small window
 */
function setCefrFilter(next) {
  const st = normalizeCefrFilterState();

  // Case 1: string inputs
  if (typeof next === "string") {
    const s = next.trim().toUpperCase();

    if (s === "ALL") {
      st.mode = "ALL";
      st.min = 0;
      st.max = 1;
      return st;
    }

    // Optional: allow CEFR letter inputs like "B2"
    // Snap to a small window around the CEFR marker (±0.08)
    if (/^(A1|A2|B1|B2|C1|C2)$/.test(s) && typeof posFromCefr === "function") {
      const p = Number(posFromCefr(s));
      const w = 0.08;
      st.mode = "RANGE";
      st.min = Math.max(0, Math.min(1, p - w));
      st.max = Math.max(0, Math.min(1, p + w));
      return st;
    }

    // Unknown string -> treat as ALL
    st.mode = "ALL";
    st.min = 0;
    st.max = 1;
    return st;
  }

  // Case 2: object input {min,max}
  if (next && typeof next === "object") {
    const min = Number(next.min);
    const max = Number(next.max);

    if (Number.isFinite(min) && Number.isFinite(max)) {
      st.mode = "RANGE";
      st.min = Math.max(0, Math.min(1, Math.min(min, max)));
      st.max = Math.max(0, Math.min(1, Math.max(min, max)));
      return st;
    }
  }

  // Fallback
  st.mode = "ALL";
  st.min = 0;
  st.max = 1;
  return st;
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function ensureCefrFilterState() {
  if (!window.INGLE_STATE || typeof window.INGLE_STATE !== "object") window.INGLE_STATE = {};
  if (!window.INGLE_STATE.cefrFilter || typeof window.INGLE_STATE.cefrFilter !== "object") {
    window.INGLE_STATE.cefrFilter = { mode: "ALL", center01: 0.5, window01: 0.18, min: 0, max: 1 };
  }
  return window.INGLE_STATE.cefrFilter;
}

// 0..100 from slider -> updates state to a RANGE window
function setCefrCenterFromSlider(val100) {
  const st = ensureCefrFilterState();

  // Special case: if user drags to extremes you can still treat as range
  const center01 = clamp01(Number(val100) / 100);

  // Choose your default window width (tune this)
  const window01 = Number.isFinite(st.window01) ? st.window01 : 0.18;

  const half = window01 / 2;
  st.mode = "RANGE";
  st.center01 = center01;
  st.window01 = window01;
  st.min = clamp01(center01 - half);
  st.max = clamp01(center01 + half);

  updateCefrLabel();
  renderIngleFeedFromState?.();
}

function setCefrAll() {
  const st = ensureCefrFilterState();
  st.mode = "ALL";
  st.min = 0; st.max = 1;
  updateCefrLabel();
  renderIngleFeedFromState?.();
}

function updateCefrLabel() {
  const st = ensureCefrFilterState();
  const el = document.getElementById("cefrFilterLabel");
  if (!el) return;

  if (st.mode === "ALL") {
    el.textContent = "Showing: All levels";
    return;
  }

  // If you have a mapping, you can show approximate CEFR band names.
  const pct = Math.round((st.center01 ?? 0.5) * 100);
  el.textContent = `Showing: around ${pct}%`;
}

// -------------------------
// CEFR Gradient Filter UI (one slider across gradient)
// - HTML expected:
//     #cefrBar      (gradient bar, CSS)
//     #cefrCenter   (range input 0..100)
//     #cefrLabel    (text label)
// - State:
//     INGLE_STATE.cefrFilter = { mode, center01, window01, min, max }
// -------------------------
function ensureCefrFilterState() {
  window.INGLE_STATE = window.INGLE_STATE || {};
  if (!window.INGLE_STATE.cefrFilter || typeof window.INGLE_STATE.cefrFilter !== "object") {
    window.INGLE_STATE.cefrFilter = {
      mode: "ALL",
      center01: 0.5,
      window01: 0.18, // tune later
      min: 0,
      max: 1,
    };
  }
  return window.INGLE_STATE.cefrFilter;
}

function setCefrAll() {
  const st = ensureCefrFilterState();
  st.mode = "ALL";
  st.min = 0;
  st.max = 1;
  updateCefrLabel();
  renderIngleFeedFromState();
}

function setCefrCenterFromSlider(val100) {
  const st = ensureCefrFilterState();
  const center01 = clamp01(Number(val100) / 100);

  const w = Number.isFinite(st.window01) ? st.window01 : 0.18;
  const half = w / 2;

  st.mode = "RANGE";
  st.center01 = center01;
  st.window01 = w;
  st.min = clamp01(center01 - half);
  st.max = clamp01(center01 + half);

  updateCefrLabel();
  renderIngleFeedFromState();
}

function updateCefrFilterLabel() {
  const st = ensureCefrFilterState();
  const el = document.getElementById("cefrFilterLabel");
  if (!el) return;

  if (st.mode === "ALL") {
    el.textContent = "Showing: All levels";
    return;
  }

  const pct = Math.round((st.center01 ?? 0.5) * 100);
  el.textContent = `Showing: around ${pct}%`;
}

function initCefrFilterUI() {
  const slider = document.getElementById("cefrCenter");
  if (!slider) return;

  ensureCefrFilterState();

  // Initial
  slider.value = "50";
  updateCefrFilterLabel();

  slider.addEventListener("input", () => {
    setCefrCenterFromSlider(slider.value);
    updateCefrFilterLabel();
    renderIngleFeedFromState();
  });

  slider.addEventListener("dblclick", () => {
    setCefrAll();
    updateCefrFilterLabel();
    renderIngleFeedFromState();
  });
}

  // -------------------------
  // Scored event listener
  // - UI update only (NO persist here)
  // -------------------------
  window.addEventListener("ingle:scored", (ev) => {
    try {
      const d = ev?.detail || {};
      const mss = d.mss || {};

      const cefr = extractCefr(mss) || "—";

      let score01 = cefr && cefr !== "—" ? posFromCefr(cefr) : extractScore01(mss);
      score01 = clamp01(score01);

      // track "my last" for snap-to feature
      if (cefr && cefr !== "—") window.INGLE_STATE.myLastCefr = String(cefr);

      // Prepend locally (still useful), then rehydrate from DB (authoritative)
      prependIngleRow({
        handle: String(d.handle || "").trim() || DEV_HANDLE,
        cefr,
        streak: Number.isFinite(Number(d.streak)) ? Number(d.streak) : 0,
        total: Number.isFinite(Number(d.total)) ? Number(d.total) : 0,
        pos01: score01,
        audioUrl: d.localBlobUrl || "",
        dashboardUrl: d.dashboardUrl || "",
      });

      // Optionally snap filter after submit
      if (window.INGLE_STATE?.filter?.cefr?.snapToMyLast) {
        snapFilterToMyLast();
      }

      // Rehydrate feed (DB truth, includes public audioUrl when present)
      const dk = window.__INGLE_DATEKEY || viewedDateKey;
      refreshLiveFeed(dk).catch(() => {});

      // Mini score UI (unchanged)
      const pct = Math.round(score01 * 100);
      const scoreWrap = $("scoreWrap");
      if (scoreWrap) scoreWrap.style.display = "";

      const cefrLabel = $("cefrLabelMini"); // if you have a mini label separate from filter label
      if (cefrLabel) cefrLabel.textContent = cefr;

      const scoreMarker = $("scoreMarker");
      if (scoreMarker) scoreMarker.style.left = `${pct}%`;

      const scoreCefrPill = $("scoreCefrPill");
      if (scoreCefrPill) {
        scoreCefrPill.style.left = `${pct}%`;
        scoreCefrPill.textContent = cefr;
      }

      const scoreFill = $("scoreFill");
      if (scoreFill) scoreFill.style.width = `${pct}%`;

      const oneLine = $("scoreOneLine");
      if (oneLine) {
        oneLine.textContent =
          cefr && cefr !== "—" ? `Your CEFR estimate is ${cefr}.` : `Score received.`;
      }
    } catch (err) {
      console.warn("ingle:scored listener failed:", err);
    }
  });

  // -------------------------
  // Expose helpers
  // -------------------------
  window.INGLE = {
    loadTodayTomorrow,
    refreshLiveFeed,
    renderIngleFeedFromState,
    prependIngleRow,
    stopInline,
    playInline,
    extractCefr,
    extractScore01,
    posFromCefr,
    posFromScore0to100,
    setCefrFilter,
    snapFilterToMyLast,
  };
function snapFilterToMyLast() {
  const last = String(window.INGLE_STATE?.myLastCefr || "").toUpperCase().trim();
  if (!/^(A1|A2|B1|B2|C1|C2)$/.test(last)) return;

  // posFromCefr returns ~0.01..0.99
  const center01 = clamp01(Number(posFromCefr(last)));

  const st = ensureCefrFilterState();
  const half = (Number.isFinite(st.window01) ? st.window01 : 0.18) / 2;

  st.mode = "RANGE";
  st.center01 = center01;
  st.min = clamp01(center01 - half);
  st.max = clamp01(center01 + half);

  // Move the slider thumb to match
  const slider = document.getElementById("cefrCenter");
  if (slider) slider.value = String(Math.round(center01 * 100));

  updateCefrFilterLabel();
  renderIngleFeedFromState();
}
  // -------------------------
  // Boot
  // -------------------------
  document.addEventListener("DOMContentLoaded", async () => {
    showDevNavIfLocal();
    wireDevDateSteppers();
    

    const pw = $("playerWrap");
    if (pw) pw.style.display = "none";

    // NEW: init filter UI (requires #cefrMin/#cefrMax/#cefrBar/#cefrLabel in HTML)
    initCefrFilterUI();

    await loadTodayTomorrow(viewedDateKey);

    if (isLocalhost && currentTodayPk) {
      const lbl = $("devDateLabel");
      if (lbl) lbl.textContent = `${viewedDateKey} • pk ${currentTodayPk}`;
    }

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
    interceptSubmitForAuthGate();

    // Rehydrate feed into state + render filtered view
    await refreshLiveFeed(viewedDateKey);

    // Optional: if you already have myLastCefr (from localStorage etc.), snap on load
    if (window.INGLE_STATE?.filter?.cefr?.snapToMyLast) {
      snapFilterToMyLast();
    }
  });
})();