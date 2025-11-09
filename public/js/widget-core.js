
console.log("✅ widget-core.js loaded");
/* ===== Basic state ===== */
const $ = (id) => document.getElementById(id);

let FORM = null;
let CONFIG = null;
let IMAGE = null;

let idx = 0;
let chunks = [];
let mediaRecorder = null;
let recording = false;
let blob = null;
let url = null;
let uploadedFile = null;
let t0 = 0;
let tick = null;
let submitTimerId = null;
let submitStart = 0;
let dashboardWindow = null;

/* ===== Helpers ===== */
function mmss(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function setStatus(msg, ok = true) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "mss-status " + (ok ? "ok" : "warn");
}

function getLogoFrom(img) {
  if (!img) return "";
  for (const k of ["logoDataUrl", "dataUrl", "logo", "src", "url", "path"]) {
    if (img[k]) return String(img[k]);
  }
  return "";
}

function showDebug(obj) {
  const el = $("results");
  if (!el) return;
  el.textContent = JSON.stringify(obj, null, 2);
}
function appendAttempt(at) {
  const el = $("results");
  if (!el) return;
  const prev = el.textContent.trim();
  const add = JSON.stringify(at, null, 2);
  el.textContent = prev ? prev + "\n" + add : add;
}

/* Duration bounds from CONFIG */
function getDurationBounds() {
  const minS = Number(CONFIG?.audioMinSeconds ?? 30);
  const maxS = Number(CONFIG?.audioMaxSeconds ?? 61);
  return { minS, maxS };
}

/* Progress line */
function startProgress(label = "Processing") {
  submitStart = performance.now();
  $("progressText").textContent = `${label}… 0.00s`;
  $("progressLine").style.width = "5%";
  submitTimerId = setInterval(() => {
    const s = ((performance.now() - submitStart) / 1000).toFixed(2);
    $("progressText").textContent = `${label}… ${s}s`;
    const w = Math.min(95, 5 + (performance.now() - submitStart) / 60);
    $("progressLine").style.width = w + "%";
  }, 120);
}

function stopProgress(finalLabel = "Done") {
  if (submitTimerId) {
    clearInterval(submitTimerId);
    submitTimerId = null;
  }
  const s = ((performance.now() - submitStart) / 1000).toFixed(2);
  $("progressText").textContent = `${finalLabel} (${s}s)`;
  $("progressLine").style.width = "100%";
  setTimeout(() => {
    const line = $("progressLine");
    line.style.transition = "none";
    line.style.width = "0%";
    $("progressText").textContent = "";
    void line.offsetWidth;
    line.style.transition = "width .2s ease";
  }, 600);
}

/* WAV transcode */
async function blobToArrayBuffer(b) {
  return await b.arrayBuffer();
}

