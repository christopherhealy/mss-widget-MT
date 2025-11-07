// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// --- Config ---
const PORT = process.env.PORT || 5059;
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
const FILENAME_PREFIX = 'mss-log-'; // e.g. mss-log-2025-10-27.csv
const INCLUDE_TRANSCRIPT = false;    // set true to store transcript (be mindful of size/privacy)

// --- Helpers ---
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function todayName() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${FILENAME_PREFIX}${yyyy}-${mm}-${dd}.csv`;
}
function csvEscape(value) {
  // Convert to string, escape quotes, wrap in quotes if needed
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return '****';
  return `${s.slice(0,4)}…${s.slice(-4)}`;
}
function getClientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}
function headerLine() {
  const cols = [
    'timestamp_iso',
    'user_id',
    'client_ip',
    'api_key_mask',
    'api_secret_mask',
    'file_name',
    'recording_seconds',
    'submission_ms',
    'mss_score',
    'cefr_level',
    'elsa_fluency',
    'elsa_grammar',
    'elsa_pronunciation',
    'elsa_vocabulary',
    'ielts_score',
    'toefl_score',
    'pte_score',
    'status_code',
    'rate_limit',
    'rate_remaining',
    'user_agent',
    INCLUDE_TRANSCRIPT ? 'transcript_html' : null
  ].filter(Boolean);
  return cols.join(',') + '\n';
}
function rowLine(payload) {
  const {
    userId,
    apiKey,
    apiSecret,
    fileName,
    seconds,
    submissionMs,
    mssBody,
    statusCode,
    rateLimit,
    rateRemaining,
    userAgent,
    transcript // optional (already HTML from MSS)
  } = payload;

  const elsa = (mssBody && mssBody.elsa_results) || {};
  const cols = [
    new Date().toISOString(),
    userId || '',
    payload.clientIp || '',
    maskKey(apiKey),
    maskKey(apiSecret),
    fileName || '',
    typeof seconds === 'number' ? seconds : '',
    typeof submissionMs === 'number' ? submissionMs : '',
    (mssBody && mssBody.score) ?? '',
    (elsa.cefr_level || '').toString().toUpperCase(),
    elsa.fluency ?? '',
    elsa.grammar ?? '',
    elsa.pronunciation ?? '',
    elsa.vocabulary ?? '',
    elsa.ielts_score ?? '',
    elsa.toefl_score ?? '',
    elsa.pte_score ?? '',
    statusCode ?? '',
    rateLimit ?? '',
    rateRemaining ?? '',
    userAgent || '',
    INCLUDE_TRANSCRIPT ? (transcript || '') : null
  ].filter(v => v !== null); // drop transcript column if disabled

  return cols.map(csvEscape).join(',') + '\n';
}
function appendCSV(payload) {
  ensureDir(LOG_DIR);
  const filePath = path.join(LOG_DIR, todayName());
  // create with header if missing
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, headerLine(), 'utf8');
  }
  fs.appendFileSync(filePath, rowLine(payload), 'utf8');
}

// --- Middleware ---
app.use(cors());         // adjust CORS for your widget origin if you want to restrict
app.use(express.json({ limit: '2mb' }));

// --- Routes ---
app.get('/', (_req, res) => res.send('MSS CSV Logger up'));
app.post('/log', (req, res) => {
  try {
    const clientIp = getClientIP(req);
    const userAgent = req.headers['user-agent'] || '';
    const body = req.body || {};

    appendCSV({
      userId: body.userId || '',
      clientIp,
      apiKey: body.apiKey || '',
      apiSecret: body.apiSecret || '',
      fileName: body.fileName || '',
      seconds: body.seconds,
      submissionMs: body.submissionMs,
      mssBody: body.mssBody || {},
      statusCode: body.statusCode,
      rateLimit: body.rateLimit,
      rateRemaining: body.rateRemaining,
      userAgent,
      transcript: body.transcript // only saved if INCLUDE_TRANSCRIPT=true
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('CSV log error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`CSV logger listening on http://0.0.0.0:${PORT}`);
});