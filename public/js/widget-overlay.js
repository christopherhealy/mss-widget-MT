// widget-overlay.js — overlay dashboard for Widget3
console.log("✅ widget-overlay.js loaded (overlay dashboard)");

(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const overlay = document.getElementById("widgetResultsOverlay");
    const frame   = document.getElementById("widgetResultsFrame");
    const close   = document.getElementById("widgetResultsClose");

    if (!overlay || !frame) {
      console.warn("[WidgetOverlay] Overlay DOM not found.");
      return;
    }

    // Keep reference to core's expandDashboard (just in case)
    const coreExpand = window.expandDashboard;

    // Override with overlay-based implementation
    window.expandDashboard = function (url, sessionId) {
      if (!url) return false;

      // If inline dashboard is present, keep it collapsed
      try {
        if (typeof window.collapseDashboard === "function") {
          window.collapseDashboard();
        }
      } catch (_) {}

      frame.src = url;
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");

      if (typeof window.logEvent === "function") {
        window.logEvent("dashboard_overlay_open", { sessionId, url });
      }

      return true; // tell core we handled it
    };

    function closeOverlay() {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      frame.src = "about:blank";

      if (typeof window.logEvent === "function") {
        window.logEvent("dashboard_overlay_closed", {});
      }
    }

    if (close) {
      close.addEventListener("click", closeOverlay);
    }

    // Optional: click outside the modal to close
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) {
        closeOverlay();
      }
    });

    // Escape key to close
    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && overlay.classList.contains("is-open")) {
        closeOverlay();
      }
    });
  });
})();