function encodeWavFromAudioBuffer(abuf) {
  const chs = abuf.numberOfChannels,
    rate = abuf.sampleRate,
    len = abuf.length;
  const bytesPerSample = 2,
    blockAlign = chs * bytesPerSample,
    dataBytes = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataBytes),
    v = new DataView(buf);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataBytes, true);
  const chData = Array.from({ length: chs }, (_, i) => abuf.getChannelData(i));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < chs; c++) {
      let s = Math.max(-1, Math.min(1, chData[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

async function transcodeToWav(origBlob) {
  const arr = await blobToArrayBuffer(origBlob);
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const abuf = await ctx.decodeAudioData(arr);
  ctx.close();
  return encodeWavFromAudioBuffer(abuf);
}

/* Access check */
async function checkAccess(baseUrl, key) {
  try {
    const url = baseUrl.replace(/\/+$/, "") + "/api/check-access";
    const r = await fetch(url, {
      headers: { "API-KEY": key, Accept: "application/json" },
    });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, url, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      url: "(check failed)",
      body: { error: String(e) },
    };
  }
}

/* UI helpers */
function hideDebug() {
  const row = $("debugBtnRow");
  const wrap = $("debugWrap");
  const ls = $("logStatus");
  if (row) row.style.display = "none";
  if (wrap) wrap.style.display = "none";
  if (ls) {
    ls.textContent = "";
    ls.className = "mss-logstatus";
  }
}

function clearTimer() {
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  const t = $("timer");
  if (t) t.textContent = "";
}

function stopTracks() {
  try {
    mediaRecorder?.stream?.getTracks?.().forEach((t) => t.stop());
  } catch {}
}

function releaseBlobUrl() {
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
    url = null;
  }
}

function resetRecordingUI(msg = "Not recording") {
  recording = false;
  chunks = [];
  blob = null;
  clearTimer();
  stopTracks();
  releaseBlobUrl();

  const recBtn = $("recBtn");
  const stopBtn = $("stopBtn");
  const submitBtn = $("submitBtn");
  const recDot = $("recDot");
  const recState = $("recState");
  const playerWrap = $("playerWrap");
  const p = $("player");
  const lengthHint = $("lengthHint");

  if (recBtn) recBtn.disabled = !!uploadedFile;
  if (stopBtn) stopBtn.disabled = true;
  if (submitBtn) submitBtn.disabled = !(uploadedFile || blob);
  if (recDot) recDot.classList.remove("on");
  if (recState) recState.textContent = msg;
  if (playerWrap)
    playerWrap.style.display = uploadedFile || url ? "block" : "none";

  if (!uploadedFile && p) {
    try {
      p.pause();
      p.removeAttribute("src");
      p.load();
    } catch {}
  }
  if (lengthHint) lengthHint.textContent = "";
  hideDebug();
}

/* Load config/data from Render */
async function loadAll() {
  const base = (window.SERVICE_BASE || "").replace(/\/+$/, "");

  const [f, c, i] = await Promise.allSettled([
    fetch(base + "/config/forms?ts=" + Date.now(), { cache: "no-store" }),
    fetch(base + "/config/widget?ts=" + Date.now(), { cache: "no-store" }),
    fetch(base + "/config/images?ts=" + Date.now(), { cache: "no-store" }),
  ]);

  FORM =
    f.status === "fulfilled" && f.value.ok
      ? await f.value.json()
      : { survey: [] };

  CONFIG =
    c.status === "fulfilled" && c.value.ok
      ? await c.value.json()
      : {
          editable: {},
          api: {},
          theme: "apple",
          audioMinSeconds: 30,
          audioMaxSeconds: 61,
          logger: { enabled: false, url: "" },
        };

  IMAGE =
    i.status === "fulfilled" && i.value.ok ? await i.value.json() : {};

  // Text + branding
  const brand = $("brand");
  const powered = $("powered");
  const logoEl = $("logo");

  if (brand)
    brand.textContent = FORM.headline || "Practice TOEFL Speaking Test";

  if (powered) {
    powered.textContent =
      CONFIG.editable?.poweredByLabel === false
        ? ""
        : FORM.poweredByLabel || "Powered by MSS Vox";
  }

  const logo = getLogoFrom(IMAGE);
  if (logo && logoEl) logoEl.src = logo;

  // Respect Permitupload flag for upload controls
  const allowUpload = CONFIG.Permitupload !== false; // default true
  const uploadBtn = $("uploadBtn");
  const fileInput = $("fileInput");
  const clearFileBtn = $("clearFileBtn");

  if (!allowUpload) {
    if (uploadBtn) uploadBtn.style.display = "none";
    if (fileInput) fileInput.style.display = "none";
    if (clearFileBtn) clearFileBtn.style.display = "none";
  } else {
    if (uploadBtn) uploadBtn.style.display = "";
    if (fileInput) fileInput.style.display = "";
  }

  renderQ();
  resetRecordingUI();
}
function resetRecordingUI(msg = "Not recording") {
  recording = false;
  chunks = [];
  blob = null;
  clearTimer();
  stopTracks();
  releaseBlobUrl();

  const recBtn = $("recBtn");
  const stopBtn = $("stopBtn");
  const submitBtn = $("submitBtn");
  const recDot = $("recDot");
  const recState = $("recState");
  const playerWrap = $("playerWrap");
  const p = $("player");
  const lengthHint = $("lengthHint");

  if (recBtn) recBtn.disabled = !!uploadedFile;
  if (stopBtn) stopBtn.disabled = true;

  // 🔧 always show the submit button, just disable it when empty
 if (submitBtn) {
  submitBtn.style.display = "inline-block";
  submitBtn.disabled = !(uploadedFile || blob);
}

  if (recDot) recDot.classList.remove("on");
  if (recState) recState.textContent = msg;

  if (playerWrap)
    playerWrap.style.display = uploadedFile || url ? "block" : "none";

  if (!uploadedFile && p) {
    try {
      p.pause();
      p.removeAttribute("src");
      p.load();
    } catch {}
  }

  if (lengthHint) lengthHint.textContent = "";
  hideDebug();
}



/* Render question */
function renderQ() {
  const s = Array.isArray(FORM?.survey) ? FORM.survey : [];
  const counter = $("counter");
  const qEl = $("question");

  if (!s.length) {
    if (counter) counter.textContent = "";
    if (qEl) qEl.textContent = "(No questions found)";
    return;
  }
  idx = Math.max(0, Math.min(idx, s.length - 1));
  if (counter) counter.textContent = `Question ${idx + 1} of ${s.length}`;
  if (qEl) qEl.textContent = s[idx];
}

/* Recording */
async function startRecording() {
  if (uploadedFile) return;
  hideDebug();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    mediaRecorder.onstop = finalizeRecording;

    recording = true;
    t0 = performance.now();
    tick = setInterval(() => {
      $("timer").textContent = mmss(performance.now() - t0);
    }, 200);

    $("recBtn").disabled = true;
    $("stopBtn").disabled = false;
    $("submitBtn").disabled = true;
    $("recDot").classList.add("on");
    $("recState").textContent = "Recording…";
    $("playerWrap").style.display = "none";

    mediaRecorder.start();
    setStatus("Recording started");
  } catch (err) {
    setStatus("Microphone permission denied", false);
  }
}

function stopRecording() {
  if (!mediaRecorder || !recording) return;
  recording = false;
  try {
    mediaRecorder.stop();
  } catch {}
  stopTracks();
  clearTimer();
  $("recDot").classList.remove("on");
  $("recState").textContent = "Processing…";
  $("stopBtn").disabled = true;
}

function finalizeRecording() {
  blob = new Blob(chunks, { type: "audio/webm" });
  releaseBlobUrl();
  url = URL.createObjectURL(blob);

  const p = $("player");
  const wrap = $("playerWrap");

  if (p && wrap) {
    p.src = url;
    wrap.style.display = "block";
  }

  const recState = $("recState");
  const recBtn = $("recBtn");
  const submitBtn = $("submitBtn");

  if (recState) recState.textContent = "Ready to review or submit";
  if (recBtn) recBtn.disabled = false;
  if (submitBtn) submitBtn.disabled = false;
  setStatus("Recording ready");

  if (p) {
    p.onloadedmetadata = () => {
      const d = p.duration || 0;
      const { minS, maxS } = getDurationBounds();
      const mins = String(Math.floor(minS / 60)).padStart(2, "0");
      const secs = String(minS % 60).padStart(2, "0");
      const maxm = String(Math.floor(maxS / 60)).padStart(2, "0");
      const maxs = String(maxS % 60).padStart(2, "0");
      const lh = $("lengthHint");
      if (lh) {
        lh.textContent = `Length: ${mmss(
          d * 1000
        )} (must be ${mins}:${secs}–${maxm}:${maxs})`;
      }
    };
  }
}
/* Upload (mutually exclusive) */
const fileInputEl = $("fileInput");
if (fileInputEl) {
  fileInputEl.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;

    uploadedFile = f;

    const badge = $("fileBadge");
    if (badge) {
      badge.textContent = `Selected: ${f.name} (${(
        f.size /
        1024 /
        1024
      ).toFixed(2)} MB)`;
    }

    const clearBtn = $("clearFileBtn");
    if (clearBtn) clearBtn.style.display = "inline-block";

    const recBtn = $("recBtn");
    const stopBtn = $("stopBtn");
    const submitBtn = $("submitBtn");
    if (recBtn) recBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;

    releaseBlobUrl();
    url = URL.createObjectURL(f);

    const p = $("player");
    const wrap = $("playerWrap");
    if (p && wrap) {
      p.src = url;
      wrap.style.display = "block";
    }

    if (submitBtn) submitBtn.disabled = false;

    hideDebug();

    if (p) {
      p.onloadedmetadata = () => {
        const d = p.duration || 0;
        const { minS, maxS } = getDurationBounds();
        const mins = String(Math.floor(minS / 60)).padStart(2, "0");
        const secs = String(minS % 60).padStart(2, "0");
        const maxm = String(Math.floor(maxS / 60)).padStart(2, "0");
        const maxs = String(maxS % 60).padStart(2, "0");
        const lh = $("lengthHint");
        if (lh) {
          lh.textContent = `Length: ${mmss(
            d * 1000
          )} (must be ${mins}:${secs}–${maxm}:${maxs})`;
        }
      };
    }
  });
}

