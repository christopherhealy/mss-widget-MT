// MSS Widget Embed v1.1
// Drop-in script for embedding MSS widgets on any site.
//
// MODE 1 – Script-only (no markup needed):
//   <script async
//     src="https://mss-widget-mt.vercel.app/embed/widget-embed.js
//          ?slug=mss-demo
//          &widget=/widgets/Widget3.html
//          &maxwidth=720
//          &height=960">
//   </script>
//
// MODE 2 – Host div markup (for more control / multiple widgets):
//   <div
//     class="mss-widget"
//     data-mss-slug="mss-demo"
//     data-mss-widget="/widgets/Widget3.html"
//     data-mss-maxwidth="720"
//     data-mss-height="960"
//   ></div>
//   <script async src="https://mss-widget-mt.vercel.app/embed/widget-embed.js"></script>

(function () {
  "use strict";

  /* ---------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------- */

  function ready(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(fn, 0);
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  function getCurrentScript() {
    return (
      document.currentScript ||
      (function () {
        var scripts = document.getElementsByTagName("script");
        return scripts[scripts.length - 1];
      })()
    );
  }

  // Parse ?slug=...&widget=... etc from script src
  function parseQueryFromSrc(src) {
    var out = {};
    if (!src) return out;
    var qIndex = src.indexOf("?");
    if (qIndex === -1) return out;
    var query = src.slice(qIndex + 1);
    query.split("&").forEach(function (pair) {
      if (!pair) return;
      var parts = pair.split("=");
      var key = decodeURIComponent(parts[0] || "").trim();
      var val = decodeURIComponent(parts[1] || "").trim();
      if (!key) return;
      out[key] = val;
    });
    return out;
  }

  function getBaseOrigin(src) {
    if (!src) return window.location.origin;
    var idx = src.indexOf("/embed/");
    if (idx === -1) return window.location.origin;
    return src.slice(0, idx);
  }

  var CURRENT_SCRIPT = getCurrentScript();
  var SCRIPT_SRC = CURRENT_SCRIPT && CURRENT_SCRIPT.src;
  var SCRIPT_QS = parseQueryFromSrc(SCRIPT_SRC);
  var BASE_ORIGIN = getBaseOrigin(SCRIPT_SRC);

  /* ---------------------------------------------------------------
   * Initialise one host <div class="mss-widget">
   * ------------------------------------------------------------- */

  function initWidgetHost(host, index) {
    if (!host || !host.parentNode) return;

    // Priority: data-attributes on host, else script query params, else defaults
    var slug =
      host.getAttribute("data-mss-slug") ||
      SCRIPT_QS.slug ||
      "mss-demo";

    var widgetPath =
      host.getAttribute("data-mss-widget") ||
      SCRIPT_QS.widget ||
      "/widgets/Widget3.html";

    var maxWidthAttr =
      host.getAttribute("data-mss-maxwidth") ||
      SCRIPT_QS.maxwidth ||
      "780";

    var heightAttr =
      host.getAttribute("data-mss-height") ||
      SCRIPT_QS.height;

    var initialHeight = heightAttr ? Number(heightAttr) : 960; // safe full-widget default
    if (!initialHeight || !isFinite(initialHeight)) {
      initialHeight = 960;
    }

    var maxWidth = Number(maxWidthAttr);
    if (!maxWidth || !isFinite(maxWidth)) {
      maxWidth = 780;
    }

    // Build widget URL
    var widgetUrl = widgetPath;
    if (!/^https?:\/\//i.test(widgetUrl) && widgetUrl.indexOf("//") !== 0) {
      widgetUrl = BASE_ORIGIN.replace(/\/+$/, "") + widgetUrl;
    }
    widgetUrl += (widgetUrl.indexOf("?") === -1 ? "?" : "&") +
                 "slug=" + encodeURIComponent(slug);

    // Create wrapper card
    var wrapper = document.createElement("div");
    wrapper.className = "mss-widget-frame-wrap";
    wrapper.style.position = "relative";
    wrapper.style.width = "100%";
    wrapper.style.maxWidth = maxWidth + "px";
    wrapper.style.margin = "0 auto";
    wrapper.style.borderRadius = "18px";
    wrapper.style.border = "1px solid rgba(148, 163, 184, 0.6)";
    wrapper.style.background = "#f9fafb";
    wrapper.style.overflow = "visible";
    wrapper.style.minHeight = initialHeight + "px";
    wrapper.style.boxShadow = "0 16px 40px rgba(15, 23, 42, 0.12)";

    // Create iframe
    var iframe = document.createElement("iframe");
    iframe.className = "mss-widget-frame";
    iframe.title = "Speaking practice widget";
    iframe.allow = "microphone; autoplay";
    iframe.loading = "lazy";
    iframe.style.display = "block";
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.minHeight = initialHeight + "px";
    iframe.style.height = initialHeight + "px";

    var hostId = host.id || ("mss-widget-" + (index + 1));
    iframe.id = hostId + "-iframe";

    iframe.src = widgetUrl;

    // Swap host -> wrapper+iframe
    host.parentNode.replaceChild(wrapper, host);
    wrapper.appendChild(iframe);

    // Handle resize messages
    function onMessage(event) {
      var data = event.data || {};
      if (!data || data.source !== "mss-widget" || !data.height) return;
      if (data.slug && data.slug !== slug) return;

      var h = Number(data.height);
      if (!h || !isFinite(h)) return;

      var finalHeight = h + 24; // breathing room
      iframe.style.height = finalHeight + "px";
      iframe.style.minHeight = finalHeight + "px";
      wrapper.style.minHeight = finalHeight + "px";
    }

    window.addEventListener("message", onMessage, false);
  }

  /* ---------------------------------------------------------------
   * Bootstrapping
   * ------------------------------------------------------------- */

  ready(function () {
    var hosts = document.querySelectorAll(".mss-widget");

    // If no host div exists, create one *after* the script tag
    if (!hosts || !hosts.length) {
      var autoHost = document.createElement("div");
      autoHost.className = "mss-widget";

      // Keep any configured values discoverable as data-attrs
      if (SCRIPT_QS.slug)    autoHost.setAttribute("data-mss-slug", SCRIPT_QS.slug);
      if (SCRIPT_QS.widget)  autoHost.setAttribute("data-mss-widget", SCRIPT_QS.widget);
      if (SCRIPT_QS.maxwidth) autoHost.setAttribute("data-mss-maxwidth", SCRIPT_QS.maxwidth);
      if (SCRIPT_QS.height)  autoHost.setAttribute("data-mss-height", SCRIPT_QS.height);

      var parent = CURRENT_SCRIPT && CURRENT_SCRIPT.parentNode;
      if (parent) {
        parent.insertBefore(autoHost, CURRENT_SCRIPT.nextSibling);
      } else {
        document.body.appendChild(autoHost);
      }

      hosts = [autoHost];
    }

    // Initialise all hosts found or created
    if (hosts.forEach) {
      hosts.forEach(initWidgetHost);
    } else {
      for (var i = 0; i < hosts.length; i++) {
        initWidgetHost(hosts[i], i);
      }
    }
  });
})();