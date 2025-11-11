// public/embed.js
(function () {
  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var schoolId = (scriptEl.getAttribute("data-school-id") || "").trim();
  var containerId =
    scriptEl.getAttribute("data-container-id") || "mss-widget-container";

  var container = document.getElementById(containerId);
  if (!container) {
    console.error(
      "[MSS widget] Container element with id '" +
        containerId +
        "' not found."
    );
    return;
  }

  var scriptUrl;
  try {
    scriptUrl = new URL(scriptEl.src);
  } catch (e) {
    console.error("[MSS widget] Could not parse embed.js URL:", e);
    return;
  }

  var baseOrigin = scriptUrl.origin;

  function loadCore() {
    var coreScript = document.createElement("script");
    // IMPORTANT: correct path into /js/
    coreScript.src = baseOrigin + "/js/widget-core.v1.js";
    coreScript.async = true;

    coreScript.onload = function () {
      if (window.mssWidgetInit) {
        window.mssWidgetInit({
          containerId: containerId,
          schoolId: schoolId,
        });
      } else {
        console.warn(
          "[MSS widget] widget-core.v1.js loaded, but mssWidgetInit() is not defined."
        );
      }
    };

    coreScript.onerror = function () {
      console.error(
        "[MSS widget] Failed to load /js/widget-core.v1.js from " +
          coreScript.src
      );
    };

    document.head.appendChild(coreScript);
  }

  // Optional: billing / usage check
  function runEmbedCheckAndLoad() {
    if (!schoolId) {
      loadCore();
      return;
    }

    var url =
      baseOrigin +
      "/api/embed-check?schoolId=" +
      encodeURIComponent(schoolId);

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (status) {
        if (status && status.blocked) {
          container.innerHTML =
            '<div style="padding:16px;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:#555;">' +
            "This practice widget is temporarily unavailable for this school." +
            "</div>";
        } else {
          loadCore();
        }
      })
      .catch(function (err) {
        console.warn(
          "[MSS widget] embed-check failed, continuing anyway:",
          err
        );
        loadCore();
      });
  }

  runEmbedCheckAndLoad();
})();