// /public/config-admin/ImageViewer.js — MSS Image Viewer v1.0
console.log("✅ ImageViewer.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // DOM refs
  const imgEl           = $("ivImage");
  const placeholderEl   = $("ivPlaceholder");
  const statusEl        = $("ivStatus");
  const metaEl          = $("ivMeta");
  const slugLabelEl     = $("ivSlugLabel");
  const urlLabelEl      = $("ivUrlLabel");

  const fileInput       = $("ivFileInput");
  const chooseBtn       = $("ivChooseBtn");

  const sizeSlider      = $("ivSizeSlider");
  const sizeLabel       = $("ivSizeLabel");
  const presetChips     = document.querySelectorAll(".iv-chip");

  const resetBtn        = $("ivResetBtn");
  const cancelBtn       = $("ivCancelBtn");
  const applyBtn        = $("ivApplyBtn");

  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------

  const STATE = {
    slug:       null,
    imageUrl:   "",   // final, backend URL
    localUrl:   "",   // temporary object URL for preview
    size:       100,  // percent
    uploading:  false,
    dirty:      false,
  };

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("iv-status-error", !!isError);
  }

  function setMeta(text) {
    if (!metaEl) return;
    metaEl.textContent = text || "";
  }

  function setSize(percent) {
    STATE.size = percent;
    if (sizeSlider) sizeSlider.value = String(percent);
    if (sizeLabel) sizeLabel.textContent = `${percent}%`;
    imgEl.style.maxWidth = `${percent}%`;

    // Update chip active state
    presetChips.forEach((chip) => {
      const chipSize = Number(chip.dataset.size || "0");
      chip.classList.toggle("iv-chip-active", chipSize === percent);
    });
  }

  function updateSlugLabel() {
    if (slugLabelEl) {
      slugLabelEl.textContent = STATE.slug || "—";
    }
  }

  function updateUrlLabel() {
    if (urlLabelEl) {
      urlLabelEl.textContent = STATE.imageUrl || "—";
    }
  }

  function showImagePreview(url) {
    if (!imgEl || !placeholderEl) return;
    imgEl.src = url || "";
    imgEl.style.display = url ? "block" : "none";
    placeholderEl.style.display = url ? "none" : "block";
  }

  function getAdminApiBase() {
    const origin = window.location.origin || "";

    // Local dev + Render app → same origin
    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.includes("mss-widget-mt.onrender.com")
    ) {
      return "";
    }

    // Vercel frontend → call Render backend
    if (origin.includes("mss-widget-mt.vercel.app")) {
      return "https://mss-widget-mt.onrender.com";
    }

    return "";
  }

  const ADMIN_API_BASE = getAdminApiBase();

  function absolutize(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    let p = path;
    if (!p.startsWith("/")) p = `/uploads/${p}`;
    return `${ADMIN_API_BASE}${p}`;
  }

  function parseQuery() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("slug") || "mss-demo";
    const image = params.get("image") || "";
    const size = Number(params.get("size") || "100") || 100;

    STATE.slug = slug;
    STATE.imageUrl = image ? absolutize(image) : "";
    STATE.size = size < 50 ? 50 : size > 150 ? 150 : size;

    updateSlugLabel();
    updateUrlLabel();
    setSize(STATE.size);

    if (STATE.imageUrl) {
      showImagePreview(STATE.imageUrl);
    }

    setMeta(`slug=${slug}, size=${STATE.size}%`);
  }

  function reportDimensions() {
    if (!imgEl || !imgEl.naturalWidth) return;
    const w = imgEl.naturalWidth;
    const h = imgEl.naturalHeight;
    setMeta(`slug=${STATE.slug}, ${w}×${h}px @ ${STATE.size}%`);
  }

  // ---------------------------------------------------------------------------
  // UPLOAD
  // ---------------------------------------------------------------------------

  async function uploadImage(file) {
    if (!STATE.slug) {
      setStatus("Missing slug – cannot upload.", true);
      throw new Error("Missing slug");
    }

    const formData = new FormData();
    formData.append("image", file);

    const url = `${ADMIN_API_BASE}/api/admin/widget/${encodeURIComponent(
      STATE.slug
    )}/image`;

    console.log("[ImageViewer] 📤 Uploading image", { url, name: file.name });

    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("[ImageViewer] non-JSON response from upload", raw);
      data = { ok: res.ok, raw };
    }

    if (!res.ok || data.ok === false) {
      console.error("[ImageViewer] upload failed", { status: res.status, data });
      throw new Error(`Upload failed: HTTP ${res.status}`);
    }

    const returned =
      data.url || data.imageUrl || data.image || data.path;

    if (!returned) {
      throw new Error("Upload succeeded but no URL was returned.");
    }

    const absolute = absolutize(returned);
    console.log("[ImageViewer] ✅ upload success", { returned, absolute });
    return absolute;
  }

  // ---------------------------------------------------------------------------
  // EVENT WIRING
  // ---------------------------------------------------------------------------

  function wireFileInput() {
    if (!fileInput) return;

    // Button click opens file chooser
    if (chooseBtn) {
      chooseBtn.addEventListener("click", () => {
        fileInput.click();
      });
    }

    // When file is chosen
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      // Revoke previous local URL
      if (STATE.localUrl) {
        URL.revokeObjectURL(STATE.localUrl);
        STATE.localUrl = "";
      }

      // Local preview first
      const localUrl = URL.createObjectURL(file);
      STATE.localUrl = localUrl;
      showImagePreview(localUrl);
      setStatus("Uploading…");
      STATE.uploading = true;

      try {
        const finalUrl = await uploadImage(file);
        STATE.imageUrl = finalUrl;
        updateUrlLabel();
        showImagePreview(finalUrl);
        setStatus("Image uploaded. Don’t forget to Apply.");
        STATE.dirty = true;
      } catch (err) {
        console.error("[ImageViewer] upload error", err);
        setStatus(err.message || "Upload failed. See console.", true);
      } finally {
        STATE.uploading = false;
      }
    });

    if (imgEl) {
      imgEl.addEventListener("load", () => {
        reportDimensions();
      });
    }
  }

  function wireSizeControls() {
    if (sizeSlider) {
      sizeSlider.addEventListener("input", () => {
        const value = Number(sizeSlider.value || "100") || 100;
        setSize(value);
        STATE.dirty = true;
      });
    }

    presetChips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const value = Number(chip.dataset.size || "100") || 100;
        setSize(value);
        STATE.dirty = true;
      });
    });
  }

  function wireFooterButtons() {
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        // Clear selection but keep slug
        STATE.imageUrl = "";
        STATE.localUrl = "";
        setSize(100);
        showImagePreview("");
        updateUrlLabel();
        setStatus("Reset to defaults.");
        STATE.dirty = true;
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        window.close();
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        if (!STATE.imageUrl) {
          const proceed = window.confirm(
            "No image has been uploaded yet. Apply with empty image?"
          );
          if (!proceed) return;
        }

        const payload = {
          type: "MSS_IMAGE_VIEWER_APPLY",
          slug: STATE.slug,
          imageUrl: STATE.imageUrl,
          sizePercent: STATE.size,
        };

        // Prefer postMessage – opener can listen for it
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, "*");
          }
        } catch (e) {
          console.warn("[ImageViewer] postMessage failed", e);
        }

        // Also support a direct callback if the opener has one
        try {
          if (window.opener && typeof window.opener.ivOnApply === "function") {
            window.opener.ivOnApply(payload);
          }
        } catch (e) {
          console.warn("[ImageViewer] ivOnApply callback failed", e);
        }

        setStatus("Applied – closing…");
        window.close();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------------

  function init() {
    console.log("[ImageViewer] init()");
    parseQuery();
    setSize(STATE.size);
    wireFileInput();
    wireSizeControls();
    wireFooterButtons();
    setStatus("Ready to choose an image.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();