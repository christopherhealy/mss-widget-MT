// public/js/help-core.js — DB-backed question help
// Nov 16 2025  + Vercel/Render routing fix Nov 25 2025
console.log("✅ help-core.js loaded");

(function () {
  "use strict";

  // -------------------------------------------------------------------
  // Backend base (match widget-core.js behaviour)
  // -------------------------------------------------------------------
  const HELP_BACKEND_BASE = (() => {
    const h = window.location.hostname || "";

    // Local dev: Express serves static + APIs
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h.endsWith(".local")
    ) {
      return ""; // same origin
    }

    // Vercel: static only → talk to Render backend explicitly
    if (h.endsWith(".vercel.app")) {
      return "https://mss-widget-mt.onrender.com";
    }

    // Default (Render app or other Node host): same origin
    return "";
  })();

  const HELP_API = {
    HELP: `${HELP_BACKEND_BASE}/api/widget/help`,
  };

  const overlay  = document.getElementById("helpOverlay");
  const modal    = document.getElementById("helpModal");
  const bodyEl   = document.getElementById("helpBody");
  const titleEl  = document.getElementById("helpTitle");
  const closeBtn = document.getElementById("helpCloseBtn");

  if (!overlay || !modal || !bodyEl) {
    console.warn("[MSSHelp] Modal skeleton missing from DOM.");
    return;
  }

  // ─────────────────────────────────────────────
  // Scoped styling: ONLY inside #helpModal
  // ─────────────────────────────────────────────
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    #helpModal, #helpModal * {
      all: revert !important;
      box-sizing: border-box !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      color: #111 !important;
    }

    #helpModal {
      background: #fff !important;
      border-radius: 16px !important;
      box-shadow: 0 22px 60px rgba(15, 23, 42, 0.35) !important;
      overflow: hidden !important;
    }

    #helpTitle {
      padding: 14px 20px !important;
      font-size: 16px !important;
      font-weight: 600 !important;
      border-bottom: 1px solid rgba(148, 163, 184, 0.4) !important;
    }

    #helpBody {
      padding: 20px 24px !important;
      max-height: 55vh !important;
      overflow-y: auto !important;
      font-size: 14px !important;
      line-height: 1.5 !important;
      white-space: pre-wrap !important;
    }

    #helpCloseBtn {
      position: absolute !important;
      top: 10px !important;
      right: 14px !important;
      background: transparent !important;
      border: none !important;
      font-size: 18px !important;
      cursor: pointer !important;
    }
  `;
  document.head.appendChild(styleTag);

  // Basic overlay + modal positioning
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.zIndex = "9998";
  overlay.style.display = "none";

  modal.style.position = "fixed";
  modal.style.left = "50%";
  modal.style.top = "50%";
  modal.style.transform = "translate(-50%, -50%)";
  modal.style.zIndex = "9999";
  modal.style.display = "none";
  modal.style.maxWidth = "900px";
  modal.style.width = "92vw";
  modal.style.maxHeight = "70vh";

  // ─────────────────────────────────────────────
  // Show / hide
  // ─────────────────────────────────────────────

  function show(mode) {
    const isMax = mode === "max";

    overlay.hidden = false;
    modal.hidden   = false;
    overlay.style.display = "block";
    modal.style.display   = "block";

    if (isMax) {
      // Max help → let clicks reach widget controls
      overlay.style.background    = "rgba(15,23,42,0.10)";
      overlay.style.pointerEvents = "none";
      modal.style.pointerEvents   = "auto";
    } else {
      // Min help → hard modal
      overlay.style.background    = "rgba(15,23,42,0.40)";
      overlay.style.pointerEvents = "auto";
      modal.style.pointerEvents   = "auto";
    }
  }

  function hide() {
    overlay.hidden = true;
    modal.hidden   = true;
    overlay.style.display = "none";
    modal.style.display   = "none";
  }

  if (closeBtn) closeBtn.addEventListener("click", hide);
  overlay.addEventListener("click", hide);

  // ─────────────────────────────────────────────
  // Fetch from /api/widget/help with caching
  // ─────────────────────────────────────────────

  const HELP_CACHE = Object.create(null);
  // key: `${slug}:${schoolId}:${questionId}` -> { ok, exists, minhelp, maxhelp }

  async function fetchHelp(ctx) {
    const key = `${ctx.slug || ""}:${ctx.schoolId || ""}:${ctx.questionId || ""}`;
    if (HELP_CACHE[key]) return HELP_CACHE[key];

    try {
      const res = await fetch(HELP_API.HELP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: ctx.slug,
          questionId: ctx.questionId,
          level: ctx.level || 0,
        }),
      });

      const data = await res.json().catch(() => ({}));
      HELP_CACHE[key] = data;
      console.log("[MSSHelp] raw help response:", data);
      return data;
    } catch (err) {
      console.error("[MSSHelp] fetch HELP_API.HELP failed:", err);
      return { ok: false, exists: false, minhelp: "", maxhelp: "" };
    }
  }

  // ─────────────────────────────────────────────
  // Public API: setLevel / open / hide
  // ─────────────────────────────────────────────

  async function setLevel(level, ctx = {}) {
    const lvl = Number(level || 0);
    console.log("[MSSHelp] setLevel ->", lvl, ctx);

    if (lvl <= 0) {
      hide();
      return;
    }

    if (!ctx.slug || !ctx.questionId) {
      console.warn("[MSSHelp] Missing slug or questionId.");
      return;
    }

    // Title: “Question X of Y – Help”
    if (titleEl && ctx.questionIndex != null && ctx.totalQuestions != null) {
      titleEl.textContent = `Question ${ctx.questionIndex} of ${ctx.totalQuestions} – Help`;
    } else if (titleEl) {
      titleEl.textContent = "Question Help";
    }

    const help = await fetchHelp({ ...ctx, level: lvl });

    const text =
      lvl === 1
        ? (help.minhelp || help.min || "")
        : (help.maxhelp || help.max || "");

    bodyEl.textContent =
      text && text.trim()
        ? text
        : "No help text has been configured for this question yet.";

    show(lvl === 2 ? "max" : "min");
  }

  // Optional helper for the "Question Help" button
  function open(ctx = {}) {
    const lvl = ctx.level != null ? ctx.level : 1;
    return setLevel(lvl, ctx);
  }

  window.MSSHelp = { setLevel, open, hide };
  console.log("✅ MSSHelp API ready (DB-backed min/max)");
})();