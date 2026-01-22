/********************************************************************
 * ESL Success / MSS Widget Service
 * server_v2.js — Clean, commented, ESM‑ready version
 ********************************************************************/

/* ===================================================================
   1.  Environment & External Setup
   -------------------------------------------------------------------
   WHY: Load env first, then set up Express, DB, and middleware.
   =================================================================== */

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "passport";
import { Pool } from "pg";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import slugifyPkg from "slugify";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Database ---
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// --- Express App ---
export const app = express();
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || "dev_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" },
}));
app.use(passport.initialize());
app.use(passport.session());


/* ===================================================================
   2.  Utility Helpers – shared across server
   -------------------------------------------------------------------
   WHY: Centralize reusable helper functions (slug, hash, email,...)
   =================================================================== */

/** Normalize strings into safe, lowercase slugs */
export function slugifyLocal(input) {
  return slugifyPkg(String(input || "").toLowerCase().trim(), {
    lower: true,
    strict: true,
    trim: true,
  });
}

/** SHA‑256 hash utility (used for caching / fingerprints) */
export function sha256(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

/** Safe email sender that auto‑skips if SMTP not configured */
const smtpHost = process.env.SMTP_HOST || "";
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = process.env.SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || "";
const smtpSecure =
  String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || smtpPort === 465;

export const mailTransporter =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
      })
    : null;

