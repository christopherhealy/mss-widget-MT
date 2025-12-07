// /public/config-admin/ImageViewer.js — v1.3 (DB-backed branding)
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
    let p = path;

    // If backend returns just a filename, serve it from /uploads
    if (!p.startsWith("/")) {
      p = `/uploads/${p}`;
    }

    return `${base}${p}`;
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
    if (!metaEl) return;
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
  /* Upload  → DB-backed branding_files            */
  /* -------------------------------------------- */

  async function uploadFileIfNeeded() {
    if (!SLUG) {
      setStatus("Missing slug – cannot upload.", "error");
      return { id: null, url: CURRENT_URL };
    }

    // No new file → keep existing URL (and whatever id the opener already has)
    if (!selectedFile) {
      return { id: null, url: CURRENT_URL };
    }

    const formData = new FormData();
    formData.append("image", selectedFile);

    // New canonical branding endpoint:
    // POST /api/admin/branding/:slug/logo
    const url = `${ADMIN_API_BASE}/api/admin/branding/${encodeURIComponent(
      SLUG
    )}/logo`;

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

    // Expected shape: { ok: true, image: { id, url, alt, path? } }
    const imageObj = data.image || data.logo || data.file || {};
    const id = imageObj.id != null ? imageObj.id : data.id;

    let imageUrl =
      imageObj.url ||
      imageObj.path ||
      data.url ||
      data.imageUrl ||
      data.path;

    if (!imageUrl) {
      throw new Error("Upload succeeded but no image URL returned");
    }

    const absolute = absolutizeUrl(imageUrl);
    console.log("[ImageViewer] Upload success, id:", id, "URL:", absolute);
    return { id, url: absolute };
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
          setStatus("Saving image…");
          const { id, url } = await uploadFileIfNeeded();
          CURRENT_URL = url;
          if (urlLabel) {
            urlLabel.textContent = url || "—";
          }
          setStatus("Image saved. Sending selection back…");

          // 🔑 Include DB id so ConfigAdmin can persist it in settings.image.id
          postResult("apply", {
            slug: SLUG,
            id,
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

    if (slugLabel) slugLabel.textContent = SLUG || "—";
    if (urlLabel) urlLabel.textContent = CURRENT_URL || "—";

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