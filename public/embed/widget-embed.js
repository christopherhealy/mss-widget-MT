// /embed/widget-embed.js  — v1.0 drop-in embed Dec 8
(function () {
  "use strict";

  // Figure out our own origin so we can resolve /widgets/Widget3.html
  var scriptEl = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();
  var scriptOrigin;
  try {
    scriptOrigin = new URL(scriptEl.src).origin;
  } catch (e) {
    scriptOrigin = "";
  }

  function initEmbeds() {
    var nodes = document.querySelectorAll(".mss-widget[data-mss-widget]");
    if (!nodes.length) return;

    nodes.forEach(function (placeholder, index) {
      var slug = placeholder.getAttribute("data-mss-slug") || "";
      var widgetPath = placeholder.getAttribute("data-mss-widget") || "/widgets/Widget3.html";
      var heightAttr = placeholder.getAttribute("data-mss-height") || "520";
      var maxWidthAttr = placeholder.getAttribute("data-mss-maxwidth") || "720";

      var initialHeight = parseInt(heightAttr, 10);
      if (!isFinite(initialHeight) || initialHeight <= 0) {
        initialHeight = 520;
      }
      var maxWidth = parseInt(maxWidthAttr, 10);
      if (!isFinite(maxWidth) || maxWidth <= 0) {
        maxWidth = 720;
      }

      // Resolve the widget URL: absolute URLs pass through; relative ones use our origin
      var widgetUrl;
      if (/^https?:\/\//i.test(widgetPath)) {
        widgetUrl = widgetPath;
      } else {
        widgetUrl = scriptOrigin + widgetPath;
      }

      // Outer wrapper that we fully control
      var wrapper = document.createElement("div");
      wrapper.className = "mss-widget-wrap";
      wrapper.style.boxSizing = "border-box";
      wrapper.style.maxWidth = maxWidth + "px";
      wrapper.style.margin = "0 auto";
      wrapper.style.borderRadius = "18px";
      wrapper.style.border = "1px solid rgba(148,163,184,0.6)";
      wrapper.style.background = "#f9fafb";
      wrapper.style.boxShadow = "0 16px 40px rgba(15,23,42,0.12)";
      wrapper.style.overflow = "hidden";

      // The iframe that will render the actual widget
      var iframe = document.createElement("iframe");
      var iframeId = "mss-widget-frame-" + (index + 1);

      iframe.id = iframeId;
      iframe.setAttribute("title", "MySpeakingScore speaking practice widget");
      iframe.setAttribute("allow", "microphone; autoplay");
      iframe.setAttribute("loading", "lazy");

      iframe.style.display = "block";
      iframe.style.width = "100%";
      iframe.style.border = "0";
      iframe.style.height = initialHeight + "px";
      iframe.style.minHeight = initialHeight + "px";

      // Build the widget URL with query params for slug if needed
      var url = new URL(widgetUrl, scriptOrigin || window.location.origin);
      if (slug) {
        url.searchParams.set("slug", slug);
      }
      iframe.src = url.toString();

      // Insert the wrapper + iframe into the DOM, replacing the placeholder
      placeholder.parentNode.insertBefore(wrapper, placeholder);
      wrapper.appendChild(iframe);
      placeholder.remove(); // we don't need the original div anymore
    });

    // Set up postMessage-based resizing (optional but nice)
    window.addEventListener("message", function (event) {
      try {
        // Only trust messages from our own origin if we know it
        if (scriptOrigin && event.origin !== scriptOrigin) return;

        var data = event.data || {};
        if (!data || data.source !== "mss-widget" || !data.height || !data.frameId) {
          return;
        }

        var h = Number(data.height);
        if (!isFinite(h) || h <= 0) return;

        var iframe = document.getElementById(String(data.frameId));
        if (!iframe) return;

        var finalHeight = h + 24; // breathing room
        iframe.style.height = finalHeight + "px";
        iframe.style.minHeight = finalHeight + "px";
      } catch (e) {
        // fail silently; we never want to break the host page
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initEmbeds);
  } else {
    initEmbeds();
  }
})();