const clearFileBtnEl = $("clearFileBtn");
if (clearFileBtnEl) {
  clearFileBtnEl.addEventListener("click", () => {
    uploadedFile = null;
    $("fileInput").value = "";
    $("fileBadge").textContent = "";
    $("clearFileBtn").style.display = "none";
    resetRecordingUI("File cleared — ready to record");
  });
}

/* Submit helpers */
function getActiveAudioBlob() {
  if (uploadedFile) return uploadedFile;
  if (blob) return blob;
  return null;
}

async function submitRecording() {
  const base = (CONFIG?.api?.baseUrl || "").trim();
  const key = (CONFIG?.api?.key || "").trim();
  const secret = (CONFIG?.api?.secret || "").trim();

  if (!key || !secret || !base) {
    setStatus(
      "Missing MSS API configuration (baseUrl / key / secret)",
      false
    );
    appendAttempt({
      error: "missing_credentials",
      base: !!base,
      key: !!key,
      secret: !!secret,
    });
    return;
  }

  const input = getActiveAudioBlob();
  if (!input) {
    setStatus("No recording or file to submit", false);
    return;
  }

  // Duration validation
  const p = $("player");
  const dur = p?.duration || 0;
  const { minS, maxS } = getDurationBounds();
  if (
    !Number.isNaN(dur) &&
    dur > 0 &&
    (dur < minS || dur > maxS)
  ) {
    setStatus(
      `Audio must be between ${minS} and ${maxS} seconds. Please try again.`,
      false
    );
    appendAttempt({
      error: "duration_out_of_range",
      seconds: Math.round(dur),
      minS,
      maxS,
    });
    return;
  }

  // Prepare audio
  setStatus("Preparing audio…");
  startProgress("Submitting");
  let wavBlob;
  try {
    if (uploadedFile && /^audio\/wav/i.test(uploadedFile.type))
      wavBlob = uploadedFile;
    else wavBlob = await transcodeToWav(input);
  } catch (e) {
    stopProgress("Failed");
    setStatus("Could not prepare audio", false);
    appendAttempt({ error: "wav_transcode_failed", message: String(e) });
    return;
  }

  const pre = await checkAccess(base, key);
  appendAttempt({ step: "check-access", ...pre });
  if (!pre.ok) {
    stopProgress("Failed");
    setStatus(`Access check failed (${pre.status})`, false);
    return;
  }

  setStatus("Submitting to MSS…");

  const endpoint = base.replace(/\/+$/, "") + "/api/codebot/vox";
  const fd = new FormData();
  fd.append(
    "file",
    wavBlob,
    uploadedFile ? uploadedFile.name : "answer.wav"
  );

  let submitSec = 0;
  const tStart = performance.now();
  try {
    const headers = {
      "API-KEY": key,
      "X-API-SECRET": secret,
      Accept: "application/json",
    };
    const res = await fetch(endpoint, { method: "POST", headers, body: fd });
    submitSec = Math.max(0, (performance.now() - tStart) / 1000);
    const body = await res.json().catch(() => ({}));
    appendAttempt({
      step: "vox",
      status: res.status,
      url: endpoint,
      sent: {
        fileName: uploadedFile ? uploadedFile.name : "answer.wav",
        fileType: wavBlob.type,
        fileSize: wavBlob.size,
      },
      headers: {
        "X-RateLimit-Limit": res.headers.get("X-RateLimit-Limit"),
        "X-RateLimit-Remaining": res.headers.get("X-RateLimit-Remaining"),
      },
      body,
    });

    if (res.ok) {
      stopProgress("Done");
      setStatus("Submitted ✅");

      $("debugBtnRow").style.display = "flex";
      showDebug({ received: body });

      try {
        sessionStorage.setItem(
          "mss-last-results",
          JSON.stringify(body)
        );
      } catch (e) {
        console.warn("Could not store results in sessionStorage", e);
      }

      openDashboard();

      try {
        if (dashboardWindow) {
          dashboardWindow.postMessage(
            { type: "mss-results", payload: body },
            "*"
          );
        }
      } catch (e) {
        console.warn("dash postMessage failed", e);
      }

      logResultToCsv(body, {
        fileName: uploadedFile ? uploadedFile.name : "answer.wav",
        lengthSec: Math.round(dur || 0),
        submitTime: Number(submitSec.toFixed(2)),
        question: Array.isArray(FORM?.survey)
          ? FORM.survey[idx] || ""
          : "",
      });

      $("submitBtn").disabled = false;
    } else {
      stopProgress("Failed");
      setStatus(`Submit failed (${res.status})`, false);
    }
  } catch (err) {
    stopProgress("Failed");
    setStatus("Network error", false);
    appendAttempt({ error: String(err) });
  }
}

