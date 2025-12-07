// server.js — ESM version for "type": "module" (Nov 25 update for Vercel)



import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import * as fsSync from "fs";
import pkg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import multer from "multer";
import crypto from "crypto";

dotenv.config();

// ---------------------------------------------------------------------
// Public base URL for email links - Nov 29
// ---------------------------------------------------------------------
function getPublicBaseUrl() {
  // Best practice: set this explicitly in Render/Vercel
  // e.g., PUBLIC_BASE_URL=https://mss-widget-mt.vercel.app
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  }

  // On Vercel: VERCEL_URL gives "<project>.vercel.app"
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  }

  // Local development fallback
  return "http://localhost:3000";
}

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);



// --- Widget image uploads ---
const uploadDir = path.join(__dirname, "uploads", "widget-images");

// ----- Core app / paths -----

const PORT = process.env.PORT || 3000;

const app = express();


// --- Email (Nodemailer) setup ------ Nov 29 //

import nodemailer from "nodemailer";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure =
  process.env.SMTP_SECURE === "true" || smtpPort === 465;

const mailTransporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});


const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = path.join(ROOT, "public");
const THEMES_DIR = path.join(ROOT, "themes");

// ---------- CORS MIDDLEWARE (Render ↔ Vercel) ----------
const allowedOrigins = [
  "https://mss-widget-mt.vercel.app",   // Vercel front-end
  "https://mss-widget-mt.onrender.com", // direct API calls (if any)
  "http://localhost:3000",              // local dev (Next/Vite/etc.)
  "http://localhost:5173",
];
//Dec 6
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn("🚫 CORS blocked origin:", origin);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "ADMIN-KEY",
    "X-ADMIN-KEY",      // ✅ add this
    "API-KEY",
    "API-SECRET",
  ],
};

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

// Body parsers (single source of truth)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(PUBLIC_DIR));
app.use("/themes", express.static(path.join(PUBLIC_DIR, "themes")));
app.use("/themes", express.static(THEMES_DIR));

// ----- Postgres pool -----

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

fsSync.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const slug = (req.params.slug || "widget").replace(/[^a-zA-Z0-9_-]/g, "_");
    const ext = path.extname(file.originalname) || ".png";
    const ts = Date.now();
    cb(null, `${slug}-${ts}${ext}`);
  },
});


const imageUpload = multer({ storage });

// === Nov 28 image upload patch ====

function handleWidgetImageUpload(req, res) {
  try {
    const { slug } = req.params;

    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: "NO_FILE", message: "No image uploaded" });
    }

    // File path: <root>/uploads/widget-images/<slug>-<timestamp>.<ext>
    const filename = req.file.filename;
    const url = `/uploads/widget-images/${filename}`;

    console.log("[ImageUpload] Stored widget image for slug", slug, {
      path: req.file.path,
      url,
    });

    return res.json({ ok: true, url });
  } catch (err) {
    console.error("Image upload handler error:", err);
    return res.status(500).json({
      ok: false,
      error: "UPLOAD_FAILED",
      message: err.message || "Image upload failed",
    });
  }
}

// ======================================================
// Image upload routes — support both `/image-upload` and legacy `/image` Nov 28
// ======================================================

// New canonical route
app.post(
  "/api/admin/widget/:slug/image-upload",
  imageUpload.single("image"),
  handleWidgetImageUpload
);

// Legacy route (ConfigAdmin still calling `/image`)
app.post(
  "/api/admin/widget/:slug/image",
  imageUpload.single("image"),
  handleWidgetImageUpload
);

// Branding logo route – alias used by older ImageViewer / ConfigAdmin Dev 7
// POST /api/admin/branding/:slug/logo  (field name: "image")
app.post(
  "/api/admin/branding/:slug/logo",
  imageUpload.single("image"),
  handleWidgetImageUpload
);

// === ADMIN: list available widgets (public/widgets/*.html) ============
app.get("/api/admin/widgets", async (req, res) => {
  try {
    const widgetsDir = path.join(PUBLIC_DIR, "widgets");

    // fs is fs/promises, so we await it
    const files = await fs.readdir(widgetsDir);

    const htmlFiles = files.filter((f) =>
      f.toLowerCase().endsWith(".html")
    );

    // Return simple list of filenames – ConfigAdmin.js expects { widgets: [...] }
    res.json({ widgets: htmlFiles });
  } catch (err) {
    console.error("Error reading widgets dir:", err);
    res.json({ widgets: [] });
  }
});

// Helper: normalize transcript text into a clean single-line string


// ---------------------------------------------------------------------
// Helper: cleanTranscriptText
//  - accepts whatever MSS sends (string or object)
//  - strips HTML tags/span styling
//  - decodes basic HTML entities
//  - normalizes whitespace
// ---------------------------------------------------------------------
function cleanTranscriptText(raw) {
  if (!raw) return null;

  // If MSS ever sends an object, prefer text/raw fields
  if (typeof raw === "object") {
    if (raw.text) raw = raw.text;
    else if (raw.raw) raw = raw.raw;
    else raw = JSON.stringify(raw);
  }

  let s = String(raw);

  // Normalize common HTML line breaks to spaces/newlines *before* stripping
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "");

  // Strip specific noisy spans/divs, then any remaining tags
  s = s
    .replace(/<\/?span[^>]*>/gi, "")
    .replace(/<\/?div[^>]*>/gi, "")
    .replace(/<[^>]+>/g, ""); // any remaining tags

  // Decode numeric entities like &#201; → É
  s = s.replace(/&#(\d+);/g, (match, num) => {
    const code = parseInt(num, 10);
    if (!Number.isFinite(code)) return match;
    try {
      return String.fromCharCode(code);
    } catch {
      return match;
    }
  });

  // Decode a few common named entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s || null;
}
// ---------------------------------------------------------------------------
// /api/widget/submit
// Unified submit handler
//  - Supports both audio-first and placeholder-first flows
//  - Uses createOrReuseSubmissionPlaceholder() for early ID assignment
//  - Writes final MSS results into submissions table
// ---------------------------------------------------------------------------
// we may use this later
//import { createOrReuseSubmissionPlaceholder } from "./utils/submissionPlaceholder.js";

//Dec 3 (patched Dec 5)
// /api/widget/submit
// - Accepts either:
//    a) JSON payload with MSS/Vox results (submission.mss/meta/results)
//    b) Fallback form/JSON without results (we log a minimal row, scores null)
app.post("/api/widget/submit", async (req, res) => {
  console.log("🎧 /api/widget/submit");

  try {
    // ------------------------------------------------------------
    // 0) Normalise incoming payload shape
    //    - If MSS posts { submission: {...} }, use that
    //    - If widget posts plain body / FormData fields, use req.body
    // ------------------------------------------------------------
    let payload = req.body?.submission || req.body || {};

    // If someone sent a raw JSON string, try to parse
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (err) {
        console.warn("⚠️ submit payload JSON parse failed, using raw body");
        payload = {};
      }
    }

    const slugFromBody  = typeof payload.slug === "string" ? payload.slug.trim() : "";
    const slugFromQuery = typeof req.query?.slug === "string" ? req.query.slug.trim() : "";
    const slug = slugFromBody || slugFromQuery;

    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "missing_slug",
        message: "slug is required",
      });
    }

    // ------------------------------------------------------------
    // 1) Resolve school (so we get school_id + settings)
    // ------------------------------------------------------------
    const schoolRes = await pool.query(
      `SELECT id, settings
         FROM schools
        WHERE slug = $1
        LIMIT 1`,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "school_not_found",
        message: `No school found for slug ${slug}`,
      });
    }

    const school       = schoolRes.rows[0];
    const schoolId     = school.id;
    const settings     = school.settings || {};
    const schoolConfig = settings.config || settings.widgetConfig || {};

    // ------------------------------------------------------------
    // 2) Extract widget-side metadata (all optional)
    // ------------------------------------------------------------
    const studentId =
      payload.studentId ??
      payload.student_id ??
      null;

    const questionTxt =
      payload.question ??
      payload.questionText ??
      payload.prompt ??
      null;

    const questionId =
      payload.question_id ??
      payload.questionId ??
      null;

    const help_level =
      payload.help_level ??
      payload.helpLevel ??
      null;

    const help_surface =
      payload.help_surface ??
      payload.helpSurface ??
      null;

    const widget_variant =
      payload.widget_variant ??
      payload.widgetVariant ??
      null;

    const dashboard_variant =
      payload.dashboard_variant ??
      payload.dashboardVariant ??
      null;

    // ------------------------------------------------------------
    // 3) MSS / Vox results (now OPTIONAL)
    // ------------------------------------------------------------
    let mss =
      payload.mss ??
      payload.meta ??
      payload.results ??
      null;

    // Allow mss to be JSON string
    if (typeof mss === "string") {
      try {
        mss = JSON.parse(mss);
      } catch (err) {
        console.warn("⚠️ MSS parse error:", err);
      }
    }

    if (!mss) {
      console.log("🟦 No MSS results in payload – inserting submission with null scores.");
    }

    // Initialise all scoring-related fields to null
    let voxScore         = null;
    let transcriptRaw    = null;
    let transcriptClean  = null;

    let mss_fluency      = null;
    let mss_grammar      = null;
    let mss_pron         = null;
    let mss_vocab        = null;
    let mss_cefr         = null;
    let mss_toefl        = null;
    let mss_ielts        = null;
    let mss_pte          = null;

    // If we DO have MSS/Vox blob, derive values as before
    if (mss && typeof mss === "object") {
      voxScore =
        (typeof mss.score === "number" ? mss.score : null) ??
        (typeof mss.overall_score === "number" ? mss.overall_score : null) ??
        (typeof mss.overall?.score === "number" ? mss.overall.score : null) ??
        null;

      transcriptRaw =
        mss.transcript ??
        payload.transcript ??
        null;

      transcriptClean = cleanTranscriptText(transcriptRaw);

      const elsa   = mss.elsa_results || mss.elsa || {};
      const scores = mss.scores || mss.details || {};

      mss_fluency =
        elsa.fluency ??
        scores.fluency ??
        null;

      mss_grammar =
        elsa.grammar ??
        scores.grammar ??
        null;

      mss_pron =
        elsa.pronunciation ??
        scores.pronunciation ??
        null;

      mss_vocab =
        elsa.vocabulary ??
        scores.vocabulary ??
        null;

      mss_cefr =
        elsa.cefr_level ??
        mss.cefr ??
        mss.cefr_level ??
        scores.cefr ??
        scores.cefr_level ??
        null;

      mss_toefl = elsa.toefl_score ?? scores.toefl ?? null;
      mss_ielts = elsa.ielts_score ?? scores.ielts ?? null;
      mss_pte   = elsa.pte_score   ?? scores.pte   ?? null;
    }

    // Legacy mirrors – fine if all null
    const toefl = mss_toefl;
    const ielts = mss_ielts;
    const pte   = mss_pte;
    const cefr  = mss_cefr;

    const meta = mss || null; // raw MSS blob (or null if none)

    // ------------------------------------------------------------
    // 4) INSERT submission row (⚠️ no slug column)
    // ------------------------------------------------------------
    const insertSql = `
      INSERT INTO submissions (
        school_id,
        question,
        student_id,
        toefl,
        ielts,
        pte,
        cefr,
        transcript,
        meta,
        mss_overall,
        mss_fluency,
        mss_grammar,
        mss_pron,
        mss_vocab,
        mss_cefr,
        mss_toefl,
        mss_ielts,
        mss_pte,
        vox_score,
        transcript_clean,
        help_level,
        help_surface,
        widget_variant,
        dashboard_variant,
        question_id
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
      )
      RETURNING id
    `;

    const insertParams = [
      schoolId,
      questionTxt,
      studentId,
      toefl,
      ielts,
      pte,
      cefr,
      transcriptRaw,
      meta,
      null,          // mss_overall not used yet
      mss_fluency,
      mss_grammar,
      mss_pron,
      mss_vocab,
      mss_cefr,
      mss_toefl,
      mss_ielts,
      mss_pte,
      voxScore,
      transcriptClean,
      help_level,
      help_surface,
      widget_variant,
      dashboard_variant,
      questionId
    ];

    const insertRes    = await pool.query(insertSql, insertParams);
    const submissionId = insertRes.rows[0].id;

    // ------------------------------------------------------------
    // 5) Build dashboard URL
    // ------------------------------------------------------------
    let dashboardPath =
      schoolConfig.dashboardPath ||
      schoolConfig.dashboardUrl ||
      "/dashboards/Dashboard3.html";

    if (!dashboardPath.startsWith("/")) {
      dashboardPath = `/dashboards/${dashboardPath.replace(/^\/+/, "")}`;
    }

    const dashboardUrl = `${dashboardPath}?slug=${encodeURIComponent(
      slug
    )}&submissionId=${submissionId}`;

    console.log("✨ Submission created:", {
      submissionId,
      dashboardUrl
    });

    return res.json({
      ok: true,
      submissionId,
      dashboardUrl
    });

  } catch (err) {
    console.error("❌ /api/widget/submit fatal:", err);
    return res.status(500).json({
      ok: false,
      error: "submit_failed",
      message: err.message || "Internal error"
    });
  }
});
/* ---------------------------------------------------------------
   Reports endpoint for School Portal (uses vw_widget_reports)
   --------------------------------------------------------------- */
