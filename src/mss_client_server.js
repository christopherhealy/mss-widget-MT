// src/mss_client_server.js (ESM, Node-only)

export function createMssClientServer() {
  const voxUrl = String(process.env.MSS_VOX_URL || "").trim();
  if (!voxUrl) throw new Error("Missing MSS_VOX_URL");

  const defaultKey = String(process.env.MSS_API_KEY || "").trim();
  const defaultSecret = String(process.env.MSS_API_SECRET || "").trim();

  return {
    async scoreSpeakingVox({ buffer, filename, mimetype, question, length_sec, apiKey, apiSecret }) {
      const fd = new FormData();

      const blob = new Blob([buffer], { type: mimetype || "audio/wav" });
      fd.append("file", blob, filename || "answer.wav");
      if (question) fd.append("question", String(question));
      if (length_sec != null) fd.append("length_sec", String(length_sec));

      const headers = {};
      const k = String(apiKey || defaultKey || "").trim();
      const s = String(apiSecret || defaultSecret || "").trim();
      if (k) headers["API-KEY"] = k;
      if (s) headers["x-api-secret"] = s;

      const resp = await fetch(voxUrl, { method: "POST", headers, body: fd });
      const json = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        const err = new Error(json?.message || json?.error || `Vox HTTP ${resp.status}`);
        err.status = resp.status;
        err.payload = json;
        throw err;
      }

      return json;
    },
  };
}