async function logResultToCsv(mssBody, meta) {
  const enabled = Boolean(CONFIG?.logger?.enabled);
  if (!enabled) return;

  const base = (window.SERVICE_BASE || "").replace(/\/+$/, "");
  let url = (CONFIG?.logger?.url || "").trim();

  // If no URL, or if it looks like a legacy /log or .json endpoint,
  // use the new CSV+Postgres logger.
  if (
    !url ||
    url.endsWith("/log") ||
    url.endsWith("/log/") ||
    url.endsWith("/log.json")
  ) {
    url = base + "/log/submission";
  }

  const ipPlaceholder = ""; // server fills real IP
  const ts = new Date().toISOString();

  const toefl =
    mssBody?.elsa_results?.toefl_score ?? mssBody?.toefl_score ?? "";
  const ielts =
    mssBody?.elsa_results?.ielts_score ?? mssBody?.ielts_score ?? "";
  const pte = mssBody?.elsa_results?.pte_score ?? mssBody?.pte_score ?? "";
  const cefr = (
    mssBody?.elsa_results?.cefr_level ||
    mssBody?.cefr_level ||
    ""
  )
    .toString()
    .toUpperCase();

  const transcript = (mssBody?.transcript || "").toString().trim();
  let wpm = "";
  try {
    if (transcript) {
      const words = transcript.split(/\s+/).filter(Boolean).length;
      const minutes = Math.max(0.01, (meta.lengthSec || 0) / 60);
      wpm = Math.round(words / minutes);
    }
  } catch {}

  const payload = {
    timestamp: new Date().toISOString(),   // ✅ Add UTC ISO timestamp
    ip: ipPlaceholder,
    userId: "",
    fileName: meta.fileName || "",
    lengthSec: meta.lengthSec || "",
    submitTime: meta.submitTime || "",
    toefl,
    ielts,
    pte,
    cefr,
    question: meta.question || "",
    transcript,
    wpm,
  };

  const statusEl = $("logStatus");
  if (!statusEl) return;

  try {
    statusEl.textContent = "Logging…";
    statusEl.className = "mss-logstatus";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j?.ok) {
      statusEl.textContent = "Logged ✓";
      statusEl.className = "mss-logstatus ok";
      console.log("📝 Logged:", j.file);
    } else {
      statusEl.textContent = "Log failed";
      statusEl.className = "mss-logstatus err";
      console.warn("Logger responded error:", j);
    }
  } catch (e) {
    statusEl.textContent = "Log error";
    statusEl.className = "mss-logstatus err";
    console.warn("Logger unreachable:", e);
  }
}
/* Dashboard modal */
function openDashboard() {
  const m = $("dashModal");
  const f = $("dashFrame");
  if (!m || !f) return;

  dashboardWindow = f.contentWindow;

  // Show modal – no aria-hidden changes
  m.hidden = false;
  m.style.display = "flex";
}