app.get("/api/admin/reports/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    const limit = Number(req.query.limit || 500);

    const sql = `
      SELECT *
      FROM vw_widget_reports
      WHERE school_slug = $1
      ORDER BY submitted_at DESC
      LIMIT $2
    `;

    const result = await pool.query(sql, [slug, limit]);

    return res.json({
      ok: true,
      tests: result.rows
    });

  } catch (err) {
    console.error("❌ /api/admin/reports error:", err);
    return res.status(500).json({
      ok: false,
      error: "reports_failed",
      message: err.message
    });
  }
});
/* ------------------------------------------------------------------
   DEV: simple log endpoint for widget events
   ------------------------------------------------------------------ */
app.post("/api/widget/log", (req, res) => {
  try {
    console.log("📝 widget log event:", req.body || {});
  } catch (e) {
    console.error("log parse error:", e);
  }
  res.json({ ok: true });
});

// ---------- QUESTIONS SCHEMA HELPER ----------

let questionsSchemaCache = null;

async function getQuestionsSchema() {
  if (questionsSchemaCache) return questionsSchemaCache;

  const { rows } = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'questions'
    `
  );

  const cols = rows.map((r) => r.column_name);

  const assessmentCol = cols.includes("assessment_id")
    ? "assessment_id"
    : cols.includes("assessmentid")
    ? "assessmentid"
    : null;

  const schoolCol = cols.includes("school_id") ? "school_id" : null;

  const questionCol = cols.includes("question")
    ? "question"
    : cols.includes("question_text")
    ? "question_text"
    : cols.includes("prompt")
    ? "prompt"
    : null;

  const orderCol = cols.includes("position")
    ? "position"
    : cols.includes("sort_order")
    ? "sort_order"
    : null;

  if (!assessmentCol || !questionCol) {
    throw new Error(
      `Unsupported questions schema: assessmentCol=${assessmentCol}, questionCol=${questionCol}`
    );
  }

  questionsSchemaCache = {
    cols,
    assessmentCol,
    schoolCol,
    questionCol,
    orderCol,
  };

  console.log("✅ questions schema:", questionsSchemaCache);
  return questionsSchemaCache;
}

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

// ---------- SCHOOL SIGNUP (email verification) Nov 29 ---------- //
// POST /api/school-signup
// Body: fields from SchoolSignUp.html
app.post("/api/school-signup", async (req, res) => {
  const body = req.body || {};

  // Map from form field names
  const schoolName        = (body.schoolName || "").trim();
  const websiteUrl        = (body.websiteUrl || "").trim();
  const country           = (body.country || "").trim();
  const timeZone          = (body.timeZone || "").trim();
  const contactName       = (body.contactName || "").trim();
  const contactEmail      = (body.contactEmail || "").trim().toLowerCase();
  const roleTitle         = (body.roleTitle || "").trim();
  const teacherCountRaw   = body.teacherCount;
  const heard             = (body.heard || "").trim();
  const programDescription = (body.programDescription || "").trim();
  const exams             = body.exams || body["exams[]"] || []; // checkbox array
  const testsPerMonthRaw  = body.testsPerMonth;
  const anonymousFunnel   = (body.anonymousFunnel || "").toLowerCase() === "yes";
  const funnelUrl         = (body.funnelUrl || "").trim();
  const notes             = (body.notes || "").trim();

  // Basic validation
  if (!schoolName || !contactName || !contactEmail) {
    return res.status(400).json({
      ok: false,
      error: "missing_required_fields",
      message: "School name, contact name, and contact email are required.",
    });
  }

  const teacherCount = teacherCountRaw ? Number(teacherCountRaw) : null;
  const testsPerMonth = testsPerMonthRaw ? Number(testsPerMonthRaw) : null;

  // Build payload we’ll store for later
  const payload = {
    schoolName,
    websiteUrl,
    country,
    timeZone,
    contactName,
    contactEmail,
    roleTitle,
    teacherCount,
    heard,
    programDescription,
    exams,
    testsPerMonth,
    anonymousFunnel,
    funnelUrl,
    notes,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create token + store pending signup
    const token = generateSignupToken();

    await client.query(
      `
        INSERT INTO pending_signups (
          admin_email,
          admin_name,
          school_name,
          token,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
      `,
      [contactEmail, contactName, schoolName, token, JSON.stringify(payload)]
    );

    await client.query("COMMIT");

    // Build verification URL using your helper + env
    const baseUrl = getPublicBaseUrl();
    const verifyUrl = `${baseUrl}/signup/verify?token=${encodeURIComponent(
      token
    )}`;

    // Send verification email
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn("⚠️ SMTP not configured; skipping verification email.");
    } else {
      try {
        await mailTransporter.sendMail({
          from: '"MySpeakingScore" <chris@myspeakingscore.com>',
          to: contactEmail,
          subject: "Confirm your MySpeakingScore school sign-up",
          text: `
Hi ${contactName || "there"},

We received a request to set up a MySpeakingScore school portal for:

  ${schoolName}

To confirm that this request is really from you, please click this link:

  ${verifyUrl}

If you did not request this, you can safely ignore this email.

— MySpeakingScore
          `.trim(),
          html: `
            <p>Hi ${contactName || "there"},</p>
            <p>
              We received a request to set up a <strong>MySpeakingScore school portal</strong> for:
            </p>
            <p><strong>${schoolName}</strong></p>
            <p>
              To confirm that this request is really from you, please click the button below:
            </p>
            <p>
              <a href="${verifyUrl}"
                 style="display:inline-block;padding:10px 18px;border-radius:999px;
                        background:#1d4ed8;color:#ffffff;text-decoration:none;
                        font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                Confirm my email
              </a>
            </p>
            <p style="font-size:13px;color:#6b7280;">
              Or copy and paste this URL into your browser:<br />
              <span style="word-break:break-all;">${verifyUrl}</span>
            </p>
            <p style="font-size:13px;color:#6b7280;">
              If you did not request this, you can safely ignore this email.
            </p>
            <p>— MySpeakingScore</p>
          `,
        });
      } catch (err) {
        console.error("❌ Failed to send signup verification email:", err);
        // We still return ok:true because the signup is stored;
        // worst case you can resend manually or add a "resend" flow later.
      }
    }

    return res.json({
      ok: true,
      message: "Signup received. Please check your email to confirm.",
    });
  } catch (err) {
    console.error("POST /api/school-signup error:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({
      ok: false,
      error: "signup_failed",
      message: "Server error while creating pending signup.",
    });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// VERIFY SCHOOL SIGN-UP
// POST /api/school-signup/verify { token }
//  - looks up pending_signups
//  - creates school + admin + default config
//  - marks token as used
// ---------------------------------------------------------------------
app.post("/api/school-signup/verify", async (req, res) => {
  const body = req.body || {};
  const token = (body.token || "").trim();

  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "missing_token",
      message: "Verification token is required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows, rowCount } = await client.query(
      `
        SELECT id, payload, created_at, expires_at, used_at
        FROM pending_signups
        WHERE token = $1
        LIMIT 1
      `,
      [token]
    );

    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "invalid_token",
        message: "This verification link is not valid.",
      });
    }

    const row = rows[0];

    if (row.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "already_used",
        message: "This verification link has already been used.",
      });
    }

    if (new Date(row.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "expired",
        message: "This verification link has expired.",
      });
    }

    const payload = row.payload || {};
    const schoolName   = (payload.schoolName || "").trim();
    const schoolSite   = (payload.websiteUrl || "").trim();
    const adminName    = (payload.contactName || "").trim();
    const adminEmail   = (payload.contactEmail || "").trim();
    const adminPassword = (payload.adminPassword || "").trim(); // TODO: hash later

    if (!schoolName || !adminName || !adminEmail || !adminPassword) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "incomplete_payload",
        message: "Signup record is missing required fields.",
      });
    }

    // Create unique slug
    const baseSlug = slugifySchoolName(schoolName);
    const slug = await getUniqueSlug(client, baseSlug);

    // Load default widget config + form
    const { config, form } = await loadDefaultWidgetConfigAndForm();

    const settings = {
      widgetConfig: config,
      widgetForm: form,
      billing: {
        dailyLimit: 50,
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

    // NEW: clone default assessment + questions + help from mss-demo
    await cloneDefaultsFromDemoSchool(client, schoolId);

    const passwordHash = adminPassword || ""; // placeholder for now

    await client.query(
      `
        INSERT INTO admins
          (school_id, email, full_name, password_hash, is_owner, is_active)
        VALUES ($1, $2, $3, $4, true, true)
      `,
      [schoolId, adminEmail, adminName, passwordHash]
    );

    if (schoolSite) {
      await client.query(
        `
          UPDATE schools
          SET branding = jsonb_set(
                COALESCE(branding, '{}'::jsonb),
                '{website}',
                to_jsonb($2::text),
                true
              )
          WHERE id = $1
        `,
        [schoolId, schoolSite]
      );
    }

    await client.query(
      `UPDATE pending_signups SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      slug,
      schoolId,
      schoolName,
      adminName,
      adminEmail,
    });
  } catch (err) {
    console.error("POST /api/school-signup/verify error:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({
      ok: false,
      error: "verify_failed",
      message: "Server error while completing sign-up.",
    });
  } finally {
    client.release();
  }
});