export async function sendMailSafe({ to, subject, html, text }) {
  if (!mailTransporter)
    return { ok: false, skipped: true, message: "SMTP not configured" };
  try {
    const info = await mailTransporter.sendMail({
      from: process.env.SMTP_FROM || "ESL Success <noreply@eslsuccess.org>",
      to, subject, html, text,
    });
    return { ok: true, info };
  } catch (err) {
    console.error("[SMTP] sendMail failed:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

/** Generic error helper so we can throw for JSON handling */
export function httpError(status, message) {
  const e = new Error(message || "error");
  e.status = status;
  return e;
}


/* ===================================================================
   3.  AUTH Helpers – Actor JWT / Admin JWT
   -------------------------------------------------------------------
   WHY: Validate JWTs and attach `req.actor` or `req.admin`
   for downstream routes consistently.
   =================================================================== */

const ADMIN_JWT_SECRET = process.env.MSS_ADMIN_JWT_SECRET || "";
const ACTOR_JWT_SECRET = process.env.MSS_ACTOR_JWT_SECRET || "";
const ACTOR_JWT_ISSUER = "mss-widget-mt";
const ACTOR_JWT_AUD = "mss-actor";

/** Verify JWT but return null on error instead of throwing */
function verifyJwtOrNull(token, secret, opts) {
  try { return jwt.verify(token, secret, opts); } catch { return null; }
}

/** Canonical shape for all actor tokens */
function normalizeActor(payload) {
  return {
    actorType: String(payload.actorType || "").toLowerCase(),
    actorId: Number(payload.actorId || 0) || null,
    email: String(payload.email || "").toLowerCase(),
    schoolId: payload.schoolId ?? null,
    slug: String(payload.slug || ""),
    isSuperAdmin: !!payload.isSuperAdmin,
    isOwner: !!payload.isOwner,
    isTeacherAdmin: !!payload.isTeacherAdmin,
  };
}

/** Middleware – require authenticated Actor JWT (admin or teacher) */
export async function requireActorAuth(req, res, next) {
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "").trim();
  if (!token)
    return res.status(401).json({ ok: false, error: "missing_auth" });

  const decoded = verifyJwtOrNull(token, ACTOR_JWT_SECRET, {
    issuer: ACTOR_JWT_ISSUER,
    audience: ACTOR_JWT_AUD,
  });
  if (!decoded)
    return res.status(401).json({ ok: false, error: "invalid_token" });

  req.actor = normalizeActor(decoded);
  req.auth = { mode: "actor_jwt" };
  next();
}

/** Middleware – require legacy Admin JWT authentication */
export async function requireAdminAuth(req, res, next) {
  const token = String(req.headers.authorization || "")
    .replace(/^Bearer\s+/i, "").trim();
  if (!token)
    return res.status(401).json({ ok: false, error: "missing_auth" });

  const decoded = verifyJwtOrNull(token, ADMIN_JWT_SECRET, {
    issuer: "mss-widget-mt",
    audience: "mss-admin",
  });
  if (!decoded)
    return res.status(401).json({ ok: false, error: "invalid_token" });

  req.admin = decoded;
  req.auth = { mode: "admin_jwt" };
  next();
}

/** Role guard – allow admin OR teacher_admin */
export function requireAdminOrTeacherAdmin(req, res, next) {
  const a = req.actor || {};
  const ok =
    a.actorType === "admin" ||
    (a.actorType === "teacher" && a.isTeacherAdmin === true);
  if (!ok)
    return res
      .status(403)
      .json({ ok: false, error: "admin_or_teacher_admin_required" });
  next();
}

/** Health test so Part 1 runs standalone */
app.get("/health", (req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ server_v2 (part 1 sample) running on port ${PORT}`)
);
/* ===================================================================
   4. AI Helpers – OpenAI / Prompt Rendering
   -------------------------------------------------------------------
   WHY: All OpenAI‑related functions live here so they can be reused
        across AI Prompt and AI Report routes.
   =================================================================== */

export async function openAiGenerateReport({
  promptText,
  model = "gpt-4o-mini",
  temperature = 0.4,
  max_output_tokens = 900,
}) {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY not set in .env");

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("[AI] → Sending prompt", {
    model, temperature, tokens: max_output_tokens, chars: promptText.length,
  });

  const timeoutMs = 25000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await openai.responses.create({
      model,
      input: promptText,
      temperature,
      max_output_tokens,
    }, { signal: controller.signal });

    const text = (response.output_text || "").trim();
    console.log("[AI] ← Received response", { len: text.length });
    if (!text) throw new Error("Empty response from OpenAI");
    return { text, model, temperature, max_output_tokens };
  } finally {
    clearTimeout(t);
  }
}

/** Template renderer for AI Prompts – supports {{var}} and {{#if var}} blocks */
export function renderPromptTemplate(template, vars = {}) {
  let t = String(template || "");
  const ifRe = /\{\{\s*#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;

  let guard = 0;
  while (guard++ < 25) {
    ifRe.lastIndex = 0;
    if (!ifRe.test(t)) break;
    t = t.replace(ifRe, (_, key, body) =>
      vars[key] ? body : ""
    );
  }

  t = t.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key) => (vars[key] == null ? "" : String(vars[key]))
  );

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Combine preamble + metrics + notes into an AI suggest prompt */
export function buildSuggestedPromptTemplate({ preamble, language, notes, selectedMetrics }) {
  const pre = String(preamble || "").trim();
  const helperLanguage = String(language || "").trim();
  const adminNotes = String(notes || "").trim();

  const metrics = Array.isArray(selectedMetrics)
    ? selectedMetrics.map(x => x.trim()).filter(Boolean)
    : [];

  const helperRule = helperLanguage
    ? `HELPER LANGUAGE POLICY:
- Use ${helperLanguage} only for instruction explanations.
- Keep all student evidence in English.`
    : "";

  const parts = [
    pre,
    helperRule,
    "TASK:\nGenerate teacher‑usable prompt template for feedback on a student’s spoken response.",
    `Selected metrics: ${metrics.join(", ") || "(none)"}`,
    adminNotes ? `Admin notes:\n${adminNotes}` : "",
  ];

  return parts.filter(Boolean).join("\n\n");
}


/* ===================================================================
   5. AI Prompt Management (Actor Auth)
   -------------------------------------------------------------------
   Routes → CRUD operations on ai_prompts table.
   Each is scoped via requireSchoolCtxFromActor helper.
   =================================================================== */

import { requireActorAuth, requireAdminOrTeacherAdmin } from "./server_v2.js"; // self‑import OK (ESM orderless)

async function getSchoolId(req, res, slug) {
  const result = await pool.query(
    `SELECT id FROM schools WHERE slug = $1 LIMIT 1`, [slug]
  );
  if (!result.rowCount) {
    res.status(404).json({ ok: false, error: "school_not_found" });
    return null;
  }
  return result.rows[0].id;
}

// --- GET all prompts for school
app.get("/api/admin/ai-prompts/:slug",
  requireActorAuth,
  requireAdminOrTeacherAdmin,
  async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    const schoolId = await getSchoolId(req, res, slug);
    if (!schoolId) return;

    const rows = (await pool.query(
      `SELECT *
         FROM ai_prompts
        WHERE school_id = $1
        ORDER BY COALESCE(sort_order, 9999), is_default DESC, updated_at DESC`,
      [schoolId]
    )).rows;

    res.json({ ok: true, prompts: rows });
  });

// --- POST create prompt
app.post("/api/admin/ai-prompts/:slug",
  requireActorAuth,
  requireAdminOrTeacherAdmin,
  async (req, res) => {
    const slug = String(req.params.slug || "").trim();
    const schoolId = await getSchoolId(req, res, slug);
    if (!schoolId) return;

    const { name, prompt_text } = req.body || {};
    if (!name || !prompt_text)
      return res.status(400).json({ ok: false, error: "missing_fields" });

    const isDefault = !!req.body.is_default;
    if (isDefault)
      await pool.query(`UPDATE ai_prompts SET is_default=false WHERE school_id=$1`, [schoolId]);

    const row = (await pool.query(
      `INSERT INTO ai_prompts
         (school_id, name, prompt_text, is_default, is_active)
       VALUES ($1,$2,$3,$4,true)
       RETURNING *`,
      [schoolId, name, prompt_text, isDefault]
    )).rows[0];

    res.json({ ok: true, prompt: row });
  });

// --- PUT update prompt
app.put("/api/admin/ai-prompts/:slug/:id",
  requireActorAuth,
  requireAdminOrTeacherAdmin,
  async (req, res) => {
    const slug = req.params.slug.trim();
    const id = Number(req.params.id);
    const schoolId = await getSchoolId(req, res, slug);
    if (!schoolId) return;

    const fields = [];
    const vals = [];
    let idx = 1;
    const add = (col, val) => { fields.push(`${col}=$${idx++}`); vals.push(val); };

    if (req.body.name) add("name", req.body.name.trim());
    if (req.body.prompt_text) add("prompt_text", req.body.prompt_text.trim());
    if (req.body.notes) add("notes", String(req.body.notes));
    if (req.body.language) add("language", String(req.body.language));

    if (!fields.length)
      return res.json({ ok: true, unchanged: true });

    vals.push(id, schoolId);
    const row = (await pool.query(
      `UPDATE ai_prompts SET ${fields.join(", ")}, updated_at=now()
         WHERE id=$${idx++} AND school_id=$${idx++}
         RETURNING *`,
      vals
    )).rows[0];
    res.json({ ok: true, prompt: row });
  });

// --- DELETE prompt (soft if referenced)
app.delete("/api/admin/ai-prompts/:slug/:id",
  requireActorAuth,
  requireAdminOrTeacherAdmin,
  async (req, res) => {
    const slug = req.params.slug.trim();
    const id = Number(req.params.id);
    const schoolId = await getSchoolId(req, res, slug);
    if (!schoolId) return;

    const ref = await pool.query(`SELECT 1 FROM ai_reports WHERE prompt_id=$1 LIMIT 1`, [id]);
    if (ref.rowCount) {
      await pool.query(
        `UPDATE ai_prompts SET is_active=false, updated_at=now()
          WHERE id=$1 AND school_id=$2`, [id, schoolId]
      );
      return res.json({ ok: true, deleted: true, mode: "soft" });
    }
    await pool.query(`DELETE FROM ai_prompts WHERE id=$1 AND school_id=$2`, [id, schoolId]);
    res.json({ ok: true, deleted: true, mode: "hard" });
  });


/* ===================================================================
   6. AI Reports (Cached + Generate via OpenAI)
   -------------------------------------------------------------------
   WHY: Generate student feedback reports from submission data.
   Each report is cached on ai_reports (submission_id,prompt_id).
   =================================================================== */

app.get("/api/admin/reports/existing",
  requireAdminAuth,
  async (req, res) => {
    const sid = Number(req.query.submission_id);
    const pid = Number(req.query.prompt_id);
    if (!sid || !pid)
      return res.status(400).json({ ok: false, error: "missing_ids" });

    const r = await pool.query(
      `SELECT report_text, model, temperature, max_output_tokens, created_at
         FROM ai_reports WHERE submission_id=$1 AND prompt_id=$2 LIMIT 1`,
      [sid, pid]
    );
    if (!r.rowCount)
      return res.json({ ok: true, exists: false });
    res.json({ ok: true, exists: true, report: r.rows[0] });
  });

app.post("/api/admin/reports/generate",
  requireAdminAuth,
  async (req, res) => {
    const { slug, submission_id, ai_prompt_id, force } = req.body || {};
    const slugStr = String(slug || "").trim();
    const sid = Number(submission_id);
    const pid = Number(ai_prompt_id);
    if (!slugStr || !sid || !pid)
      return res.status(400).json({ ok: false, error: "bad_inputs" });

    const school = await pool.query(
      `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slugStr]
    );
    if (!school.rowCount)
      return res.status(404).json({ ok: false, error: "school_not_found" });
    const schoolId = school.rows[0].id;

    // Load prompt & submission
    const prompt = (await pool.query(
      `SELECT prompt_text, notes, language FROM ai_prompts
         WHERE id=$1 AND school_id=$2`, [pid, schoolId]
    )).rows[0];
    const sub = (await pool.query(
      `SELECT * FROM submissions
         WHERE id=$1 AND school_id=$2 AND deleted_at IS NULL`,
      [sid, schoolId]
    )).rows[0];
    if (!prompt || !sub)
      return res.status(404).json({ ok: false, error: "data_not_found" });

    const vars = {
      question: sub.question,
      transcript: sub.transcript_clean || sub.transcript,
      student: sub.student_name || sub.student_email || sub.student_id,
      wpm: sub.wpm,
      mss_fluency: sub.mss_fluency, mss_grammar: sub.mss_grammar, mss_pron: sub.mss_pron,
      mss_vocab: sub.mss_vocab, mss_cefr: sub.mss_cefr,
      mss_toefl: sub.mss_toefl, mss_ielts: sub.mss_ielts, mss_pte: sub.mss_pte,
      vox_score: sub.vox_score,
    };

    const finalPrompt = renderPromptTemplate(prompt.prompt_text, vars);
    const hash = sha256(finalPrompt);

    if (!force) {
      const cached = await pool.query(
        `SELECT report_text FROM ai_reports
           WHERE submission_id=$1 AND prompt_id=$2 LIMIT 1`, [sid, pid]
      );
      if (cached.rowCount)
        return res.json({ ok: true, source: "cache", report_text: cached.rows[0].report_text });
    }

    const ai = await openAiGenerateReport({
      promptText: finalPrompt,
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_output_tokens: 900,
    });

    await pool.query(
      `INSERT INTO ai_reports
         (submission_id, prompt_id, prompt_hash, model, temperature, max_output_tokens, report_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (submission_id,prompt_id)
       DO UPDATE SET
         report_text=EXCLUDED.report_text,
         prompt_hash=EXCLUDED.prompt_hash,
         updated_at=now()`,
      [sid, pid, hash, ai.model, ai.temperature, ai.max_output_tokens, ai.text]
    );

    res.json({ ok: true, source: "openai", report_text: ai.text });
  });
  /* ===================================================================
   7. Admin Authentication & Password Reset
   -------------------------------------------------------------------
   WHY: Legacy admin accounts use email + JWT sessions; this section
        handles login and secure password reset tokens.
   =================================================================== */