function closeDashboard() {
  const m = $("dashModal");
  if (!m) return;

  // Hide modal – no aria-hidden changes
  m.style.display = "none";
  m.hidden = true;
}

const closeDashBtn = $("closeDash");
if (closeDashBtn) {
  closeDashBtn.addEventListener("click", closeDashboard);
}
const dashModalEl = $("dashModal");
if (dashModalEl) {
  dashModalEl.addEventListener("click", (e) => {
    if (e.target === dashModalEl) closeDashboard();
  });
}

/* Wire up */
window.addEventListener("DOMContentLoaded", async () => {
  await loadAll();

  $("recBtn")?.addEventListener("click", startRecording);
  $("stopBtn")?.addEventListener("click", stopRecording);
  $("submitBtn")?.addEventListener("click", submitRecording);


  $("prevBtn")?.addEventListener("click", () => {
    idx--;
    renderQ();
    resetRecordingUI("Not recording");
    hideDebug();
  });
  $("nextBtn")?.addEventListener("click", () => {
    idx++;
    renderQ();
    resetRecordingUI("Not recording");
    hideDebug();
  });

  $("toggleDebug")?.addEventListener("click", () => {
    const w = $("debugWrap");
    if (!w) return;
    w.style.display = w.style.display === "block" ? "none" : "block";
  });
});