// --- Serve the email-verification page Nov 29 --- //
app.get("/signup/verify", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "signup", "VerifySignup.html"));
});

// Create a new admin for a school
// POST /api/admin/school/:slug/admins Nov 30
// Body: { fullName, email, password, isOwner?, isSuperAdmin? }
app.post("/api/admin/school/:slug/admins", async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { slug } = req.params;
  const body = req.body || {};

  const fullName = (body.fullName || body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = (body.password || "").trim();

  const isOwner = !!body.isOwner;
  const isSuperAdmin = !!body.isSuperAdmin;

  if (!fullName || !email || !password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "fullName, email, and password are required.",
    });
  }

  try {
    const schoolRes = await pool.query(
  `SELECT id, settings, api
     FROM schools
    WHERE slug = $1
    LIMIT 1`,
  [slug]
);
    if (!schoolRes.rowCount) {
      return res.status(404).json({ ok: false, error: "school_not_found" });
    }
    const schoolId = schoolRes.rows[0].id;

    // NOTE: still plain text, to match existing login behaviour
    const passwordHash = password;

    const { rows } = await pool.query(
      `
      INSERT INTO admins (
        school_id,
        email,
        full_name,
        password_hash,
        is_owner,
        is_active,
        is_superadmin
      )
      VALUES ($1, $2, $3, $4, $5, true, $6)
      RETURNING id, full_name, email, is_owner, is_active, is_superadmin
      `,
      [schoolId, email, fullName, passwordHash, isOwner, isSuperAdmin]
    );

    const a = rows[0];

    return res.json({
      ok: true,
      admin: {
        adminId: a.id,
        fullName: a.full_name,
        email: a.email,
        isOwner: !!a.is_owner,
        isActive: a.is_active !== false,
        isSuperAdmin: !!a.is_superadmin,
      },
    });
  } catch (err) {
    console.error("POST /api/admin/school/:slug/admins error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// List admins for a given school (by slug) Nov 30 //
// GET /api/admin/school/:slug/admins
app.get("/api/admin/school/:slug/admins", async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { slug } = req.params;

  try {
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (!schoolRes.rowCount) {
      return res.status(404).json({ ok: false, error: "school_not_found" });
    }
    const schoolId = schoolRes.rows[0].id;

    const { rows } = await pool.query(
      `
      SELECT
        id,
        full_name,
        email,
        is_owner,
        is_active,
        is_superadmin
      FROM admins
      WHERE school_id = $1
      ORDER BY id ASC
      `,
      [schoolId]
    );

    return res.json({
      ok: true,
      schoolId,
      admins: rows.map(r => ({
        adminId: r.id,
        fullName: r.full_name,
        email: r.email,
        isOwner: !!r.is_owner,
        isActive: r.is_active !== false,
        isSuperAdmin: !!r.is_superadmin,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/school/:slug/admins error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// DASHBOARD SUBMISSIONS
// Returns recent submissions or a specific submission by ID
// ---------------------------------------------------------------------------
app.get("/api/dashboard/submissions", async (req, res) => {
  const slug = (req.query.slug || "").trim();
  const submissionId = req.query.submissionId
    ? Number(req.query.submissionId)
    : null;
  const limit = req.query.limit ? Number(req.query.limit) : 50;

  if (!slug) {
    return res.status(400).json({
      ok: false,
      error: "missing_slug",
      message: "Slug is required for dashboard submissions",
    });
  }

  console.log("📥 Dashboard request:", { slug, submissionId, limit });

  try {
    const sql = `
      SELECT *
      FROM vw_widget_reports
      WHERE school_slug = $1
      ORDER BY submitted_at DESC
      LIMIT $2
    `;

    const result = await pool.query(sql, [slug, limit]);
    const rows = result.rows || [];

    if (!rows.length) {
      return res.json({
        ok: true,
        rows: [],
        message: "No submissions found for this slug",
      });
    }

    // If a specific submissionId is requested, return that only
    if (submissionId && Number.isFinite(submissionId)) {
      const match = rows.find((r) => Number(r.id) === submissionId);
      if (match) {
        return res.json({ ok: true, rows: [match] });
      }
    }

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error("❌ Dashboard submissions error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Dashboard query failed.",
    });
  }
});

// ==== crypto token ==== Nov 29 //
function generateSignupToken() {
  // 64-char hex token, plenty of entropy
  return crypto.randomBytes(32).toString("hex");
}

/* ---------- QUESTION HELP DEFAULT PROMPT ---------- */

const DEFAULT_HELP_PROMPT = `
You are trying provide help for an English Student at the CEFR B1 level.
You want to provide the student with two levels of help:

1) A reading section that would be about 60 seconds in length if read at 80 WPM.
   The section will be read aloud by the student while recording the answer.

2) A point-by-point summary of the answer that the student will be able to
   look at before he or she records an answer.

Copy and paste this prompt into ChatGPT or your favourite AI app and then
copy-paste:
• the long answer into MaxHelp
• the point summary into MinHelp.
`.trim();



// ⬇️ all your routes AFTER this point
// app.get("/api/admin/widgets", ...)
// app.post("/api/widget/submit", ...)
// etc.

/* ---------- helpers (legacy JSON config helpers) ---------- */
async function ensureSrcDir() {
  try {
    await fs.mkdir(SRC_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

// List all dashboard HTML templates in /public/dashboards
app.get("/api/list-dashboards", async (req, res) => {
  try {
    const dashboardsDir = path.join(PUBLIC_DIR, "dashboards");
    const files = await fs.readdir(dashboardsDir);

    const dashboards = files
      .filter((name) => name.endsWith(".html"))
      .filter((name) => !name.startsWith("_"))
      .map((name) => name.replace(".html", ""));

    res.json({ dashboards });
  } catch (err) {
    console.error("Error listing dashboards:", err);
    res.status(500).json({ error: "Server error listing dashboards" });
  }
});

//=== Nov 30 ===//
async function addAdminForSchool(slug, fullName, email, password) {
  const res = await fetch(`/api/admin/school/${encodeURIComponent(slug)}/admins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ADMIN-KEY": MSS_ADMIN_WRITE_KEY,
    },
    body: JSON.stringify({ fullName, email, password }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.message || data.error || "Failed to add admin");
  }
  return data.admin;
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

// ---------- Helper: derive Vox score from row ----------
function deriveVoxScore(row) {
  // Prefer explicit numeric columns
  if (row.toefl != null) return Number(row.toefl);
  if (row.pte != null) return Number(row.pte);
  if (row.ielts != null) return Number(row.ielts);

  // Fallback: look into meta JSON for voxScore / vox_score / vox
  const meta = row.meta;
  if (!meta) return null;

  let m = meta;
  try {
    if (typeof meta === "string") {
      m = JSON.parse(meta);
    }
  } catch {
    // bad JSON – ignore
    return null;
  }

  const raw =
    m.voxScore !== undefined
      ? m.voxScore
      : m.vox_score !== undefined
      ? m.vox_score
      : m.vox !== undefined
      ? m.vox
      : null;

  if (raw == null || raw === "") return null;

  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
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

/* ---------- LEGACY FILE-BASED CONFIG ROUTES ---------- */
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


// List all dashboard HTML templates in /public/dashboards
app.get("/api/list-dashboards", async (req, res) => {
  try {
    const dashboardsDir = path.join(PUBLIC_DIR, "dashboards");
    const files = await fs.readdir(dashboardsDir);

    const dashboards = files
      .filter((name) => name.endsWith(".html"))
      .filter((name) => !name.startsWith("_")) // skip _template, etc
      .map((name) => name.replace(".html", ""));

    // Example: ["Dashboard1", "Dashboard2", "Dashboard3"]
    res.json({ dashboards });
  } catch (err) {
    console.error("Error listing dashboards:", err);
    res.status(500).json({ dashboards: [] });
  }
});

/* ------------------------------------------------------------------
   DB-BACKED WIDGET BOOTSTRAP (used by widget-core.js)
   GET /api/widget/:slug/bootstrap
   ------------------------------------------------------------------ */

// DB-backed widget bootstrap (used by Widget.html / WidgetMax.html)
app.get("/api/widget/:slug/bootstrap", async (req, res) => {
  const { slug } = req.params;

  try {
    // 1) School + settings + API jsonb
    const schoolRes = await pool.query(
      `SELECT id, settings, api
         FROM schools
        WHERE slug = $1
        LIMIT 1`,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res.status(404).json({ error: "School not found" });
    }

    const school   = schoolRes.rows[0];
    const settings = school.settings || {};

    // --- CONFIG: settings.config / settings.widgetConfig over defaultConfig
    const rawConfig =
      settings.config || settings.widgetConfig || {};

    const config = {
      ...defaultConfig,
      ...rawConfig,
    };

    // ---- MERGE API CONFIG FROM schools.api JSONB ----
    const dbApi = school.api || null;

    const mergedApi = {
      // sensible defaults
      enabled: true,
      baseUrl: "",
      key: "",
      secret: "",
      // anything already in config.api (e.g. from settings.config)
      ...(config.api || {}),
    };

    if (dbApi && typeof dbApi === "object") {
      if (dbApi.enabled !== undefined) mergedApi.enabled = !!dbApi.enabled;
      if (dbApi.baseUrl) mergedApi.baseUrl = dbApi.baseUrl;
      if (dbApi.key) mergedApi.key = dbApi.key;
      if (dbApi.secret) mergedApi.secret = dbApi.secret;
    }

    config.api = mergedApi;

    // --- FORM: settings.form / settings.widgetForm over defaultForm ---
    const rawForm =
      settings.form || settings.widgetForm || {};

    const form = {
      ...defaultForm,
      ...rawForm,
    };

    // 2) Default assessment for this school (create if missing)
    let assessmentId;
    const assessRes = await pool.query(
      `
        SELECT id
        FROM assessments
        WHERE school_id = $1
        ORDER BY id ASC
        LIMIT 1
      `,
      [school.id]
    );

    if (assessRes.rowCount) {
      assessmentId = assessRes.rows[0].id;
    } else {
      const insertRes = await pool.query(
        `
          INSERT INTO assessments (school_id, name)
          VALUES ($1, $2)
          RETURNING id
        `,
        [school.id, "Default Speaking Assessment"]
      );
      assessmentId = insertRes.rows[0].id;
    }

    // 3) Questions for that assessment
    const qRes = await pool.query(
      `
        SELECT
          id,
          question,
          COALESCE(position, sort_order, id) AS ord
        FROM questions
        WHERE assessment_id = $1
        ORDER BY ord ASC, id ASC
      `,
      [assessmentId]
    );

    const questions = qRes.rows.map((r) => ({
      id: r.id,
      question: r.question,
      slug: String(r.id),
    }));

    // 4) Image (unchanged)
    const uploadedImageUrl =
      settings.image && typeof settings.image.url === "string"
        ? settings.image.url
        : null;

    let imageUrl = uploadedImageUrl;

    if (!imageUrl) {
      const logoRes = await pool.query(
        `
          SELECT 1
          FROM school_assets a
          WHERE a.school_id = $1
            AND a.kind = 'widget-logo'
          LIMIT 1
        `,
        [school.id]
      );

      if (logoRes.rowCount > 0) {
        imageUrl = `/api/widget/${encodeURIComponent(
          slug
        )}/image/widget-logo`;
      }
    }

    // Helpful logging while we QA labels
    console.log("📦 /bootstrap for slug", slug, {
      api: config.api,
    });

    return res.json({
      ok: true,
      slug,
      schoolId: school.id,
      assessmentId,
      form,
      config,
      questions,
      imageUrl,
    });
  } catch (err) {
    console.error("Error in /api/widget/:slug/bootstrap", err);
    res.status(500).json({ error: "Server error" });
  }
});

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
    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.send(row.data);
  } catch (err) {
    console.error("Error in /api/widget/:slug/image/:kind", err);
    res.status(500).send("Server error");
  }
});

/* ---------- ASSESSMENTS / QUESTIONS FOR WIDGETSURVEY ---------- */

app.get("/api/assessments/:assessmentId/questions", async (req, res) => {
  const assessmentId = Number(req.params.assessmentId);
  if (!Number.isFinite(assessmentId)) {
    return res
      .status(400)
      .json({ questions: [], error: "Invalid assessmentId" });
  }

  try {
    const sql = `
      SELECT
        q.id,
        q.question,
        q.position AS sort_order,
        EXISTS (
          SELECT 1
          FROM questions_help h
          WHERE h.question_id = q.id
        ) AS has_help
      FROM questions q
      WHERE q.assessment_id = $1
      ORDER BY q.position, q.id
    `;

    const { rows } = await pool.query(sql, [assessmentId]);

    res.json({
      questions: rows.map((r) => ({
        id: r.id,
        question: r.question,
        sort_order: r.sort_order,
        hasHelp: r.has_help,
      })),
    });
  } catch (err) {
    console.error("GET /api/assessments/:assessmentId/questions failed", err);
    res.status(500).json({ questions: [], error: "Internal server error" });
  }
});

//==== Nov 28 Qs not saving bug =====//

app.put("/api/assessments/:assessmentId/questions", async (req, res) => {
  const assessmentId = Number(req.params.assessmentId);
  if (!Number.isFinite(assessmentId)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid assessmentId" });
  }

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!questions.length) {
    return res
      .status(400)
      .json({ success: false, error: "No questions provided" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get school for this assessment (needed for inserts)
    const assessRow = await client.query(
      `SELECT school_id FROM assessments WHERE id = $1`,
      [assessmentId]
    );
    if (!assessRow.rowCount) {
      throw new Error(`Assessment ${assessmentId} not found`);
    }
    const schoolId = assessRow.rows[0].school_id;

    // IDs coming in from client (existing questions only)
    // Normalize to numbers so includes() works with DB ids
    const incomingIds = questions
      .map((q) => (q.id != null ? Number(q.id) : null))
      .filter((id) => Number.isInteger(id));

    // 1) Update existing questions
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      if (!q.id) continue;

      const text = (q.question || "").toString().trim();
      const order = idx + 1;

      await client.query(
        `
        UPDATE questions
        SET position   = $1,
            sort_order = $1,
            question   = $2,
            updated_at = NOW()
        WHERE id = $3 AND assessment_id = $4
        `,
        [order, text, Number(q.id), assessmentId]
      );
    }

    // 2) Insert new questions (and add their ids to incomingIds)
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      if (q.id) continue; // already handled above

      const text = (q.question || "").toString().trim();
      if (!text) continue;

      const order = idx + 1;

      const insertRes = await client.query(
        `
        INSERT INTO questions (
          school_id,
          assessment_id,
          position,
          sort_order,
          question,
          is_active
        )
        VALUES ($1, $2, $3, $3, $4, TRUE)
        RETURNING id
        `,
        [schoolId, assessmentId, order, text]
      );

      const newId = insertRes.rows[0]?.id;
      if (Number.isInteger(newId)) {
        incomingIds.push(newId);
      }
    }

    // 3) Delete questions that are no longer present in the client list
    const existingRes = await client.query(
      `SELECT id FROM questions WHERE assessment_id = $1`,
      [assessmentId]
    );
    const existingIds = existingRes.rows
      .map((r) => Number(r.id))
      .filter((id) => Number.isInteger(id));

    const idsToDelete = existingIds.filter(
      (id) => !incomingIds.includes(id)
    );

    if (idsToDelete.length) {
      // First delete any help rows for those questions
      await client.query(
        `DELETE FROM questions_help WHERE question_id = ANY($1::int[])`,
        [idsToDelete]
      );

      // Then delete the questions themselves
      await client.query(
        `DELETE FROM questions WHERE id = ANY($1::int[]) AND assessment_id = $2`,
        [idsToDelete, assessmentId]
      );
    }

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PUT /api/assessments/:assessmentId/questions failed", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  } finally {
    client.release();
  }
});
/* ---------- ADMIN: ASSESSMENT FROM SLUG ---------- */

app.get("/api/admin/assessments/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE slug = $1`,
      [slug]
    );
    if (!schoolRes.rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }
    const schoolId = schoolRes.rows[0].id;

    const assessRes = await pool.query(
      `
        SELECT id, school_id, name
        FROM assessments
        WHERE school_id = $1
        ORDER BY id ASC
        LIMIT 1
      `,
      [schoolId]
    );

    let assessment;
    if (assessRes.rowCount) {
      assessment = assessRes.rows[0];
    } else {
      const insertRes = await pool.query(
        `
          INSERT INTO assessments (school_id, name)
          VALUES ($1, $2)
          RETURNING id, school_id, name
        `,
        [schoolId, "Default Speaking Assessment"]
      );
      assessment = insertRes.rows[0];
    }

    return res.json({
      ok: true,
      slug,
      schoolId,
      assessmentId: assessment.id,
      assessment,
    });
  } catch (err) {
    console.error("GET /api/admin/assessments/:slug error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// --- Test email endpoint ------ Nov 29 //
// GET /api/test-email
app.get("/api/test-email", async (req, res) => {
  try {
    if (!smtpHost || !smtpUser || !smtpPass) {
      return res.status(500).json({
        ok: false,
        error: "MISSING_SMTP_CONFIG",
        message: "SMTP env vars are not fully configured on this server.",
      });
    }

    const info = await mailTransporter.sendMail({
      from: '"MySpeakingScore" <chris@myspeakingscore.com>',  // sender
      to: "ChristopherHealy@outlook.com",                     // test recipient
      subject: "MSS Widget – Hello world email test",
      text: "Hello Chris! This is a test email from the MSS Widget MT server.",
      html: `
        <p>Hi Chris,</p>
        <p>This is a <strong>hello world</strong> test email from your MSS Widget MT server.</p>
        <p>If you see this in Outlook, SMTP is working. 🎉</p>
      `,
    });

    console.log("📧 Test email sent:", info.messageId);

    return res.json({
      ok: true,
      message: "Test email sent",
      messageId: info.messageId,
    });
  } catch (err) {
    console.error("❌ Test email failed:", err);
    return res.status(500).json({
      ok: false,
      error: "SEND_FAILED",
      message: err.message || "Failed to send test email.",
    });
  }
});

/* ---------- ADMIN: WIDGET DASHBOARD LIST ----------
   GET /api/admin/dashboards  -> { ok, dashboards: [ {file,url,label} ] }
--------------------------------------------------------------------- */

app.get("/api/admin/dashboards", async (req, res) => {
  const dashboardsDir = path.join(PUBLIC_DIR, "dashboards");

  try {
    const entries = await fs.readdir(dashboardsDir, { withFileTypes: true });

    const dashboards = entries
      .filter(
        (d) =>
          d.isFile() && d.name.toLowerCase().endsWith(".html")
      )
      .map((d) => {
        const file = d.name;
        const url = `/dashboards/${file}`;

        const base = file.replace(/\.html$/i, "");
        let label = base
          .replace(/^dashboard[-_]*/i, "") // strip leading "Dashboard"
          .replace(/[-_]+/g, " ")
          .trim();

        if (!label) label = "Dashboard";

        label = label.replace(/\b\w/g, (c) => c.toUpperCase());

        return { file, url, label };
      });

    res.json({ ok: true, dashboards });
  } catch (err) {
    if (err.code === "ENOENT") {
      // Folder not created yet – safe empty list
      return res.json({ ok: true, dashboards: [] });
    }
    console.error("Error reading dashboards dir:", err);
    res.status(500).json({ ok: false, error: "LIST_FAILED" });
  }
});

/* ---------- ADMIN: WIDGET CONFIG (config + form + image) ---------- */


// PUT full widget state from ConfigAdmin (config + form + image)
// PUT /api/admin/widget/:slug
// PUT full widget state from ConfigAdmin (config + form + image)
// PUT /api/admin/widget/:slug
app.put("/api/admin/widget/:slug", async (req, res) => {
  const { slug } = req.params;
  let { config = {}, form = {}, image = {} } = req.body || {};

  try {
    // Ensure plain objects
    config = config || {};
    form   = form   || {};
    image  = image  || {};

    // 🔹 Normalise widget/dashboard paths and keep both keys
    if (config.widgetUrl && !config.widgetPath) {
      config.widgetPath = config.widgetUrl;
    }
    if (config.widgetPath && !config.widgetUrl) {
      config.widgetUrl = config.widgetPath;
    }

    if (config.dashboardUrl && !config.dashboardPath) {
      config.dashboardPath = config.dashboardUrl;
    }
    if (config.dashboardPath && !config.dashboardUrl) {
      config.dashboardUrl = config.dashboardPath;
    }

    // 🔹 Normalise afterDashboard block (new)
    const after = config.afterDashboard || {};
    const signupUrl = (after.signupUrl || "").trim();
    const ctaMessage = (after.ctaMessage || "").trim();

    config.afterDashboard = {
      signupUrl,
      ctaMessage,
    };

    // 🔹 Stringify for jsonb parameters
    const jsonConfig = JSON.stringify(config);
    const jsonForm   = JSON.stringify(form);
    const jsonImage  = JSON.stringify(image);

    const { rows } = await pool.query(
      `
      UPDATE schools
         SET settings = jsonb_set(
                          jsonb_set(
                            jsonb_set(
                              COALESCE(settings, '{}'::jsonb),
                              '{config}', $1::jsonb, true
                            ),
                            '{form}',   $2::jsonb, true
                          ),
                          '{image}',    $3::jsonb, true
                        )
       WHERE slug = $4
       RETURNING settings
      `,
      [jsonConfig, jsonForm, jsonImage, slug]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    return res.json({ ok: true, settings: rows[0].settings });
  } catch (err) {
    console.error("PUT /api/admin/widget error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
// === FORM-ONLY endpoints used by WidgetSurvey =======================

// GET just the form JSON for this slug
// GET /api/admin/widget/:slug
app.get("/api/admin/widget/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, settings
         FROM schools
        WHERE slug = $1`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const row = rows[0];
    const settings = row.settings || {};
    const config = settings.config || {};
    const form = settings.form || {};
    const image = settings.image || {};

    // ---- NORMALISE URL/PATH KEYS ----
    const normalisedConfig = { ...config };

    const widgetPath =
      normalisedConfig.widgetPath ||
      normalisedConfig.widgetUrl ||
      "/widgets/Widget.html";

    const dashboardPath =
      normalisedConfig.dashboardPath ||
      normalisedConfig.dashboardUrl ||
      "/dashboards/Dashboard3.html";

    normalisedConfig.widgetPath = widgetPath;
    normalisedConfig.widgetUrl  = widgetPath;

    normalisedConfig.dashboardPath = dashboardPath;
    normalisedConfig.dashboardUrl  = dashboardPath;

    // ✅ Ensure afterDashboard shape is always present
    const after = normalisedConfig.afterDashboard || {};
    normalisedConfig.afterDashboard = {
      signupUrl:  after.signupUrl  || "",
      ctaMessage: after.ctaMessage || "",
    };

    return res.json({
      ok: true,
      school: {
        id: row.id,
        slug: row.slug,
        name: row.name || row.slug,
      },
      settings: {
        config: normalisedConfig,
        form,
        image,
      },
      config: normalisedConfig,
      form,
      image,
    });
  } catch (err) {
    console.error("GET /api/admin/widget error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
// PUT just the form JSON (WidgetSurvey writes here)
app.put("/api/admin/widget/:slug/form", async (req, res) => {
  if (!checkAdminKey(req, res)) return; // same behaviour as other admin writes

  const { slug } = req.params;
  const form = req.body || {};
  const jsonForm = JSON.stringify(form);

  try {
    const { rowCount } = await pool.query(
      `
      UPDATE schools
      SET settings = jsonb_set(
            COALESCE(settings, '{}'::jsonb),
            '{form}',
            $2::jsonb,
            true
          )
      WHERE slug = $1
      `,
      [slug, jsonForm]
    );

    if (!rowCount) {
      return res.status(404).json({ ok: false, error: "school_not_found" });
    }

    res.json({ ok: true, form });
  } catch (err) {
    console.error("PUT /api/admin/widget/:slug/form error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ---------- ADMIN: QUESTION HELP (GET / PUT) ---------- */

app.get("/api/admin/help/:slug/:questionId", async (req, res) => {
  const { slug, questionId } = req.params;
  const qid = Number(questionId);

  if (!Number.isInteger(qid) || qid <= 0) {
    return res
      .status(400)
      .json({ ok: false, error: "invalid_question_id" });
  }

  try {
    const schoolResult = await pool.query(
      `SELECT id FROM schools WHERE slug = $1`,
      [slug]
    );
    if (!schoolResult.rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }
    const schoolId = schoolResult.rows[0].id;

    const helpResult = await pool.query(
      `
        SELECT maxhelp, minhelp, prompt
        FROM questions_help
        WHERE school_id = $1 AND question_id = $2
        LIMIT 1
      `,
      [schoolId, qid]
    );

    if (helpResult.rowCount) {
      const row = helpResult.rows[0];
      return res.json({
        ok: true,
        slug,
        schoolId,
        questionId: qid,
        maxhelp: row.maxhelp || "",
        minhelp: row.minhelp || "",
        prompt: row.prompt || DEFAULT_HELP_PROMPT,
        exists: true,
      });
    }

    return res.json({
      ok: true,
      slug,
      schoolId,
      questionId: qid,
      maxhelp: "",
      minhelp: "",
      prompt: DEFAULT_HELP_PROMPT,
      exists: false,
    });
  } catch (err) {
    console.error("GET /api/admin/help/:slug/:questionId error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.put("/api/admin/help/:slug/:questionId", async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const { slug, questionId } = req.params;
  const qid = Number(questionId);

  if (!Number.isInteger(qid) || qid <= 0) {
    return res
      .status(400)
      .json({ ok: false, error: "invalid_question_id" });
  }

  const body = req.body || {};
  const maxhelp = (body.maxhelp || "").toString();
  const minhelp = (body.minhelp || "").toString();
  const prompt = (body.prompt || DEFAULT_HELP_PROMPT).toString();

  try {
    const schoolResult = await pool.query(
      `SELECT id FROM schools WHERE slug = $1`,
      [slug]
    );
    if (!schoolResult.rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }
    const schoolId = schoolResult.rows[0].id;

    const upsertResult = await pool.query(
      `
        INSERT INTO questions_help (school_id, question_id, maxhelp, minhelp, prompt)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (school_id, question_id)
        DO UPDATE SET
          maxhelp   = EXCLUDED.maxhelp,
          minhelp   = EXCLUDED.minhelp,
          prompt    = EXCLUDED.prompt,
          updated_at = NOW()
        RETURNING id, maxhelp, minhelp, prompt, created_at, updated_at
      `,
      [schoolId, qid, maxhelp, minhelp, prompt]
    );

    const record = upsertResult.rows[0];

    return res.json({
      ok: true,
      slug,
      schoolId,
      questionId: qid,
      help: record,
    });
  } catch (err) {
    console.error("PUT /api/admin/help/:slug/:questionId error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ---------------------------------------------------------------------------
// HELP: return min/max help text for a question
// POST /api/widget/help  { slug, questionId, level }
// ---------------------------------------------------------------------------
app.post("/api/widget/help", async (req, res) => {
  const { slug, questionId, level } = req.body || {};

  if (!slug || !questionId) {
    return res.status(400).json({
      ok: false,
      error: "MISSING_PARAMS",
      message: "slug and questionId are required",
    });
  }

  const qid = Number(questionId);
  if (!Number.isInteger(qid) || qid <= 0) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_QUESTION_ID",
      message: "questionId must be a positive integer",
    });
  }

  try {
    const schoolRes = await pool.query(
      `SELECT id FROM schools WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (!schoolRes.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "SCHOOL_NOT_FOUND",
      });
    }
    const schoolId = schoolRes.rows[0].id;

    const { rows } = await pool.query(
      `
        SELECT minhelp, maxhelp, prompt
        FROM questions_help
        WHERE school_id = $1 AND question_id = $2
        LIMIT 1
      `,
      [schoolId, qid]
    );

    if (!rows.length) {
      console.log("[HELP] No help rows for", { slug, schoolId, questionId: qid });
      return res.json({
        ok: true,
        exists: false,
        min: "",
        max: "",
        minhelp: "",
        maxhelp: "",
      });
    }

    const row = rows[0];
    const minhelp = row.minhelp || "";
    const maxhelp = row.maxhelp || "";

    console.log("[HELP] Found help row:", {
      slug,
      schoolId,
      questionId: qid,
      minLen: minhelp.length,
      maxLen: maxhelp.length,
    });

    return res.json({
      ok: true,
      exists: true,
      min: minhelp,
      max: maxhelp,
      minhelp,
      maxhelp,
    });
  } catch (err) {
    console.error("HELP endpoint error:", err);
    res.status(500).json({
      ok: false,
      error: "HELP_INTERNAL",
      message: err.message || "Server error",
    });
  }
});

// --- List schools for current admin (email OR adminId, superadmin-aware) Nov 30 ---//
app.get("/api/admin/my-schools", async (req, res) => {
  const emailRaw = (req.query.email || "").trim().toLowerCase();
  const adminIdRaw = req.query.adminId;

  try {
    if (!emailRaw && !adminIdRaw) {
      return res.status(400).json({
        ok: false,
        error: "missing_identifier",
        message: "email or adminId is required.",
      });
    }

    let adminRow = null;

    // Path A: look up by adminId (if provided)
    if (adminIdRaw) {
      const adminId = Number(adminIdRaw);
      if (Number.isInteger(adminId) && adminId > 0) {
        const { rows, rowCount } = await pool.query(
          `
          SELECT id,
                 full_name,
                 LOWER(email) AS email,
                 is_active,
                 is_superadmin
          FROM admins
          WHERE id = $1
          LIMIT 1
          `,
          [adminId]
        );

        if (rowCount && rows[0].is_active !== false) {
          adminRow = rows[0];
        }
      }
    }

    // Path B: if no usable adminRow yet, fall back to email
    if (!adminRow && emailRaw) {
      const { rows, rowCount } = await pool.query(
        `
        SELECT id,
               full_name,
               LOWER(email) AS email,
               is_active,
               is_superadmin
        FROM admins
        WHERE LOWER(email) = $1
          AND is_active IS NOT FALSE
        ORDER BY is_superadmin DESC, id ASC
        LIMIT 1
        `,
        [emailRaw]
      );

      if (rowCount) {
        adminRow = rows[0];
      }
    }

    if (!adminRow) {
      return res.status(404).json({
        ok: false,
        error: "admin_not_found",
        message: "No active admin account found.",
      });
    }

    const isSuperAdmin = !!adminRow.is_superadmin;

    // SUPERADMIN: see ALL schools
    if (isSuperAdmin) {
      const { rows } = await pool.query(
        `
        SELECT
          s.id   AS school_id,
          s.slug,
          s.name AS school_name
        FROM schools s
        ORDER BY s.id ASC
        `
      );

      return res.json({
        ok: true,
        isSuperAdmin: true,
        email: adminRow.email,
        adminId: adminRow.id,
        schools: rows.map((r) => ({
          adminId: null, // global view, not per-school admin row
          schoolId: r.school_id,
          slug: r.slug,
          name: r.school_name || r.slug,
        })),
      });
    }

    // NON-SUPERADMIN: show only schools explicitly linked to this admin/email
    const { rows } = await pool.query(
      `
      SELECT
        a.id   AS admin_id,
        s.id   AS school_id,
        s.slug,
        s.name AS school_name
      FROM admins a
      JOIN schools s ON s.id = a.school_id
      WHERE a.is_active IS NOT FALSE
        AND (a.id = $1 OR LOWER(a.email) = $2)
      ORDER BY s.id ASC
      `,
      [adminRow.id, adminRow.email]
    );

    return res.json({
      ok: true,
      isSuperAdmin: false,
      email: adminRow.email,
      adminId: adminRow.id,
      schools: rows.map((r) => ({
        adminId: r.admin_id,
        schoolId: r.school_id,
        slug: r.slug,
        name: r.school_name || r.slug,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/my-schools error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Failed to load schools for admin.",
    });
  }
});
// ---------- ADMIN LOGIN API (multi-school, hash-aware) Dec 4 ---------- //
// NOTE: requires pgcrypto extension in Postgres:
//   CREATE EXTENSION IF NOT EXISTS pgcrypto;

async function handleAdminLogin(req, res) {
  const body = req.body || {};
  const email = (body.email || "").trim().toLowerCase();
  const password = (body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      error: "missing_credentials",
      message: "Email and password are required.",
    });
  }

  try {
    // 1) Find active admin + verify password using crypt()
    const adminResult = await pool.query(
      `
      SELECT
        id,
        LOWER(email)   AS email,
        full_name      AS full_name,
        is_active,
        is_superadmin
      FROM admins
      WHERE LOWER(email) = $1
        AND is_active    = TRUE
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
      `,
      [email, password]
    );

    if (!adminResult.rowCount) {
      return res.status(401).json({
        ok: false,
        error: "invalid_login",
        message: "Invalid email or password.",
      });
    }

    const admin = adminResult.rows[0];
    const isSuperAdmin = !!admin.is_superadmin;

    // 2) Load schools this admin can see
    let schoolsResult;

    if (isSuperAdmin) {
      // Super admins see all schools
      schoolsResult = await pool.query(
        `
        SELECT id, slug, name
        FROM schools
        ORDER BY name
        `
      );
    } else {
      // Normal admins see schools from admin_schools mapping
      schoolsResult = await pool.query(
        `
        SELECT s.id, s.slug, s.name
        FROM admin_schools x
        JOIN schools s ON s.id = x.school_id
        WHERE x.admin_id = $1
        ORDER BY s.name
        `,
        [admin.id]
      );
    }

    const schools = (schoolsResult.rows || []).map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name || s.slug,
    }));

    if (!schools.length) {
      return res.status(403).json({
        ok: false,
        error: "no_active_schools",
        message: "Your admin account has no active schools.",
      });
    }

    // 3) Shape response for AdminLogin.js (which creates localStorage session)
    return res.json({
      ok: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.full_name,
        is_super_admin: isSuperAdmin, // AdminLogin.js is defensive about this flag name
      },
      schools,
    });
  } catch (err) {
    console.error("POST /api/admin/login error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Could not log in. Please try again.",
    });
  }
}

// Primary endpoint for the new AdminLogin.js
app.post("/api/admin/login", handleAdminLogin);

// Optional: keep old path for backward compatibility Dec 5
app.post("/api/login", handleAdminLogin);
/* ------------------------------------------------------------------
   STUDENT ENROLLMENT
   POST /api/student/enroll
   Body: { slug, submissionId, name?, full_name?, email }
   - Finds school by slug
   - Upserts student (students table, UNIQUE (school_id,email))
   - Links submission to student (submissions.student_id)
   - Enriches submissions.meta->student with basic info
   ------------------------------------------------------------------ */
app.post("/api/student/enroll", async (req, res) => {
  try {
    const body = req.body || {};

    const slug          = (body.slug || "").trim();
    const submissionRaw = body.submissionId ?? body.submission_id;
    const fullNameRaw   = body.full_name || body.name || "";
    const emailRaw      = body.email || "";

    const email = emailRaw.trim().toLowerCase();
    const fullName = fullNameRaw.trim();
    const submissionId = Number(submissionRaw);

    // --- Basic validation ----------------------------------------------------
    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "missing_slug",
        message: "slug is required",
      });
    }

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "invalid_submission_id",
        message: "submissionId must be a positive integer",
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "missing_email",
        message: "email is required",
      });
    }

    if (!fullName) {
      return res.status(400).json({
        ok: false,
        error: "missing_name",
        message: "full name is required",
      });
    }

    // --- 1) Look up school by slug ------------------------------------------
    const schoolRes = await pool.query(
      `SELECT id
         FROM schools
        WHERE slug = $1
        LIMIT 1`,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "school_not_found",
        message: `No school found for slug ${slug}`,
      });
    }

    const schoolId = schoolRes.rows[0].id;

    // --- 2) Upsert student in students table --------------------------------
    const studentRes = await pool.query(
      `
      INSERT INTO students (school_id, email, full_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (school_id, email)
      DO UPDATE SET
        full_name  = EXCLUDED.full_name,
        updated_at = NOW()
      RETURNING
        id,
        school_id,
        email,
        full_name,
        created_at,
        updated_at
      `,
      [schoolId, email, fullName]
    );

    const student = studentRes.rows[0];

    // --- 3) Link submission to this student ---------------------------------
    const submissionUpdateRes = await pool.query(
      `
      UPDATE submissions
         SET student_id = $3,
             updated_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                      'student',
                      jsonb_build_object(
                        'id',        $3,
                        'full_name', $4,
                        'email',     $5
                      )
                    )
       WHERE id = $2
         AND school_id = $1
       RETURNING id
      `,
      [schoolId, submissionId, student.id, student.full_name, student.email]
    );

    if (!submissionUpdateRes.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "submission_not_found",
        message:
          "Submission not found for this school. It may belong to a different slug or be missing.",
      });
    }

    const updatedSubmissionId = submissionUpdateRes.rows[0].id;

    // --- 4) Success ----------------------------------------------------------
    return res.json({
      ok: true,
      schoolId,
      submissionId: updatedSubmissionId,
      student: {
        id: student.id,
        email: student.email,
        full_name: student.full_name,
        created_at: student.created_at,
        updated_at: student.updated_at,
      },
    });
  } catch (err) {
    console.error("❌ POST /api/student/enroll error:", err);
    return res.status(500).json({
      ok: false,
      error: "enroll_failed",
      message: err.message || "Server error while enrolling student",
    });
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

app.post("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const headers = LOG_HEADERS;

    const rawIp =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "") + "";
    const ip = rawIp.split(",")[0].trim();
    body.ip = ip;

    const rowValues = headers.map((h) => body[h] ?? "");
    const line = rowValues.map(csvEscape).join(",") + "\n";

    let prefix = "";
    try {
      await fs.access(LOG_CSV);
    } catch {
      prefix = headers.join(",") + "\n";
    }
    await fs.appendFile(LOG_CSV, prefix + line, "utf8");

    // 👇 IMPORTANT CHANGE: no more DB insert here
    const dbOk = false;
    const dbError = "DB logging disabled (using /api/widget/submit instead)";

    res.json({ ok: true, dbOk, dbError });
  } catch (e) {
    console.error("POST /log/submission error:", e);
    res.status(500).json({ ok: false, error: "log failed" });
  }
});
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

    Object.entries(updates).forEach(([key, val]) => {
      if (headers.includes(key)) {
        rowObj[key] = val == null ? "" : String(val);
      }
    });

    const updatedCols = headers.map((h) => rowObj[h] ?? "");
    parsedRows[id] = updatedCols;

    const outLines = [
      headers.join(","),
      ...parsedRows.map((cols) => cols.map(csvEscape).join(",")),
    ];

    await fs.writeFile(LOG_CSV, outLines.join("\n") + "\n", "utf8");

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /log/submission error:", e);
    res.status(500).json({ ok: false, error: "failed to update log" });
  }
});

