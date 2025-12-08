// MSS Widget Embed v1.3 — fixed-height, drop-in
(function () {
  // Find all host divs
  var hosts = document.querySelectorAll(".mss-widget");
  if (!hosts.length) return;

  hosts.forEach(function (host) {
    var slug       = host.getAttribute("data-mss-slug") || "";
    var widgetPath = host.getAttribute("data-mss-widget") || "/widgets/Widget.html";

    // Allow per-host override, but default to a sane fixed height
    var heightAttr = host.getAttribute("data-mss-height");
    var HEIGHT     = parseInt(heightAttr || "820", 10); // px

    var maxWidthAttr = host.getAttribute("data-mss-maxwidth");
    var MAX_WIDTH    = parseInt(maxWidthAttr || "720", 10); // px

    // Build iframe
    var frame = document.createElement("iframe");
    frame.setAttribute("allow", "microphone; autoplay; clipboard-write");
    frame.setAttribute("title", "MySpeakingScore – Speaking Practice");

    frame.style.border   = "0";
    frame.style.width    = "100%";
    frame.style.maxWidth = MAX_WIDTH + "px";
    frame.style.height   = HEIGHT + "px";
    frame.style.display  = "block";
    frame.style.margin   = "0 auto";

    // Clear any existing content and insert the iframe
    host.innerHTML = "";
    host.appendChild(frame);

    // Build src (same origin, just pass slug)
    var url = widgetPath + "?slug=" + encodeURIComponent(slug);
    frame.src = url;
  });
})();