// public/embed.js

<div id="mss-widget-container"></div>

(function () {
  const script = document.currentScript;
  if (!script) return;

  const schoolId = script.dataset.schoolId;
  if (!schoolId) return;

  const containerId = script.dataset.containerId || "mss-widget-container";
  const container = document.getElementById(containerId);
  if (!container) return;

  const base = (window.MSS_WIDGET_BASE || window.location.origin).replace(
    /\/+$/,
    ""
  );

  async function logEmbedEvent(payload) {
    try {
      await fetch(base + "/api/embed-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("embed-event log failed:", e);
    }
  }

  let iframeRef = null;

  // Listen for height messages from the widget iframe
  window.addEventListener("message", (event) => {
    try {
      const data = event.data || {};
      if (!data || data.type !== "mss-widget-height") return;
      if (!iframeRef || event.source !== iframeRef.contentWindow) return;

      const h = Number(data.height || 0);
      if (!h || h < 0) return;

      // add a little padding
      iframeRef.style.height = h + 20 + "px";
    } catch (e) {
      console.warn("mss widget height message error:", e);
    }
  });

  async function init() {
    try {
      const res = await fetch(
        base + "/api/embed-check?schoolId=" + encodeURIComponent(schoolId),
        { cache: "no-store" }
      );

      if (!res.ok) {
        await logEmbedEvent({
          schoolId,
          type: "embed_error",
          status: res.status,
        });
        return;
      }

      const info = await res.json();

      if (!info.ok || info.blocked) {
        await logEmbedEvent({
          schoolId,
          type: "embed_blocked",
          reason: info.reason || "limit_or_config",
          dailyLimit: info.dailyLimit,
          usedToday: info.usedToday,
        });
        return;
      }

      // All good → inject iframe
      const iframe = document.createElement("iframe");
      iframe.src =
        base + "/Widget.html?ID=" + encodeURIComponent(schoolId);
      iframe.width = "100%";
      iframe.style.border = "0";
      iframe.style.display = "block";
      iframe.style.height = "600px"; // fallback height, will be resized
      iframe.loading = "lazy";

      iframeRef = iframe;
      container.appendChild(iframe);
    } catch (err) {
      await logEmbedEvent({
        schoolId,
        type: "embed_exception",
        message: String(err),
      });
    }
  }

  init();
})();