// POST /api/admin/login – legacy admin login
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ ok: false, error: "missing_fields" });

  try {
    const row = (await pool.query(
      `SELECT * FROM admins WHERE lower(email)=lower($1) LIMIT 1`, [email]
    )).rows[0];

    if (!row)
      return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const okPass = await bcrypt.compare(password, row.password_hash || "");
    if (!okPass)
      return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const token = jwt.sign(
      {
        aid: row.id,
        email: row.email.toLowerCase(),
        isSuperAdmin: row.is_superadmin,
        schoolId: row.school_id,
      },
      process.env.MSS_ADMIN_JWT_SECRET,
      {
        expiresIn: process.env.MSS_ADMIN_JWT_TTL || "12h",
        issuer: "mss-widget-mt",
        audience: "mss-admin",
      }
    );

    res.json({
      ok: true,
      admin: {
        id: row.id,
        email: row.email,
        full_name: row.full_name,
        isSuperAdmin: row.is_superadmin,
        schoolId: row.school_id,
      },
      token,
    });
  } catch (err) {
    console.error("❌ /admin/login failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /api/admin/password-reset/request – send reset email
app.post("/api/admin/password-reset/request", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email)
    return res.status(400).json({ ok: false, error: "missing_email" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(
      `SELECT id,email,full_name FROM admins
         WHERE lower(email)=lower($1) AND is_active IS TRUE
         LIMIT 1`, [email]
    )).rows[0];

    if (!row) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "If this email exists, a reset link was sent.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    await client.query(
      `INSERT INTO admin_password_resets
         (admin_id,email,token,status,created_at,expires_at)
       VALUES ($1,$2,$3,'pending',now(),now()+interval '2 hours')`,
      [row.id, email, token]
    );

    await client.query("COMMIT");

    const resetUrl =
      `${process.env.PUBLIC_BASE_URL}/admin-login/PasswordReset.html?token=${encodeURIComponent(token)}`;

    await sendMailSafe({
      to: email,
      subject: "Reset your MySpeakingScore admin password",
      html: `<p>Hi ${row.full_name || "there"},</p>
             <p>Click below to choose a new password:</p>
             <p><a href="${resetUrl}">Reset my password</a></p>
             <p>If you did not request this, ignore this email.</p>`,
    });
    res.json({ ok: true, message: "Reset link sent if email exists." });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ password-reset request failed:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// POST /api/admin/password-reset – apply new password
app.post("/api/admin/password-reset", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res.status(400).json({ ok: false, error: "missing_fields" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const reset = (await client.query(
      `SELECT * FROM admin_password_resets
         WHERE token=$1 AND status='pending'
           AND expires_at > now() LIMIT 1`,
      [token]
    )).rows[0];
    if (!reset) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `UPDATE admins SET password_hash=$1 WHERE id=$2`,
      [hash, reset.admin_id]
    );
    await client.query(
      `UPDATE admin_password_resets
         SET status='used', used_at=now() WHERE id=$1`,
      [reset.id]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ password-reset apply failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});


/* ===================================================================
   8. School Signup & Provisioning
   -------------------------------------------------------------------
   WHY: Create and verify new school records via Stored Procedures.
   =================================================================== */

// POST /api/school-signup – basic form creates pending row
app.post("/api/school-signup", async (req, res) => {
  try {
    const body = req.body || {};
    const required = ["schoolName","websiteUrl","country","contactName","contactEmail","adminPassword"];
    const missing = required.filter(k => !body[k]);
    if (missing.length)
      return res.status(400).json({ ok:false, error:"validation_error", missing });

    const token = crypto.randomBytes(32).toString("hex");
    const payload = {
      slug: slugifyLocal(body.schoolName),
      contactEmail: body.contactEmail,
      contactName: body.contactName,
    };

    await pool.query(
      `INSERT INTO pending_signups
         (admin_email,admin_name,school_name,token,payload)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [body.contactEmail, body.contactName, body.schoolName, token, payload]
    );

    const verifyUrl =
      `${process.env.PUBLIC_BASE_URL}/signup/VerifySignup.html?token=${token}`;
    await sendMailSafe({
      to: body.contactEmail,
      subject: "Confirm your MySpeakingScore school signup",
      html: `<p>Hi ${body.contactName},</p>
             <p>Click below to confirm your email:</p>
             <p><a href="${verifyUrl}">Confirm my email</a></p>`,
    });
    res.json({ ok: true, message: "Signup received. Check your email to confirm." });
  } catch (err) {
    console.error("❌ school‑signup failed:", err);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// POST /api/school-signup/verify – finalize pending row
app.post("/api/school-signup/verify", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token)
    return res.status(400).json({ ok:false, error:"missing_token" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pending = (await client.query(
      `SELECT * FROM pending_signups WHERE token=$1 FOR UPDATE`, [token]
    )).rows[0];
    if (!pending) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok:false, error:"invalid_token" });
    }

    const body = pending.payload || {};
    const slug = body.slug || slugifyLocal(pending.school_name);
    const passHash = await bcrypt.hash(body.passwordHash || pending.token, 10);

    const sp = await client.query(
      `SELECT * FROM public.mss_provision_school_with_admin($1,$2,$3,$4,$5,$6)`,
      [slug, pending.school_name, pending.admin_email, pending.admin_name, passHash, "mss-demo"]
    );

    const out = sp.rows?.[0] || {};
    if (!out.school_id)
      throw new Error("Stored procedure did not return school_id");

    await client.query(
      `UPDATE pending_signups
         SET used_at=now(),status='provisioned'
         WHERE id=$1`, [pending.id]
    );

    await client.query("COMMIT");
    res.json({
      ok: true,
      schoolId: out.school_id,
      adminId: out.admin_id,
      slug,
      message: "School created successfully.",
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ school‑signup verify failed:", e);
    res.status(500).json({ ok:false, error:"server_error" });
  } finally {
    client.release();
  }
});
/* ===================================================================
   9. Widget / Submission / Branding Endpoints
   -------------------------------------------------------------------
   WHY: Endpoints used by student widgets embedded on websites to 
        submit recordings and for school admins to handle branding.
   =================================================================== */

// POST /api/widget/submit – record widget submission
app.post("/api/widget/submit", async (req, res) => {
  try {
    const body = req.body?.submission || req.body || {};
    const slug = String(body.slug || req.query.slug || "").trim();
    if (!slug)
      return res.status(400).json({ ok: false, error: "missing_slug" });

    const school = (await pool.query(
      `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
    )).rows[0];
    if (!school)
      return res.status(404).json({ ok: false, error: "school_not_found" });

    const lengthSec = Number(body.lengthSec || body.durationSec || 0) || null;
    const transcript = String(body.transcript || "").trim() || null;
    const question = String(body.question || body.prompt || "").trim() || null;

    const ins = await pool.query(
      `INSERT INTO submissions
         (school_id,question,student_id,transcript,length_sec)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [school.id, question, body.studentId || null, transcript, lengthSec]
    );

    const submissionId = ins.rows[0].id;

    res.json({ ok: true, submissionId });
  } catch (err) {
    console.error("❌ /widget/submit failed:", err);
    res.status(500).json({ ok: false, error: "submit_failed" });
  }
});

// GET /api/widget/:slug/bootstrap – return widget config + questions
app.get("/api/widget/:slug/bootstrap", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const school = (await pool.query(
      `SELECT id,settings FROM schools WHERE slug=$1 LIMIT 1`, [slug]
    )).rows[0];
    if (!school)
      return res.status(404).json({ ok: false, error: "school_not_found" });

    const config = school.settings?.config || {};
    const form = school.settings?.form || {};
    const assessment = (await pool.query(
      `SELECT id FROM assessments WHERE school_id=$1 LIMIT 1`, [school.id]
    )).rows[0];

    const questions = (await pool.query(
      `SELECT id,question FROM questions WHERE assessment_id=$1
         AND is_public=true ORDER BY position,id`,
      [assessment?.id]
    )).rows;

    res.json({
      ok: true,
      slug,
      config,
      form,
      questions,
    });
  } catch (err) {
    console.error("❌ /widget/bootstrap failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /api/admin/branding/:slug/logo – upload base64 logo
app.post("/api/admin/branding/:slug/logo", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const { imageData } = req.body || {};
    if (!imageData)
      return res.status(400).json({ ok: false, error: "missing_image" });

    const school = (await pool.query(
      `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
    )).rows[0];
    if (!school)
      return res.status(404).json({ ok: false, error: "school_not_found" });

    await pool.query(
      `UPDATE schools SET branding=jsonb_set(
         COALESCE(branding,'{}'::jsonb),
         '{logoDataUrl}',
         to_jsonb($2::text),true
       ) WHERE id=$1`,
      [school.id, imageData]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ branding logo upload failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});


/* ===================================================================
   10. Teacher / Admin Portals ( Teacher Students · Teachers CRUD )
   -------------------------------------------------------------------
   WHY: APIs used by school staff to manage teachers and students.
   =================================================================== */

// GET /api/teacher/students?slug=...
app.get("/api/teacher/students", requireAdminAuth, async (req, res) => {
  const slug = String(req.query.slug || "").trim();
  if (!slug)
    return res.status(400).json({ ok: false, error: "missing_slug" });

  const school = (await pool.query(
    `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
  )).rows[0];
  if (!school)
    return res.status(404).json({ ok: false, error: "school_not_found" });

  const students = (await pool.query(
    `SELECT id,full_name,email,is_active,created_at
       FROM students WHERE school_id=$1 ORDER BY id DESC`,
    [school.id]
  )).rows;

  res.json({ ok: true, students });
});

// PUT /api/teacher/students/:id/profile?slug=...
app.put("/api/teacher/students/:id/profile", requireAdminAuth, async (req, res) => {
  const sid = Number(req.params.id);
  const slug = String(req.query.slug || "").trim();
  const phone = String(req.body.phone || "");
  const summary = String(req.body.summary || "");

  if (!slug || !sid)
    return res.status(400).json({ ok: false, error: "missing_params" });

  const school = (await pool.query(
    `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
  )).rows[0];
  if (!school)
    return res.status(404).json({ ok: false, error: "school_not_found" });

  await pool.query(
    `UPDATE student_profiles SET phone=$3,summary=$4,updated_at=now()
       WHERE student_id=$1 AND school_id=$2`,
    [sid, school.id, phone, summary]
  );

  res.json({ ok: true });
});

// GET /api/admin/teachers?slug=...
app.get("/api/admin/teachers", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  const slug = String(req.query.slug || "").trim();
  const school = (await pool.query(
    `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
  )).rows[0];
  if (!school)
    return res.status(404).json({ ok: false, error: "school_not_found" });

  const teachers = (await pool.query(
    `SELECT id,email,full_name,is_active,is_on_duty,created_at
       FROM teachers WHERE school_id=$1 ORDER BY id DESC`,
    [school.id]
  )).rows;

  res.json({ ok: true, teachers });
});

// PUT /api/admin/teachers/on-duty – set or clear on‑duty
app.put("/api/admin/teachers/on-duty", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  const slug = String(req.query.slug || "").trim();
  const teacherId = Number(req.body.teacher_id || 0);
  const isOnDuty = String(req.body.is_on_duty || "").toLowerCase() === "true";

  const school = (await pool.query(
    `SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [slug]
  )).rows[0];
  if (!school)
    return res.status(404).json({ ok: false, error: "school_not_found" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE teachers SET is_on_duty=false WHERE school_id=$1 AND is_on_duty=true`,
      [school.id]
    );

    if (teacherId && isOnDuty) {
      await client.query(
        `UPDATE teachers SET is_on_duty=true WHERE school_id=$1 AND id=$2`,
        [school.id, teacherId]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ set on‑duty failed:", err);
    res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    client.release();
  }
});

// GET /api/admin/me – verify actor context
app.get("/api/admin/me", requireActorAuth, async (req, res) => {
  const a = req.actor || {};
  if (!a.actorId)
    return res.status(401).json({ ok: false, error: "missing_actor_ctx" });

  if (a.actorType === "admin") {
    const row = (await pool.query(
      `SELECT id,email,full_name,is_superadmin,school_id
         FROM admins WHERE id=$1 LIMIT 1`, [a.actorId]
    )).rows[0];
    return row
      ? res.json({ ok: true, actorType: "admin", admin: row })
      : res.status(404).json({ ok: false, error: "not_found" });
  }

  if (a.actorType === "teacher") {
    const row = (await pool.query(
      `SELECT id,email,full_name,is_teacher_admin,school_id
         FROM teachers WHERE id=$1 LIMIT 1`, [a.actorId]
    )).rows[0];
    return row
      ? res.json({ ok: true, actorType: "teacher", teacher: row })
      : res.status(404).json({ ok: false, error: "not_found" });
  }

  res.status(400).json({ ok: false, error: "unsupported_actor_type" });
});
/* ===================================================================
   11. Diagnostics / Utilities / Health Checks
   -------------------------------------------------------------------
   WHY: Provide safe inspection and debug endpoints for operators.
   =================================================================== */

/** Enumerate registered routes for debug in dev environment */
function collectRoutes(stack = [], prefix = "") {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {})
        .filter(Boolean)
        .map(m => m.toUpperCase())
        .join(",");
      out.push(`${methods} ${prefix}${layer.route.path}`);
    }
    if (layer.name === "router" && layer.handle?.stack) {
      out.push(...collectRoutes(layer.handle.stack, prefix));
    }
  }
  return out;
}

app.get("/api/__routes_probe", (req, res) => {
  const routes = collectRoutes(app._router?.stack || []);
  res.json({
    ok: true,
    total: routes.length,
    sample: routes.slice(0, 25),
  });
});

/** Simple health and uptime check */
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() });
});

/* ===================================================================
   12. Global Error Handler & Server Startup
   -------------------------------------------------------------------
   WHY: Centralized error response and server listen bootstrap.
   =================================================================== */

// Global error handler – ensures JSON response
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Internal Server Error" });
});

// Catch‑all 404
app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Route not found" })
);

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ESL Success server_v2 running on port ${PORT}`);
});