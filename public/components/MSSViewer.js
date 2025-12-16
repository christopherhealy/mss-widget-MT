// /public/components/MSSViewer.js
// v1.0 (global) — MSS modal iframe viewer
// Usage: window.MSSViewer.open({ title, src })

console.log("✅ MSSViewer.js loaded");

(function () {
  "use strict";

  function open(opts) {
    const title = (opts && opts.title) || "";
    const src = (opts && opts.src) || "";
    if (!src) {
      console.warn("[MSSViewer] Missing src");
      return;
    }

    // Prevent duplicates
    if (document.getElementById("mss-viewer-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "mss-viewer-overlay";

    overlay.innerHTML = `
      <div class="mss-viewer-backdrop"></div>
      <div class="mss-viewer-card" role="dialog" aria-modal="true">
        <div class="mss-viewer-header">
          <h2>${escapeHtml(title)}</h2>
          <button type="button" id="mss-viewer-close" aria-label="Close">✕</button>
        </div>
        <iframe
          src="${escapeAttr(src)}"
          class="mss-viewer-iframe"
          frameborder="0"
        ></iframe>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
      if (e.key === "Escape") close();
    }

    const backdrop = overlay.querySelector(".mss-viewer-backdrop");
    const btnClose = overlay.querySelector("#mss-viewer-close");

    if (backdrop) backdrop.addEventListener("click", close);
    if (btnClose) btnClose.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(s) {
    // minimal safety for iframe src
    return String(s || "").replaceAll('"', "%22");
  }

  // Global API
  window.MSSViewer = window.MSSViewer || {};
  window.MSSViewer.open = open;
})();