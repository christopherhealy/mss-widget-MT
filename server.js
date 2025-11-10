// server.js (ESM, works with "type": "module")
import express from "express";
import pkg from "pg";
import { insertSubmission } from "./db.js";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;

// Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Basic path setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = path.join(ROOT, "public");
const THEMES_DIR = path.join(ROOT, "themes");

// CSV log in /tmp (ephemeral on free Render)
const LOG_CSV = "/tmp/msswidget-log.csv";
const LOG_HEADERS = [
  "timestamp",
  "ip",
  "userId",
  "fileName",
  "lengthSec",
  "submitTime",
  "toefl",
  "ielts",
  "pte",
  "cefr",
  "question",
  "transcript",
  "wpm",
  "recordCount",
  "teacher",
  "note",
];

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- middleware ---------- */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-ADMIN-KEY", "API-KEY", "X-API-SECRET"],
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve signup page explicitly (so /signup and /signup/ both work)
app.get("/signup", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "signup", "index.html"));
});

// Static files
app.use(express.static(PUBLIC_DIR));
app.use("/themes", express.static(path.join(PUBLIC_DIR, "themes")));
app.use("/themes", express.static(THEMES_DIR));

/* ---------- helpers (legacy JSON config helpers) ---------- */
async function ensureSrcDir() {
  try {
    await fs.mkdir(SRC_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function slugifySchoolName(name) {
  const base =
    (name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "school";
  return base;
}
let defaultWidgetConfig = null;
let defaultWidgetForm = null;

async function loadDefaultWidgetConfigAndForm() {
  if (defaultWidgetConfig && defaultWidgetForm) {
    return { config: defaultWidgetConfig, form: defaultWidgetForm };
  }
  const cfg = await readJson("config.json", defaultConfig);
  const frm = await readJson("form.json", defaultForm);
  defaultWidgetConfig = cfg;
  defaultWidgetForm = frm;
  return { config: cfg, form: frm };
}

async function getUniqueSlug(client, baseSlug) {
  let slug = baseSlug;
  let counter = 1;
  // loop until we find a free slug
  // using the same client so it works inside a transaction
  /* eslint-disable no-constant-condition */
  while (true) {
    const { rows } = await client.query(
      "SELECT 1 FROM schools WHERE slug = $1",
      [slug]
    );
    if (!rows.length) return slug;
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

async function readJson(rel, fallback = {}) {
  await ensureSrcDir();
  const full = path.join(SRC_DIR, rel);
  try {
    const txt = await fs.readFile(full, "utf8");
    return JSON.parse(txt);
  } catch {
    await fs.writeFile(full, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeJson(rel, obj) {
  await ensureSrcDir();
  const full = path.join(SRC_DIR, rel);
  await fs.writeFile(full, JSON.stringify(obj ?? {}, null, 2), "utf8");
}

/* ---------- defaults (legacy) ---------- */
const defaultForm = {
  headline: "Practice TOEFL Speaking Test",
  recordButton: "Record your response",
  previousButton: "Previous",
  nextButton: "Next",
  uploadButton: "Choose an audio file",
  stopButton: "Stop",
  poweredByLabel: "Powered by MSS Vox",
  NotRecordingLabel: "Not recording",
  SubmitForScoringButton: "Submit for scoring",
  survey: [],
};

const defaultConfig = {
  editable: {
    headline: true,
    recordButton: true,
    previousButton: true,
    nextButton: true,
    poweredByLabel: true,
    uploadButton: true,
    stopButton: true,
    NotRecordingLabel: true,
    SubmitForScoringButton: true,
  },
  theme: "apple",
  api: { enabled: true, baseUrl: "", key: "", secret: "" },
  logger: { enabled: false, url: "" },
  audioMinSeconds: 30,
  audioMaxSeconds: 61,
};

const defaultImages = { logoDataUrl: "" };

/* ---------- ADMIN KEY ---------- */
const ADMIN_WRITE_KEY = process.env.ADMIN_WRITE_KEY || "";
function checkAdminKey(req, res) {
  if (!ADMIN_WRITE_KEY) return true;
  const header = req.header("X-ADMIN-KEY");
  if (header && header === ADMIN_WRITE_KEY) return true;
  res.status(401).json({ ok: false, error: "admin unauthorized" });
  return false;
}

/* ---------- LEGACY FILE-BASED CONFIG ROUTES (still usable by ConfigAdmin) ---------- */
app.get("/config/forms", async (req, res) => {
  try {
    const data = await readJson("form.json", defaultForm);
    res.json(data);
  } catch (e) {
    console.error("GET /config/forms error:", e);
    res.status(500).json({ error: "failed to read forms" });
  }
});

app.put("/config/forms", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("form.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/forms error:", e);
    res.status(500).json({ ok: false, error: "failed to write forms" });
  }
});

app.get("/config/widget", async (req, res) => {
  try {
    const data = await readJson("config.json", defaultConfig);
    res.json(data);
  } catch (e) {
    console.error("GET /config/widget error:", e);
    res.status(500).json({ error: "failed to read widget config" });
  }
});

app.put("/config/widget", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("config.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/widget error:", e);
    res.status(500).json({ ok: false, error: "failed to write widget config" });
  }
});

app.get("/config/images", async (req, res) => {
  try {
    const data = await readJson("image.json", defaultImages);
    res.json(data);
  } catch (e) {
    console.error("GET /config/images error:", e);
    res.status(500).json({ error: "failed to read images" });
  }
});

app.put("/config/images", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("image.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/images error:", e);
    res.status(500).json({ ok: false, error: "failed to write images" });
  }
});


/* ---------- NEW: DB-BACKED WIDGET BOOTSTRAP ROUTES ---------- */

// Returns widgetConfig + widgetForm + logo URL for a school slug
app.get("/api/widget/:slug/bootstrap", async (req, res) => {
  const { slug } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        s.id,
        s.slug,
        s.settings,
        EXISTS (
          SELECT 1
          FROM school_assets a
          WHERE a.school_id = s.id
            AND a.kind = 'widget-logo'
        ) AS has_logo
      FROM schools s
      WHERE s.slug = $1
      `,
      [slug]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "School not found" });
    }

    const row = result.rows[0];
    const settings = row.settings || {};

    res.json({
      schoolId: row.slug, // NOTE: slug used by widget
      config: settings.widgetConfig || {},
      form: settings.widgetForm || {},
      imageUrl: row.has_logo
        ? `/api/widget/${encodeURIComponent(row.slug)}/image/widget-logo`
        : null,
    });
  } catch (err) {
    console.error("Error in /api/widget/:slug/bootstrap", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Serves logo (and later other assets) from school_assets
app.get("/api/widget/:slug/image/:kind", async (req, res) => {
  const { slug, kind } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT a.mime_type, a.data
      FROM schools s
      JOIN school_assets a ON a.school_id = s.id
      WHERE s.slug = $1
        AND a.kind = $2
      `,
      [slug, kind]
    );

    if (result.rowCount === 0) {
      return res.status(404).send("Image not found");
    }

    const row = result.rows[0];
    res.setHeader(
      "Content-Type",
      row.mime_type || "application/octet-stream"
    );
    res.send(row.data);
  } catch (err) {
    console.error("Error in /api/widget/:slug/image/:kind", err);
    res.status(500).send("Server error");
  }
});

/* ---------- CONFIG ADMIN: PER-SCHOOL WIDGET SETTINGS ---------- */

// GET current widget config/form/billing for a school (by slug)
app.get("/api/admin/widget/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows, rowCount } = await pool.query(
      `SELECT id, settings FROM schools WHERE slug = $1`,
      [slug]
    );

    if (!rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }

    const school = rows[0];
    const settings = school.settings || {};

    // fall back to JSON defaults for brand new schools
    const { config: defaultCfg, form: defaultFrm } =
      await loadDefaultWidgetConfigAndForm();

    const config = settings.widgetConfig || defaultCfg;
    const form = settings.widgetForm || defaultFrm;
    const billing =
      settings.billing || {
        dailyLimit: 50,
        notifyOnLimit: true,
        emailOnLimit: "",
        autoBlockOnLimit: true,
      };

    res.json({
      ok: true,
      schoolId: school.id,
      slug,
      config,
      form,
      billing,
    });
  } catch (err) {
    console.error("GET /api/admin/widget/:slug error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// UPDATE widget config/form/billing for a school (by slug)
app.put("/api/admin/widget/:slug", async (req, res) => {
  const { slug } = req.params;
  const body = req.body || {};
  const config = body.config || {};
  const form = body.form || {};
  const billing = body.billing || {};

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE schools
      SET settings =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              COALESCE(settings, '{}'::jsonb),
              '{widgetConfig}', $2::jsonb, true
            ),
            '{widgetForm}', $3::jsonb, true
          ),
          '{billing}', $4::jsonb, true
        )
      WHERE slug = $1
      `,
      [slug, config, form, billing]
    );

    if (!rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/admin/widget/:slug error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ---------- LOGGING ENDPOINT MT---------- */

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// APPEND new log (widget uses this)
// Also mirrors into Postgres (multi-tenant DB) when DATABASE_URL is set
app.post("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const headers = LOG_HEADERS;

    // best-effort IP capture
    const rawIp =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "") + "";
    const ip = rawIp.split(",")[0].trim();
    body.ip = ip;

    // --- write to CSV (for existing report UI) ---
    const rowValues = headers.map((h) => body[h] ?? "");
    const line = rowValues.map(csvEscape).join(",") + "\n";

    let prefix = "";
    try {
      await fs.access(LOG_CSV);
    } catch {
      // file doesn’t exist yet → write header row
      prefix = headers.join(",") + "\n";
    }
    await fs.appendFile(LOG_CSV, prefix + line, "utf8");

    // --- ALSO write to Postgres (non-fatal if it fails) ---
    let dbOk = false;
    let dbError = null;

    if (process.env.DATABASE_URL) {
      try {
        await insertSubmission({
          school_id: body.schoolId || 1, // demo school for now
          assessment_id: body.assessmentId || null,
          student_id: body.studentId || null,
          teacher_id: body.teacherId || null,
          ip,
          record_count: body.recordCount ?? null,
          file_name: body.fileName ?? null,
          length_sec: body.lengthSec ?? null,
          submit_time: body.submitTime ?? null,
          toefl: body.toefl ?? null,
          ielts: body.ielts ?? null,
          pte: body.pte ?? null,
          cefr: body.cefr ?? null,
          question: body.question ?? null,
          transcript: body.transcript ?? null,
          wpm: body.wpm ?? null,
          meta: body.meta || null,
        });
        dbOk = true;
      } catch (err) {
        console.error("DB insert error:", err);
        dbError = err.message || String(err);
      }
    }

    // tell the client what happened
    res.json({ ok: true, dbOk, dbError });
  } catch (e) {
    console.error("POST /log/submission error:", e);
    res.status(500).json({ ok: false, error: "log failed" });
  }
});

// UPDATE a single CSV row (used by Report UI when teacher edits notes)
app.put("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    const updates = body.updates || {};

    if (!Number.isInteger(id) || id < 0) {
      return res
        .status(400)
        .json({ ok: false, error: "id (row index) is required" });
    }
    if (!updates || typeof updates !== "object") {
      return res
        .status(400)
        .json({ ok: false, error: "updates object is required" });
    }

    let csv;
    try {
      csv = await fs.readFile(LOG_CSV, "utf8");
    } catch {
      return res.status(404).json({ ok: false, error: "log file not found" });
    }

    const trimmed = csv.trim();
    if (!trimmed) {
      return res
        .status(400)
        .json({ ok: false, error: "log is empty or only has header" });
    }

    const lines = trimmed.split(/\r?\n/);
    if (lines.length < 2) {
      return res
        .status(400)
        .json({ ok: false, error: "log is empty or only has header" });
    }

    const headers = parseCsvLine(lines[0]);
    const rowLines = lines.slice(1).filter((l) => l.trim() !== "");

    if (id >= rowLines.length) {
      return res.status(400).json({ ok: false, error: "row id out of range" });
    }

    const parsedRows = rowLines.map((line) => parseCsvLine(line));

    const targetCols = parsedRows[id];
    const rowObj = {};
    headers.forEach((h, i) => {
      rowObj[h] = targetCols[i] ?? "";
    });

    // apply updates only for known headers
    Object.entries(updates).forEach(([key, val]) => {
      if (headers.includes(key)) {
        rowObj[key] = val == null ? "" : String(val);
      }
    });

    const updatedCols = headers.map((h) => rowObj[h] ?? "");
    parsedRows[id] = updatedCols;

    const outLines = [
      headers.join(","), // keep existing header
      ...parsedRows.map((cols) => cols.map(csvEscape).join(",")),
    ];

    await fs.writeFile(LOG_CSV, outLines.join("\n") + "\n", "utf8");

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /log/submission error:", e);
    res.status(500).json({ ok: false, error: "failed to update log" });
  }
});

/* ---------- health ---------- */
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---------- EMBED CHECK & EVENTS ----------

// Simple helper to get billing + usage for a school
async function getSchoolBillingStatus(schoolId) {
  const id = Number(schoolId);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, error: "invalid_school_id" };
  }

  const { rows } = await pool.query(
    `SELECT id, settings FROM schools WHERE id = $1`,
    [id]
  );
  if (!rows.length) {
    return { ok: false, error: "school_not_found" };
  }

  const school = rows[0];
  const settings = school.settings || {};
  const billing = settings.billing || {};

  const dailyLimit = Number(
    billing.dailyLimit !== undefined ? billing.dailyLimit : 0
  );
  let usedToday = 0;
  let blocked = false;
  let reason = null;

  if (dailyLimit > 0) {
    const { rows: usageRows } = await pool.query(
      `SELECT COUNT(*) AS cnt
       FROM submissions
       WHERE school_id = $1
         AND created_at::date = CURRENT_DATE`,
      [school.id]
    );
    usedToday = Number(usageRows[0].cnt || 0);
    blocked = usedToday >= dailyLimit;
    if (blocked) reason = "limit_exceeded";
  }

  return {
    ok: !blocked,
    blocked,
    reason,
    dailyLimit,
    usedToday,
    remainingToday:
      dailyLimit > 0 ? Math.max(0, dailyLimit - usedToday) : null,
  };
}

// GET /api/embed-check?schoolId=1
app.get("/api/embed-check", async (req, res) => {
  try {
    const status = await getSchoolBillingStatus(req.query.schoolId);
    if (status.ok === false && !("blocked" in status)) {
      // invalid_school_id or school_not_found
      return res.status(400).json(status);
    }
    res.json(status);
  } catch (err) {
    console.error("GET /api/embed-check error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /api/embed-event  (log embed blocked/errors, etc.)
app.post("/api/embed-event", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("📘 embed-event:", body);
    // Later: insert into a table embed_events(school_id, type, message, created_at)
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/embed-event error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ---------- SCHOOL SIGNUP API ----------

app.post("/api/signup", async (req, res) => {
  const body = req.body || {};
  const schoolName = (body.schoolName || "").trim();
  const schoolWebsite = (body.schoolWebsite || "").trim();
  const adminName = (body.adminName || "").trim();
  const adminEmail = (body.adminEmail || "").trim();
  const adminPassword = (body.adminPassword || "").trim();

  if (!schoolName || !adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({
      ok: false,
      error: "missing_required_fields",
      message: "School name, admin name, email and password are required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const baseSlug = slugifySchoolName(schoolName);
    const slug = await getUniqueSlug(client, baseSlug);

    // Load default widget config/form for new school
    const { config, form } = await loadDefaultWidgetConfigAndForm();

    const settings = {
      widgetConfig: config,
      widgetForm: form,
      billing: {
        dailyLimit: 50, // sensible default for demos; adjust later
        notifyOnLimit: true,
        emailOnLimit: adminEmail,
        autoBlockOnLimit: true,
      },
    };

    const schoolRes = await client.query(
      `INSERT INTO schools (slug, name, branding, settings)
       VALUES ($1, $2, '{}'::jsonb, $3::jsonb)
       RETURNING id`,
      [slug, schoolName, settings]
    );
    const schoolId = schoolRes.rows[0].id;

    // For now, store password as clear text / simple hash.
    // Later you can swap to bcrypt.
    const passwordHash = adminPassword; // TODO: hash

    await client.query(
      `INSERT INTO admins
         (school_id, email, full_name, password_hash, is_owner, is_active)
       VALUES ($1, $2, $3, $4, true, true)`,
      [schoolId, adminEmail, adminName, passwordHash]
    );

    // Optional: store website in branding/settings for later use
    if (schoolWebsite) {
      await client.query(
        `UPDATE schools
         SET branding = jsonb_set(
               COALESCE(branding, '{}'::jsonb),
               '{website}', to_jsonb($2::text), true
             )
         WHERE id = $1`,
        [schoolId, schoolWebsite]
      );
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      schoolId,
      slug,
    });
  } catch (err) {
    console.error("POST /api/signup error:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res
      .status(500)
      .json({ ok: false, error: "signup_failed", message: "Server error." });
  } finally {
    client.release();
  }
});

// Serve signup page explicitly
app.get("/signup", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "signup", "index.html"));
});

// Serve admin login page explicitly
app.get("/admin-login", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "admin-login", "index.html"));
});

// ---------- ADMIN LOGIN API ----------
app.post("/api/login", async (req, res) => {
  const body = req.body || {};
  const email = (body.email || "").trim();
  const password = (body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      error: "missing_credentials",
      message: "Email and password are required."
    });
  }

  try {
    const { rows, rowCount } = await pool.query(
      `
      SELECT
        a.id AS admin_id,
        a.full_name,
        a.email,
        a.password_hash,
        a.is_active,
        s.id AS school_id,
        s.slug
      FROM admins a
      JOIN schools s ON s.id = a.school_id
      WHERE a.email = $1
      LIMIT 1
      `,
      [email]
    );

    if (!rowCount) {
      return res.status(401).json({
        ok: false,
        error: "invalid_login",
        message: "Invalid email or password."
      });
    }

    const admin = rows[0];

    if (admin.is_active === false) {
      return res.status(403).json({
        ok: false,
        error: "admin_inactive",
        message: "This admin account is inactive."
      });
    }

    // For now, simple plain-text comparison (since we store plain text)
    if (admin.password_hash !== password) {
      return res.status(401).json({
        ok: false,
        error: "invalid_login",
        message: "Invalid email or password."
      });
    }

    // 🚨 NOTE: for production you’d issue a session/JWT here.
    // For now we just return the slug and let the frontend redirect.
    return res.json({
      ok: true,
      adminId: admin.admin_id,
      schoolId: admin.school_id,
      slug: admin.slug,
      name: admin.full_name
    });
  } catch (err) {
    console.error("POST /api/login error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Could not log in. Please try again."
    });
  }
});

/* ---------- start ---------- */
app.listen(PORT, () => {
  console.log(`✅ MSS Widget service listening on port ${PORT}`);
});