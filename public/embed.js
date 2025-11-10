// public/embed.js
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
      // best effort only
      console.warn("embed-event log failed:", e);
    }
  }

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
        return; // do not render iframe
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
        return; // quietly do nothing
      }

      // All good → inject iframe
      const iframe = document.createElement("iframe");
      iframe.src =
        base + "/Widget.html?ID=" + encodeURIComponent(schoolId);
      iframe.width = script.dataset.width || "800";
      iframe.height = script.dataset.height || "420";
      iframe.style.border = "0";
      iframe.loading = "lazy";

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