// --- Get unique slug helper --- Nov 30 //

async function getUniqueSlugGlobal(baseSlug) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const { rows } = await pool.query(
      `SELECT 1 FROM schools WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (!rows.length) return slug;
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

// Rename school + slug (for ConfigAdmin) Nov 30 --- //
// PUT /api/admin/school/:slug/rename
// Body: { newName }
app.put("/api/admin/school/:slug/rename", async (req, res) => {
  if (!checkAdminKey(req, res)) return; // same guard as other admin writes

  const currentSlug = req.params.slug;
  const newName = (req.body.newName || "").trim();

  if (!newName) {
    return res.status(400).json({
      ok: false,
      error: "missing_new_name",
      message: "New school name is required.",
    });
  }

  try {
    const baseSlug = slugifySchoolName(newName);
    const newSlug = await getUniqueSlugGlobal(baseSlug);

    const { rows, rowCount } = await pool.query(
      `
      UPDATE schools
      SET name = $1,
          slug = $2
      WHERE slug = $3
      RETURNING id, name, slug
      `,
      [newName, newSlug, currentSlug]
    );

    if (!rowCount) {
      return res.status(404).json({
        ok: false,
        error: "school_not_found",
      });
    }

    const s = rows[0];

    return res.json({
      ok: true,
      schoolId: s.id,
      name: s.name,
      slug: s.slug,
    });
  } catch (err) {
    console.error("PUT /api/admin/school/:slug/rename error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
    });
  }
});


// --- Super admin: list all schools (dual auth: ADMIN_WRITE_KEY or is_superadmin) Nov 30 --- //

app.get("/api/admin/all-schools", async (req, res) => {
  try {
    const adminIdRaw = req.query.adminId;
    let authorized = false;

    // Path A: superadmin via adminId (normal browser login flow)
    if (adminIdRaw) {
      const adminId = Number(adminIdRaw);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_admin_id",
          message: "adminId must be a positive integer.",
        });
      }

      const { rows, rowCount } = await pool.query(
        `
        SELECT is_superadmin, is_active
        FROM admins
        WHERE id = $1
        LIMIT 1
        `,
        [adminId]
      );

      if (!rowCount) {
        return res.status(403).json({
          ok: false,
          error: "admin_not_found",
        });
      }

      const admin = rows[0];
      if (admin.is_active === false || !admin.is_superadmin) {
        return res.status(403).json({
          ok: false,
          error: "not_superadmin",
          message: "Only superadmin accounts can list all schools.",
        });
      }

      authorized = true;
    }

    // Path B: server-side tools / scripts via ADMIN_WRITE_KEY header
    if (!authorized) {
      if (!checkAdminKey(req, res)) return; // this already sends 401 response
      authorized = true;
    }

    // At this point we’re authorized one way or the other
    const { rows } = await pool.query(
      `
      SELECT id, slug, name, created_at
      FROM schools
      ORDER BY created_at DESC, id DESC
      `
    );

    return res.json({
      ok: true,
      schools: rows.map((r) => ({
        schoolId: r.id,
        slug: r.slug,
        name: r.name || r.slug,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("GET /api/admin/all-schools error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
    });
  }
});

// ---------------------------------------------------------------------
// ADMIN PASSWORD RESET – REQUEST Nov 30
// POST /api/admin/password-reset/request  { email }
//  - We do NOT reveal whether the email exists
// ---------------------------------------------------------------------
app.post("/api/admin/password-reset/request", async (req, res) => {
  const body = req.body || {};
  const email = (body.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({
      ok: false,
      error: "missing_email",
      message: "Email is required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Find an active admin with this email
    const { rows, rowCount } = await client.query(
      `
      SELECT id, full_name, email
      FROM admins
      WHERE LOWER(email) = $1
        AND is_active IS NOT FALSE
      ORDER BY id ASC
      LIMIT 1
      `,
      [email]
    );

    if (!rowCount) {
      // Still behave as if we succeeded (no account enumeration)
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message:
          "If this email is registered, a reset link has been sent.",
      });
    }

    const admin = rows[0];
    const token = generateSignupToken();

    await client.query(
      `
      INSERT INTO admin_password_resets (
        admin_id, email, token, status
      )
      VALUES ($1, $2, $3, 'pending')
      `,
      [admin.id, admin.email.toLowerCase(), token]
    );

    await client.query("COMMIT");

    const baseUrl = getPublicBaseUrl();
    const resetUrl = `${baseUrl}/admin-login/PasswordReset.html?token=${encodeURIComponent(
      token
    )}`;

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn(
        "⚠️ SMTP not configured; skipping password reset email."
      );
    } else {
      try {
        await mailTransporter.sendMail({
          from: '"MySpeakingScore" <chris@myspeakingscore.com>',
          to: admin.email,
          subject: "Reset your MySpeakingScore admin password",
          text: `
Hi ${admin.full_name || "there"},

We received a request to reset the password for your MySpeakingScore admin account.

To choose a new password, open this link:

  ${resetUrl}

If you did not request this, you can safely ignore this email.

— MySpeakingScore
          `.trim(),
          html: `
            <p>Hi ${admin.full_name || "there"},</p>
            <p>
              We received a request to reset the password for your
              <strong>MySpeakingScore admin account</strong>.
            </p>
            <p>
              To choose a new password, click the button below:
            </p>
            <p>
              <a href="${resetUrl}"
                 style="display:inline-block;padding:10px 18px;border-radius:999px;
                        background:#1d4ed8;color:#ffffff;text-decoration:none;
                        font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
                Reset my password
              </a>
            </p>
            <p style="font-size:13px;color:#6b7280;">
              Or copy and paste this URL into your browser:<br />
              <span style="word-break:break-all;">${resetUrl}</span>
            </p>
            <p style="font-size:13px;color:#6b7280;">
              If you did not request this, you can safely ignore this email.
            </p>
            <p>— MySpeakingScore</p>
          `,
        });
      } catch (err) {
        console.error("❌ Failed to send password reset email:", err);
        // Still return ok:true so UX is consistent
      }
    }

    return res.json({
      ok: true,
      message:
        "If this email is registered, a reset link has been sent.",
    });
  } catch (err) {
    console.error("POST /api/admin/password-reset/request error:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({
      ok: false,
      error: "reset_request_failed",
      message: "Server error while creating reset request.",
    });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// ADMIN PASSWORD RESET – COMPLETE
// POST /api/admin/password-reset  { token, password }
//  - verifies token
//  - updates admins.password_hash (plain text for now)
//  - marks reset as used
// ---------------------------------------------------------------------
app.post("/api/admin/password-reset", async (req, res) => {
  const body = req.body || {};
  const token = (body.token || "").trim();
  const password = (body.password || "").trim();

  if (!token) {
    return res.status(400).json({
      ok: false,
      error: "missing_token",
      message: "Verification code is required.",
    });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({
      ok: false,
      error: "weak_password",
      message: "Password must be at least 8 characters long.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows, rowCount } = await client.query(
      `
      SELECT id, admin_id, email, status, created_at, expires_at, used_at
      FROM admin_password_resets
      WHERE token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "invalid_token",
        message: "This verification code is not valid.",
      });
    }

    const reset = rows[0];

    if (reset.status !== "pending" || reset.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "already_used",
        message: "This verification code has already been used.",
      });
    }

    if (new Date(reset.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "expired",
        message: "This verification code has expired.",
      });
    }

