// public/embed.js
// Lightweight embed script for the MSS speaking widget.
//
// Usage on a school site:
//
//   <div id="mss-widget-container"></div>
//   <script
//     src="https://YOUR-HOST/embed.js"
//     data-school-id="widget-academy"  // or the numeric school id from signup
//     data-target-id="mss-widget-container"  // optional, defaults to this
//   ></script>
//
// This script:
//   1. Fetches widget config/form via /api/widget/:idOrSlug/bootstrap
//   2. (Optionally) checks usage limits via /api/embed-check?schoolId=…
 //  3. Loads /js/widget-core.v1.js and calls window.mssWidgetInit(container)

(function () {
  try {
    const scriptEl = document.currentScript;
    if (!scriptEl) {
      console.error("[MSS widget] embed.js: no currentScript found.");
      return;
    }

    // Identifier for the school – can be a slug (widget-academy)
    // or the numeric id returned from /api/signup.
    const schoolIdAttr =
      scriptEl.getAttribute("data-school-id") ||
      scriptEl.getAttribute("data-school-slug");

    if (!schoolIdAttr) {
      console.error(
        "[MSS widget] embed.js: data-school-id (or data-school-slug) is required on the script tag."
      );
      return;
    }

    const targetId =
      scriptEl.getAttribute("data-target-id") || "mss-widget-container";
    const container = document.getElementById(targetId);

    if (!container) {
      console.error(
        `[MSS widget] embed.js: target element #${targetId} not found.`
      );
      return;
    }

    // Derive base URL from the script src (handles ?v=1 etc.)
    const src = scriptEl.src || "";
    const base = src.split("/embed.js")[0];

    function setLoading(msg) {
      container.innerHTML =
        '<div class="mss-widget-loading">' +
        (msg || "Loading speaking practice widget…") +
        "</div>";
    }

    function setError(msg) {
      container.innerHTML =
        '<div class="mss-widget-error">' +
        (msg ||
          "Unable to load the speaking practice widget. Please try again later.") +
        "</div>";
    }

    async function bootstrap() {
      setLoading();

      let bootstrapData;

      try {
        const bootstrapUrl =
          base +
          "/api/widget/" +
          encodeURIComponent(schoolIdAttr) +
          "/bootstrap";

        const res = await fetch(bootstrapUrl, {
          headers: { Accept: "application/json" },
        });

        if (!res.ok) {
          throw new Error("Bootstrap HTTP " + res.status);
        }

        bootstrapData = await res.json();
      } catch (err) {
        console.error("[MSS widget] bootstrap failed:", err);
        setError("Could not load this school’s widget configuration.");
        return;
      }

      const schoolIdForCheck =
        bootstrapData.schoolId || bootstrapData.slug || schoolIdAttr;

      // Expose config/form to the widget runtime
      window.mssWidgetConfig = bootstrapData.config || {};
      window.mssWidgetForm = bootstrapData.form || {};
      window.mssWidgetImageUrl = bootstrapData.imageUrl || null;
      window.mssWidgetSchoolId = schoolIdForCheck;

      // Optional: usage / billing check – non-fatal
      try {
        const checkUrl =
          base +
          "/api/embed-check?schoolId=" +
          encodeURIComponent(schoolIdForCheck);
        const res = await fetch(checkUrl, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const status = await res.json();
          if (status.blocked) {
            console.warn("[MSS widget] widget blocked by usage limits:", status);
            setError(
              "This practice widget is temporarily unavailable for your school."
            );
            return;
          }
        }
      } catch (err) {
        // Just log; don’t break the widget
        console.warn("[MSS widget] embed-check failed (non-fatal):", err);
      }

      // Finally, load the core widget runtime
      const coreScript = document.createElement("script");
      coreScript.async = true;
      coreScript.src = base + "/js/widget-core.v1.js";

      coreScript.onload = function () {
        try {
          if (typeof window.mssWidgetInit === "function") {
            window.mssWidgetInit(container);
          } else {
            console.warn(
              "[MSS widget] widget-core.v1.js loaded, but mssWidgetInit() is not defined."
            );
          }
        } catch (err) {
          console.error("[MSS widget] error initialising widget:", err);
          setError("There was a problem initialising the speaking widget.");
        }
      };

      coreScript.onerror = function () {
        console.error("[MSS widget] failed to load /js/widget-core.v1.js");
        setError("Could not load the speaking widget runtime.");
      };

      document.head.appendChild(coreScript);
    }

    bootstrap();
  } catch (err) {
    console.error("[MSS widget] unexpected error in embed.js:", err);
  }
})();