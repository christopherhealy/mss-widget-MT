// /public/config-admin/ImageViewer.js — v1.2
// Standalone viewer: file choose + resize + upload + postMessage back to opener.

console.log("✅ ImageViewer.js loaded");

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const fileInput   = $("ivFileInput");
  const chooseBtn   = $("ivChooseBtn");
  const imgEl       = $("ivImage");
  const placeholder = $("ivPlaceholder");

  const sizeSlider  = $("ivSizeSlider");
  const sizeLabel   = $("ivSizeLabel");
  const chips       = document.querySelectorAll(".iv-chip");

  const metaEl      = $("ivMeta");
  const statusEl    = $("ivStatus");
  const slugLabel   = $("ivSlugLabel");
  const urlLabel    = $("ivUrlLabel");

  const resetBtn    = $("ivResetBtn");
  const cancelBtn   = $("ivCancelBtn");
  const applyBtn    = $("ivApplyBtn");

  let SLUG = null;
  let CURRENT_URL = "";
  let sizePercent = 100;
  let selectedFile = null;

  /* -------------------------------------------- */
  /* ENV: which backend to use for uploads        */
  /* -------------------------------------------- */

  function getAdminApiBase() {
    const origin = window.location.origin || "";

    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.includes("mss-widget-mt.onrender.com")
    ) {
      // local dev + Render → same origin for API
      return "";
    }

    if (origin.includes("mss-widget-mt.vercel.app")) {
      // Vercel front-end → Render backend
      return "https://mss-widget-mt.onrender.com";
    }

    return "";
  }

  const ADMIN_API_BASE = getAdminApiBase();

  function absolutizeUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    const base = ADMIN_API_BASE || "";
    if (!path.startsWith("/")) path = `/uploads/${path}`;
    return `${base}${path}`;
  }

  /* -------------------------------------------- */
  /* Helpers                                      */
  /* -------------------------------------------- */

  function setStatus(msg, tone) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "iv-status";
    if (tone === "error") statusEl.classList.add("iv-status-error");
  }

  function describeMeta() {
    const bits = [];
    if (SLUG) bits.push(`slug=${SLUG}`);
    bits.push(`size=${sizePercent}%`);
    metaEl.textContent = bits.join(", ");
  }

  // 🔑 Apply current sizePercent to the image element
  function applyImageSize() {
    if (!imgEl) return;
    const scale = sizePercent / 100;
    imgEl.style.transform = `scale(${scale})`;
  }

  function updateSizeFromSlider() {
    sizePercent = Number(sizeSlider.value || 100);
    sizeLabel.textContent = `${sizePercent}%`;
    chips.forEach((chip) => chip.classList.remove("iv-chip-active"));
    describeMeta();
    applyImageSize();
  }

  function setPresetSize(pct) {
    sizePercent = pct;
    sizeSlider.value = String(pct);
    sizeLabel.textContent = `${pct}%`;
    chips.forEach((chip) => {
      const val = Number(chip.getAttribute("data-size"));
      chip.classList.toggle("iv-chip-active", val === pct);
    });
    describeMeta();
    applyImageSize();
  }

  function showImagePreview(src) {
    if (!imgEl || !placeholder) return;
    if (src) {
      imgEl.src = src;
      imgEl.style.display = "block";
      placeholder.style.display = "none";
      applyImageSize(); // ensure current scale is applied
    } else {
      imgEl.src = "";
      imgEl.style.display = "none";
      placeholder.style.display = "block";
    }
  }

  function getCallerWindow() {
    // works for popup or iframe
    if (window.opener) return window.opener;
    if (window.parent && window.parent !== window) return window.parent;
    return null;
  }

  function postResult(type, payload) {
    const target = getCallerWindow();
    if (!target) return;

    target.postMessage(
      {
        source: "MSSImageViewer",
        type,
        payload,
      },
      "*"
    );
  }

  function maybeCloseSelf() {
    // In popup mode, close. In iframe mode, parent hides modal.
    if (window.opener && !window.frameElement) {
      window.close();
    }
  }

  /* -------------------------------------------- */
  /* Upload                                       */
  /* -------------------------------------------- */

  async function uploadFileIfNeeded() {
    if (!SLUG) {
      setStatus("Missing slug – cannot upload.", "error");
      return { url: CURRENT_URL };
    }

    // No new file → keep existing URL
    if (!selectedFile) {
      return { url: CURRENT_URL };
    }

    const formData = new FormData();
    formData.append("image", selectedFile);

    const url = `${ADMIN_API_BASE}/api/admin/widget/${encodeURIComponent(
      SLUG
    )}/image`;

    console.log("[ImageViewer] Uploading image →", url);

    const res = await fetch(url, {
      method: "POST",
      body: formData,
    });

    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn("[ImageViewer] Non-JSON response from upload", raw);
      data = { ok: res.ok, raw };
    }

    if (!res.ok || data.ok === false) {
      console.error("[ImageViewer] Upload failed", { status: res.status, data });
      throw new Error(`Upload failed (HTTP ${res.status})`);
    }

    const imageUrl = data.url || data.imageUrl || data.image || data.path;
    if (!imageUrl) {
      throw new Error("Upload succeeded but no image URL returned");
    }

    const absolute = absolutizeUrl(imageUrl);
    console.log("[ImageViewer] Upload success, URL:", absolute);
    return { url: absolute };
  }

  /* -------------------------------------------- */
  /* Event wiring                                 */
  /* -------------------------------------------- */

  function wireEvents() {
    if (chooseBtn && fileInput) {
      chooseBtn.addEventListener("click", () => fileInput.click());
    }

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file =
          fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
        if (!file) return;

        selectedFile = file;
        const localUrl = URL.createObjectURL(file);
        showImagePreview(localUrl);
        setStatus("Image selected – ready to upload.");
      });
    }

    if (sizeSlider) {
      sizeSlider.addEventListener("input", updateSizeFromSlider);
    }

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const pct = Number(chip.getAttribute("data-size") || "100");
        setPresetSize(pct);
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        selectedFile = null;
        showImagePreview(CURRENT_URL);
        setPresetSize(100);
        setStatus("Reset to initial image and size.");
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        postResult("cancel", { slug: SLUG });
        maybeCloseSelf();
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        try {
          setStatus("Uploading image…");
          const { url } = await uploadFileIfNeeded();
          CURRENT_URL = url;
          urlLabel.textContent = url || "—";
          setStatus("Image saved. Sending selection back…");

          postResult("apply", {
            slug: SLUG,
            url,
            sizePercent,
          });

          maybeCloseSelf();
        } catch (err) {
          console.error("[ImageViewer] Apply failed", err);
          setStatus("Error saving image. See console.", "error");
        }
      });
    }
  }

  /* -------------------------------------------- */
  /* Init                                         */
  /* -------------------------------------------- */

  function initFromQuery() {
    const params = new URLSearchParams(window.location.search);
    SLUG = params.get("slug") || "mss-demo";

    const url = params.get("url") || "";
    const size = Number(params.get("size") || "100") || 100;

    CURRENT_URL = url ? absolutizeUrl(url) : "";
    sizePercent = size;
    sizeSlider.value = String(sizePercent);
    sizeLabel.textContent = `${sizePercent}%`;

    slugLabel.textContent = SLUG || "—";
    urlLabel.textContent = CURRENT_URL || "—";

    if (CURRENT_URL) {
      showImagePreview(CURRENT_URL);
    } else {
      showImagePreview("");
    }

    describeMeta();
    applyImageSize();
    setStatus("Ready to choose an image.");
  }

  function init() {
    initFromQuery();
    wireEvents();
  }

  document.addEventListener("DOMContentLoaded", init);
})();