//Nov 30

const adminEmail = (reset.email || "").trim().toLowerCase();
if (!adminEmail) {
  await client.query("ROLLBACK");
  return res.status(400).json({
    ok: false,
    error: "missing_admin_email",
    message: "Reset record is missing admin email.",
  });
}

// For now, keep password_hash as plain text to match existing login
const passwordHash = password;

await client.query(
  `
    UPDATE admins
    SET password_hash = $2,
        updated_at    = NOW()
    WHERE LOWER(email) = LOWER($1)
      AND is_active IS NOT FALSE
  `,
  [adminEmail, passwordHash]
);

    await client.query(
      `
      UPDATE admin_password_resets
      SET status  = 'used',
          used_at = NOW()
      WHERE id = $1
      `,
      [reset.id]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Password reset successful. You can now sign in.",
    });
  } catch (err) {
    console.error("POST /api/admin/password-reset error:", err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    return res.status(500).json({
      ok: false,
      error: "reset_failed",
      message: "Server error while resetting password.",
    });
  } finally {
    client.release();
  }
});

// Helper: hard-delete a school and its children
async function hardDeleteSchoolById(client, schoolId) {
  const id = Number(schoolId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("invalid_school_id");
  }

  // Adjust table names/constraints to match your schema
  await client.query(`DELETE FROM submissions     WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM questions_help  WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM questions       WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM assessments     WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM students        WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM school_assets   WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM admins          WHERE school_id = $1`, [id]);
  await client.query(`DELETE FROM schools         WHERE id        = $1`, [id]);
}

