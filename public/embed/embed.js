// /public/embed/widget-embed.js — v0.1 (universal MSS widget embed)
// Usage on any external site:
//
// <div
//   class="mss-widget"
//   data-mss-slug="mss-demo"
//   data-mss-widget="/widgets/Widget3.html"
//   data-mss-height="520"
//   data-mss-maxwidth="720"
// ></div>
// <script async src="https://mss-widget-mt.vercel.app/embed/widget-embed.js"></script>

(function () {
  "use strict";

  // Small helper: get origin of THIS script (where the widgets actually live)
  function getScriptOrigin() {
    try {
      var script =
        document.currentScript ||
        (function () {
          var scripts = document.getElementsByTagName("script");
          return scripts[scripts.length - 1];
        })();

      if (!script || !script.src) return "";
      var url = new URL(script.src, window.location.href);
      return url.origin;
    } catch (e) {
      return "";
    }
  }

  var EMBED_ORIGIN = getScriptOrigin(); // e.g. https://mss-widget-mt.vercel.app

  function buildIframeSrc(container) {
    var widgetPath = container.getAttribute("data-mss-widget") || "/widgets/Widget.html";
    var slug = container.getAttribute("data-mss-slug") || "";
    var explicitOrigin = container.getAttribute("data-mss-origin") || "";

    var origin = explicitOrigin || EMBED_ORIGIN || "";

    // If widgetPath is absolute (starts with http), use as-is.
    // Otherwise, resolve against EMBED_ORIGIN.
    var src;
    if (/^https?:\/\//i.test(widgetPath)) {
      src = widgetPath;
    } else {
      if (!origin) {
        // Last-ditch: relative to embedding page
        src = widgetPath;
      } else {
        var base = origin.replace(/\/+$/, "");
        if (!widgetPath.startsWith("/")) {
          widgetPath = "/" + widgetPath;
        }
        src = base + widgetPath;
      }
    }

    try {
      var url = new URL(src, window.location.href);
      if (slug && !url.searchParams.has("slug")) {
        url.searchParams.set("slug", slug);
      }
      return url.toString();
    } catch (e) {
      // If URL constructor fails for some reason, just return raw
      return src;
    }
  }

  function enhanceContainer(container) {
    if (!container || container.dataset.mssProcessed === "1") return;

    container.dataset.mssProcessed = "1";

    var iframeSrc = buildIframeSrc(container);

    var height = container.getAttribute("data-mss-height") || "480px";
    var maxWidth = container.getAttribute("data-mss-maxwidth") || "768px";

    // Ensure the container has a nice shell class
    if (!container.classList.contains("mss-widget-shell")) {
      container.classList.add("mss-widget-shell");
    }

    // Apply minimal styling so it "just looks good" everywhere.
    if (!container.style.maxWidth) container.style.maxWidth = maxWidth;
    if (!container.style.marginLeft && !container.style.marginRight) {
      container.style.marginLeft = "auto";
      container.style.marginRight = "auto";
    }
    if (!container.style.boxSizing) container.style.boxSizing = "border-box";

    // Clear any placeholder text
    container.innerHTML = "";

    var iframe = document.createElement("iframe");
    iframe.src = iframeSrc;
    iframe.setAttribute("allow", "microphone; camera; autoplay");
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("scrolling", "no");

    iframe.style.width = "100%";
    iframe.style.minHeight = height;
    iframe.style.border = "0";
    iframe.style.display = "block";

    container.appendChild(iframe);
  }

  function initEmbeds() {
    var containers = document.querySelectorAll("[data-mss-widget]");
    if (!containers || !containers.length) return;

    for (var i = 0; i < containers.length; i++) {
      enhanceContainer(containers[i]);
    }
  }

  // Public refresh hook in case the host page uses SPA navigation
  window.MSSWidgetEmbed = {
    refresh: initEmbeds
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    initEmbeds();
  } else {
    document.addEventListener("DOMContentLoaded", initEmbeds);
  }
})();