// DELETE /api/admin/school/:slug --- Nov 30 //
// super-admin only
app.delete("/api/admin/school/:slug", async (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const slug = req.params.slug;

  // Optional: also require a special header to confirm superadmin
  // e.g. X-SUPER-ADMIN: "true"
  // (You could tighten this later using real auth.)
  const isSuperHeader = req.header("X-SUPER-ADMIN") === "true";
  if (!isSuperHeader) {
    return res.status(403).json({
      ok: false,
      error: "not_superadmin",
      message: "Only super admins can delete schools.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows, rowCount } = await client.query(
      `SELECT id FROM schools WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "school_not_found",
      });
    }

    const schoolId = rows[0].id;

    await hardDeleteSchoolById(client, schoolId);

    await client.query("COMMIT");

    return res.json({ ok: true, deletedSlug: slug, schoolId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/admin/school/:slug error:", err);
    return res.status(500).json({
      ok: false,
      error: "delete_failed",
      message: err.message || "Error deleting school",
    });
  } finally {
    client.release();
  }
});

/* ---------- health ---------- */
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// == Clone default assessment + questions from mss-demo into a new school Nov 30 == //

async function cloneDefaultsFromDemoSchool(client, newSchoolId) {
  const TEMPLATE_SLUG = "mss-demo";

  // 1) Find the demo school
  const { rows: demoSchoolRows } = await client.query(
    "SELECT id FROM schools WHERE slug = $1 LIMIT 1",
    [TEMPLATE_SLUG]
  );
  if (!demoSchoolRows.length) {
    throw new Error(`Template school ${TEMPLATE_SLUG} not found`);
  }
  const demoSchoolId = demoSchoolRows[0].id;

  // 2) Grab its “main” assessment (pick first for now)
  const { rows: demoAssessRows } = await client.query(
    `
      SELECT id, name
      FROM assessments
      WHERE school_id = $1
      ORDER BY id
      LIMIT 1
    `,
    [demoSchoolId]
  );
  if (!demoAssessRows.length) {
    throw new Error(`No template assessment found for ${TEMPLATE_SLUG}`);
  }
  const demoAssessment = demoAssessRows[0];

  // 3) Create a new assessment for the new school (simple: name only)
  const { rows: newAssessRows } = await client.query(
    `
      INSERT INTO assessments (school_id, name)
      VALUES ($1, $2)
      RETURNING id
    `,
    [
      newSchoolId,
      demoAssessment.name || "Default Speaking Assessment",
    ]
  );
  const newAssessmentId = newAssessRows[0].id;

  // 4) Copy questions from demo assessment → new assessment
  const { rows: demoQuestions } = await client.query(
    `
      SELECT
        id,
        question,
        position,
        sort_order
      FROM questions
      WHERE assessment_id = $1
      ORDER BY position, id
    `,
    [demoAssessment.id]
  );

  let count = 0;

  for (const q of demoQuestions) {
    const order =
      (q.position != null ? q.position : q.sort_order) || count + 1;

    // Insert cloned question for the new school/assessment
    const insertQ = await client.query(
      `
        INSERT INTO questions (
          school_id,
          assessment_id,
          position,
          sort_order,
          question,
          is_active
        )
        VALUES ($1, $2, $3, $4, $5, TRUE)
        RETURNING id
      `,
      [newSchoolId, newAssessmentId, order, order, q.question]
    );
    const newQuestionId = insertQ.rows[0].id;
    count++;

    // Copy help row if one exists
    const helpRes = await client.query(
      `
        SELECT maxhelp, minhelp, prompt
        FROM questions_help
        WHERE school_id = $1 AND question_id = $2
        LIMIT 1
      `,
      [demoSchoolId, q.id]
    );

    if (helpRes.rowCount) {
      const h = helpRes.rows[0];
      await client.query(
        `
          INSERT INTO questions_help (
            school_id,
            question_id,
            maxhelp,
            minhelp,
            prompt
          )
          VALUES ($1, $2, $3, $4, $5)
        `,
        [newSchoolId, newQuestionId, h.maxhelp, h.minhelp, h.prompt]
      );
    }
  }

  console.log(
    `[signup] Cloned ${count} questions (plus help) from mss-demo → school ${newSchoolId}`
  );

  return { assessmentId: newAssessmentId, questionCount: count };
}
// ---------- EMBED CHECK & EVENTS ----------

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

app.get("/api/embed-check", async (req, res) => {
  try {
    const status = await getSchoolBillingStatus(req.query.schoolId);
    if (status.ok === false && !("blocked" in status)) {
      return res.status(400).json(status);
    }
    res.json(status);
  } catch (err) {
    console.error("GET /api/embed-check error:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/api/embed-event", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("📘 embed-event:", body);
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

  // For now, only require these three – password will be set later
  if (!schoolName || !adminName || !adminEmail) {
    return res.status(400).json({
      ok: false,
      error: "missing_required_fields",
      message: "School name, admin name, and email are required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const baseSlug = slugifySchoolName(schoolName);
    const slug = await getUniqueSlug(client, baseSlug);

    const { config, form } = await loadDefaultWidgetConfigAndForm();

    const settings = {
      widgetConfig: config,
      widgetForm: form,
      billing: {
        dailyLimit: 50,
        notifyOnLimit: true,
        emailOnLimit: adminEmail,
        autoBlockOnLimit: true,
      },
    };

       const schoolRes = await client.query(
      `
        INSERT INTO schools (slug, name, branding, settings)
        VALUES ($1, $2, '{}'::jsonb, $3::jsonb)
        RETURNING id
      `,
      [slug, schoolName, settings]
    );
    const schoolId = schoolRes.rows[0].id;

    // NEW: clone default assessment + questions + help from mss-demo
    await cloneDefaultsFromDemoSchool(client, schoolId);

    const passwordHash = adminPassword; // later: real hash


    await client.query(
      `INSERT INTO admins
         (school_id, email, full_name, password_hash, is_owner, is_active)
       VALUES ($1, $2, $3, $4, true, true)`,
      [schoolId, adminEmail, adminName, passwordHash]
    );

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

/* ---------- ADMIN: WIDGET CONFIG BY SLUG (DB-backed) ----------
   GET  /api/config/:slug   -> read settings.widgetConfig
   POST /api/config/:slug   -> upsert settings.widgetConfig
----------------------------------------------------------------- */

app.get("/api/config/:slug", async (req, res) => {
  const { slug } = req.params;

  try {
    const schoolRes = await pool.query(
      `SELECT id, settings
       FROM schools
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }

    const row = schoolRes.rows[0];
    const settings = row.settings || {};
    const config = settings.widgetConfig || defaultConfig;

    return res.json({
      ok: true,
      slug,
      schoolId: row.id,
      config,
    });
  } catch (err) {
    console.error("GET /api/config/:slug error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
});

app.post("/api/config/:slug", async (req, res) => {
  const { slug } = req.params;
  const body = req.body || {};
  const incomingConfig = body.config || body || {};

  try {
    const schoolRes = await pool.query(
      `SELECT id, settings
       FROM schools
       WHERE slug = $1
       LIMIT 1`,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res
        .status(404)
        .json({ ok: false, error: "school_not_found" });
    }

    const school = schoolRes.rows[0];

    const jsonConfig = JSON.stringify(incomingConfig);

    const updateRes = await pool.query(
      `
        UPDATE schools
        SET settings = jsonb_set(
          COALESCE(settings, '{}'::jsonb),
          '{widgetConfig}',
          $2::jsonb,
          true
        )
        WHERE slug = $1
        RETURNING id, settings
      `,
      [slug, jsonConfig]
    );

    const updated = updateRes.rows[0];
    const settings = updated.settings || {};
    const savedConfig = settings.widgetConfig || {};

    return res.json({
      ok: true,
      slug,
      schoolId: updated.id,
      config: savedConfig,
    });
  } catch (err) {
    console.error("POST /api/config/:slug error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "server_error" });
  }
});

// ---------------------------------------------------------------------
// ADMIN PORTAL – DUMMY ENDPOINTS (for local testing)
// ---------------------------------------------------------------------

// Stats for the Activity Snapshot card
app.get("/api/admin/stats/:slug", (req, res) => {
  const { slug } = req.params;
  const range = req.query.range || "today";

  // For now, just send hard-coded dummy data
  res.json({
    slug,
    range,
    from: "2025-11-18",
    to: "2025-11-20",
    totalTests: 42,
    topQuestion: {
      id: 1,
      text: "What is on your bucket list?"
    },
    highestCEFR: "C1",
    lowestCEFR: "A2",
    avgCEFR: "B2"
  });
});

/* ---------------------------------------------------------------
   Tests list for School Portal – uses vw_widget_reports
   --------------------------------------------------------------- */
app.get("/api/admin/tests", async (req, res) => {
  try {
    const { slug, from, to } = req.query;
    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "missing_slug",
        message: "slug is required",
      });
    }

    const params = [slug];
    const where = ["school_slug = $1"];
    let idx = 2;

    if (from) {
      where.push(`submitted_at::date >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      where.push(`submitted_at::date <= $${idx++}`);
      params.push(to);
    }

            const sql = `
      SELECT
        id,
        school_slug,
        submitted_at,
        question,

        student_id,
        student_name,
        student_email,

        toefl,
        ielts,
        pte,
        cefr,
        vox_score,
        mss_fluency,
        mss_grammar,
        mss_pron,
        mss_vocab,
        mss_cefr,
        mss_toefl,
        mss_ielts,
        mss_pte,

        help_level,
        help_surface,
        widget_variant,
        dashboard_variant,
        transcript_clean
      FROM vw_widget_reports
      WHERE ${where.join(" AND ")}
      ORDER BY submitted_at DESC
      LIMIT 2000
    `;
    const result = await pool.query(sql, params);

    return res.json({
      ok: true,
      tests: result.rows,
    });
  } catch (err) {
    console.error("❌ /api/admin/tests error:", err);
    return res.status(500).json({
      ok: false,
      error: "tests_failed",
      message: err.message || "Error fetching tests",
    });
  }
});
/* ---------------------------------------------------------------
   CSV export – all columns from vw_widget_reports
   --------------------------------------------------------------- */
app.get("/api/admin/tests/export", async (req, res) => {
  try {
    const { slug, from, to } = req.query;
    if (!slug) {
      return res.status(400).json({
        ok: false,
        error: "missing_slug",
        message: "slug is required",
      });
    }

    const params = [slug];
    const where = ["school_slug = $1"];
    let idx = 2;

    if (from) {
      where.push(`submitted_at::date >= $${idx++}`);
      params.push(from);
    }
    if (to) {
      where.push(`submitted_at::date <= $${idx++}`);
      params.push(to);
    }

        const sql = `
      SELECT
        id,
        school_slug,
        submitted_at,
        question,

        student_id,
        student_name,
        student_email,

        toefl,
        ielts,
        pte,
        cefr,
        vox_score,
        mss_fluency,
        mss_grammar,
        mss_pron,
        mss_vocab,
        mss_cefr,
        mss_toefl,
        mss_ielts,
        mss_pte,

        help_level,
        help_surface,
        widget_variant,
        dashboard_variant,
        transcript_clean
      FROM vw_widget_reports
      WHERE ${where.join(" AND ")}
      ORDER BY submitted_at DESC
    `;
    const result = await pool.query(sql, params);
    const rows = result.rows || [];

    // CSV helpers
          const headers = [
      "id",
      "school_slug",
      "submitted_at",
      "question",

      "student_id",
      "student_name",
      "student_email",

      "toefl",
      "ielts",
      "pte",
      "cefr",
      "vox_score",
      "mss_fluency",
      "mss_grammar",
      "mss_pron",
      "mss_vocab",
      "mss_cefr",
      "mss_toefl",
      "mss_ielts",
      "mss_pte",

      "help_level",
      "help_surface",
      "widget_variant",
      "dashboard_variant",
      "transcript_clean",
    ];
    const csvEscape = (val) => {
      if (val === null || val === undefined) return "";
      const s = String(val);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [];
    lines.push(headers.join(",")); // header row

    for (const row of rows) {
      const line = headers
        .map((h) => csvEscape(row[h]))
        .join(",");
      lines.push(line);
    }

    const filename = `mss-tests-${slug}-${from || "all"}-to-${to || "today"}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("❌ /api/admin/tests/export error:", err);
    return res.status(500).json({
      ok: false,
      error: "export_failed",
      message: err.message || "Error exporting CSV",
    });
  }
});

app.delete("/api/admin/reports/delete", express.json(), async (req, res) => {
  try {
    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: "No ids provided" });
    }

    // If submissions.id is INT
    await pool.query(
      `UPDATE submissions
       SET deleted_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );

    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error("Error deleting submissions:", err);
    res.status(500).json({ ok: false, error: "Failed to delete submissions" });
  }
});
/* ---------- start ---------- */
app.listen(PORT, () => {
  console.log(`✅ MSS Widget service listening on port ${PORT}`);
});
