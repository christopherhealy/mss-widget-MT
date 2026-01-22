// server.js — ESM version for "type": "module" (Nov 25 update for Vercel)
// updated Jan 17 2026 - the mss_client version for central auth
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
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import slugifyPkg from "slugify";
import { adminTeachersRouter } from "./routes/adminTeachers.routes.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config();

// just to be sure
console.log("[env] DATABASE_URL present:", !!process.env.DATABASE_URL);
console.log("[env] MSS_ADMIN_JWT_SECRET present:", !!process.env.MSS_ADMIN_JWT_SECRET);
console.log("[env] MSS_ADMIN_JWT_TTL:", process.env.MSS_ADMIN_JWT_TTL || "(default)");

// ---------------------------------------------------------------------
// AUTH (Unified, deterministic) — Jan 2026
//
// Canonical auth: Actor JWT in Authorization: Bearer <token>
//   - audience: "mss-actor"
//   - issuer:   "mss-widget-mt"
//
// Back-compat (temporary):
//   - legacy Admin JWT (aud "mss-admin") is accepted and normalized into actor form.
//   - x-admin-key bypass is disabled by default (feature flag).
//
// Contract:
//   - After middleware: req.actor is ALWAYS present (canonical shape)
//   - req.auth.mode indicates which mechanism authenticated the request
// ---------------------------------------------------------------------

// Canonical (actor) JWT
//const ACTOR_JWT_SECRET = process.env.MSS_ACTOR_JWT_SECRET || "";
//const ACTOR_JWT_ISSUER = "mss-widget-mt";
//const ACTOR_JWT_AUD = "mss-actor";

// Legacy (admin) JWT — DEPRECATE after migration
const ADMIN_JWT_SECRET = process.env.MSS_ADMIN_JWT_SECRET || "";
const ADMIN_JWT_ISSUER = "mss-widget-mt";
const ADMIN_JWT_AUD = "mss-admin";

const ACTOR_JWT_SECRET = String(process.env.MSS_ACTOR_JWT_SECRET || "").trim();
const ACTOR_JWT_TTL = process.env.MSS_ACTOR_JWT_TTL || "12h";
const ACTOR_JWT_ISSUER = "mss-widget-mt";
const ACTOR_JWT_AUD = "mss-actor";

if (!ACTOR_JWT_SECRET) {
  throw new Error("Missing MSS_ACTOR_JWT_SECRET");
}
const UPLOADS_DIR = path.join(__dirname, "uploads");
// Hard disable legacy x-admin-key unless explicitly enabled
const ENABLE_LEGACY_ADMIN_KEY =
  String(process.env.MSS_ENABLE_LEGACY_ADMIN_KEY || "").toLowerCase() === "true";

// Fail-fast in environments where you expect auth to work
// (You can relax this locally if you intentionally run without secrets.)
function requireEnvSecret(name, value) {
  if (!value) throw new Error(`Missing ${name}`);
}

// If you want strict startup validation, uncomment:
// requireEnvSecret("MSS_ACTOR_JWT_SECRET", ACTOR_JWT_SECRET);
// (Optional) Only require legacy if you still accept it:
// if (ADMIN_JWT_SECRET) requireEnvSecret("MSS_ADMIN_JWT_SECRET", ADMIN_JWT_SECRET);

function readBearer(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

function verifyJwtOrNull(token, secret, opts) {
  try {
    return jwt.verify(token, secret, opts);
  } catch (_) {
    return null;
  }
}

// Canonical shape: req.actor
function normalizeActorFromActorJwt(p) {
  return {
    actorType: String(p.actorType || "").toLowerCase(),
    actorId: Number(p.actorId || 0) || null,
    email: String(p.email || "").trim().toLowerCase(),
    schoolId: p.schoolId ?? null,
    slug: String(p.slug || "").trim(),

    // role flags
    isSuperAdmin: !!p.isSuperAdmin,
    isOwner: !!p.isOwner,
    isTeacherAdmin: !!p.isTeacherAdmin,
  };
}

// Legacy admin JWT payload -> canonical actor
// signAdminToken uses: { aid, email, isSuperAdmin, schoolId }
function normalizeActorFromAdminJwt(p) {
  return {
    actorType: "admin",
    actorId: Number(p.aid || 0) || null,
    email: String(p.email || "").trim().toLowerCase(),
    schoolId: p.schoolId ?? null,
    slug: "", // legacy token did not carry slug

    isSuperAdmin: !!p.isSuperAdmin,
    isOwner: false,
    isTeacherAdmin: false,
  };
}

function isValidCanonicalActor(a) {
  return !!(
    a &&
    typeof a === "object" &&
    (a.actorType === "admin" || a.actorType === "teacher") &&
    Number(a.actorId || 0) > 0 &&
    String(a.email || "").includes("@")
  );
}

// Single auth middleware for the entire app
export function requireActorAuth(req, res, next) {
  // 0) Optional true-legacy x-admin-key (strongly discouraged)
  const legacyKey = String(req.headers["x-admin-key"] || "").trim();
  if (legacyKey) {
    if (!ENABLE_LEGACY_ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "legacy_admin_key_disabled" });
    }
    // NOTE: If you still support x-admin-key, verify it here (DB/lookup).
    // For now, it is treated as "authenticated" but with unknown identity.
    req.auth = { mode: "legacy_admin_key" };
    req.actor = {
      actorType: "admin",
      actorId: null,
      email: "",
      schoolId: null,
      slug: "",
      isSuperAdmin: false,
      isOwner: false,
      isTeacherAdmin: false,
    };
    return next();
  }

  // 1) Bearer token required
  const token = readBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "missing_auth" });

  // 2) Try canonical Actor JWT first
  const actorPayload = verifyJwtOrNull(token, ACTOR_JWT_SECRET, {
    issuer: ACTOR_JWT_ISSUER,
    audience: ACTOR_JWT_AUD,
  });

  if (actorPayload) {
    req.auth = { mode: "actor_jwt" };
    req.actor = normalizeActorFromActorJwt(actorPayload);

    if (!isValidCanonicalActor(req.actor)) {
      return res.status(401).json({ ok: false, error: "bad_token_shape" });
    }
    return next();
  }

  // 3) Back-compat: accept legacy Admin JWT and normalize
  if (ADMIN_JWT_SECRET) {
    const adminPayload = verifyJwtOrNull(token, ADMIN_JWT_SECRET, {
      issuer: ADMIN_JWT_ISSUER,
      audience: ADMIN_JWT_AUD,
    });

    if (adminPayload) {
      req.auth = { mode: "admin_jwt_legacy" };
      req.actor = normalizeActorFromAdminJwt(adminPayload);

      if (!isValidCanonicalActor(req.actor)) {
        return res.status(401).json({ ok: false, error: "bad_token_shape" });
      }
      return next();
    }
  }

  return res.status(401).json({ ok: false, error: "invalid_token" });
}

// ---- Role guards (deterministic; no DB read) ----

export function requireAdminRole(req, res, next) {
  const a = req.actor || {};
  if (a.actorType !== "admin") return res.status(403).json({ ok: false, error: "admin_required" });
  return next();
}

export function requireTeacherRole(req, res, next) {
  const a = req.actor || {};
  if (a.actorType !== "teacher") return res.status(403).json({ ok: false, error: "teacher_required" });
  return next();
}

// Allows: admin OR teacher_admin (teacher actor with isTeacherAdmin flag)
export function requireAdminOrTeacherAdmin(req, res, next) {
  const a = req.actor || {};
  const ok = a.actorType === "admin" || (a.actorType === "teacher" && a.isTeacherAdmin === true);
  if (!ok) return res.status(403).json({ ok: false, error: "admin_or_teacher_admin_required" });
  return next();
}

export function requireSuperAdmin(req, res, next) {
  const a = req.actor || {};
  if (a.actorType !== "admin" || a.isSuperAdmin !== true) {
    return res.status(403).json({ ok: false, error: "superadmin_required" });
  }
  return next();
}

// ---------------------------------------------------------------------
// Staff auth: accept unified actor JWT for admin OR teacher
// Attaches: req.actor_ctx = { actorType, actorId, email, slug, schoolId, isSuperAdmin }
// ---------------------------------------------------------------------
function requireStaffAuth(req, res, next) {
  const token = getBearer(req);
  if (!token) return res.status(401).json({ ok: false, error: "missing_auth" });

  // Try unified actor token only (this is the contract for staff tools)
  const payload = tryVerifyJwt(token, process.env.MSS_ACTOR_JWT_SECRET, {
    issuer: "mss-widget-mt",
    audience: "mss-actor",
  });
  if (!payload) return res.status(401).json({ ok: false, error: "invalid_token" });

  const actorType = String(payload.actorType || "").toLowerCase();
  if (actorType !== "admin" && actorType !== "teacher") {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }

  req.actor_ctx = {
    actorType,
    actorId: Number(payload.actorId || 0) || null,
    email: String(payload.email || "").trim().toLowerCase(),
    slug: String(payload.slug || "").trim(),
    schoolId: payload.schoolId ?? null,
    isSuperAdmin: !!payload.isSuperAdmin,
  };

  if (!req.actor_ctx.actorId || !req.actor_ctx.email) {
    return res.status(401).json({ ok: false, error: "missing_actor_ctx" });
  }

  return next();
}

// ---------------------------------------------------------------------
// Enforce school scope for staff tools by slug (simple + deterministic)
// - superadmin bypass
// - otherwise require token.slug === route :slug
// ---------------------------------------------------------------------
function assertStaffSchoolScopeBySlug(req, slug) {
  const ctx = req.actor_ctx;
  if (!ctx) {
    const e = new Error("missing_actor_ctx");
    e.status = 401;
    throw e;
  }

  if (ctx.isSuperAdmin) return; // bypass

  const tokenSlug = String(ctx.slug || "").trim();
  const routeSlug = String(slug || "").trim();

  if (!tokenSlug) {
    const e = new Error("missing_school_scope");
    e.status = 403;
    throw e;
  }

  if (!routeSlug || tokenSlug !== routeSlug) {
    const e = new Error("cross_school_forbidden");
    e.status = 403;
    throw e;
  }
}
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

//const router = express.Router(); //do we need this?
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

//const crypto = require("crypto");


// ---------------------------------------------------------------------
// ADMIN JWT AUTH (Dec 15) deprecated
// ---------------------------------------------------------------------

// const ADMIN_JWT_SECRET = process.env.MSS_ADMIN_JWT_SECRET || "";
// const ADMIN_JWT_TTL = process.env.MSS_ADMIN_JWT_TTL || "12h";

function requireAdminJwtSecret() {
  if (!ADMIN_JWT_SECRET) {
    throw new Error("Missing MSS_ADMIN_JWT_SECRET");
  }
}

//===== Dec 19 manage schools ==========//
//Slugify 2
function slugifyLocal(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "school";
}

// Dec 26 - hash the submission report 
function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

//---------- end manage schools on Dec 19 ---------//

function signAdminToken(admin) {
  requireAdminJwtSecret();

  // IMPORTANT: keep claim names consistent with your middleware
  return jwt.sign(
    {
      aid: Number(admin.adminId),
      email: String(admin.email || "").toLowerCase(),
      isSuperAdmin: !!admin.isSuperAdmin,
      schoolId: admin.schoolId ?? null,
    },
    ADMIN_JWT_SECRET,
    {
      expiresIn: ADMIN_JWT_TTL,
      issuer: "mss-widget-mt",
      audience: "mss-admin",
    }
  );
}

// ---------------------------------------------------------------------
// ACTOR JWT (Unified login for admin/teacher) — Jan 2026
// ---------------------------------------------------------------------

//const ACTOR_JWT_SECRET = process.env.MSS_ACTOR_JWT_SECRET || "";
//const ACTOR_JWT_TTL = process.env.MSS_ACTOR_JWT_TTL || "12h";

function requireActorJwtSecret() {
  if (!ACTOR_JWT_SECRET) {
    throw new Error("Missing MSS_ACTOR_JWT_SECRET");
  }
}

function signActorToken(actor) {
  requireActorJwtSecret();

  return jwt.sign(
    {
      // keep these names stable; your FE/BE can normalize later if needed
      actorType: String(actor.actorType || ""),
      actorId: Number(actor.actorId || 0),
      schoolId: actor.schoolId ?? null,
      slug: String(actor.slug || ""),
      email: String(actor.email || "").toLowerCase(),

      // role flags
      isSuperAdmin: !!actor.isSuperAdmin,
      isOwner: !!actor.isOwner,
      isTeacherAdmin: !!actor.isTeacherAdmin,
    },
    ACTOR_JWT_SECRET,
    {
      expiresIn: ACTOR_JWT_TTL,
      issuer: "mss-widget-mt",
      audience: "mss-actor",
    }
  );
}

function readAdminTokenFromRequest(req) {
  // Preferred: Authorization: Bearer <token>
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();

  // Backward-compatible (avoid these long-term)
  return String(
    req.headers["x-admin-key"] ||
    req.headers["x-mss-admin-key"] ||
    ""
  ).trim();
}

function extractBearer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function getBearer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function tryVerifyJwt(token, secret, opts) {
  try {
    return jwt.verify(token, secret, opts);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------
// DEPRECATED: Legacy “admin ctx” helpers
//
// These exist ONLY to support endpoints that still require email/adminId in
// query/body. The long-term plan is to authorize from req.actor exclusively.
//
// Remove after:
//   - all /api/admin/* endpoints use requireActorAuth + role guards
//   - no endpoint reads req.query.email/adminId for auth
// ---------------------------------------------------------------------

function normalizeAdminCtxFromPayload(payload, mode) {
  if (!payload || typeof payload !== "object") return null;

  const email = String(payload.email || "").trim().toLowerCase();

  // Admin id normalization across token types
  const adminId =
    Number(
      // classic admin JWT: signAdminToken uses "aid"
      payload.aid ??
      payload.adminId ??
      payload.admin_id ??
      // actor JWT: admin actor uses actorId
      (String(payload.actorType || "").toLowerCase() === "admin"
        ? (payload.actorId ?? payload.actorID)
        : null)
    ) || null;

  if (!email || !adminId) return null;

  const isSuperAdmin = !!(
    payload.isSuperAdmin ??
    payload.isSuperadmin ??
    payload.is_superadmin ??
    false
  );

  const schoolId = payload.schoolId ?? payload.school_id ?? null;
  const slug = payload.slug != null ? String(payload.slug).trim() : "";

  return { adminId, email, isSuperAdmin, schoolId, slug, mode };
}
/**
 * Legacy admin ctx support (DEPRECATE).
 *
 * This exists only to keep older pages working during migration.
 * It MUST NOT be used to grant privileges (e.g., superadmin).
 *
 * IMPORTANT:
 * - We do NOT accept isSuperAdmin from query/body (privilege escalation risk).
 * - email/adminId are treated as identifiers only.
 * - Routes that still need authorization must verify via JWT or DB.
 */
function normalizeAdminCtxFromLegacy(req) {
  if (!req) return null;

  // Prefer querystring for GET; allow body as a fallback (some older pages did this).
  const email =
    String(req.query?.email || req.body?.email || "")
      .trim()
      .toLowerCase();

  const adminId =
    Number(
      req.query?.adminId ??
      req.query?.admin_id ??
      req.body?.adminId ??
      req.body?.admin_id ??
      0
    ) || null;

  if (!email || !adminId) return null;

  return {
    adminId,
    email,
    isSuperAdmin: false,  // DO NOT TRUST LEGACY FOR PRIVILEGES
    schoolId: null,
    slug: "",
    mode: "legacy",
  };
}

// helpers you must already have:
// - getBearer(req)
// - tryVerifyJwt(token, secret, opts)
// - normalizeAdminCtxFromLegacy(req)
// - normalizeAdminCtxFromPayload(payload, mode)
// - pool (pg)
// - next(err)

async function resolveSchoolIdFromSlug(slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  const r = await pool.query(`SELECT id FROM schools WHERE slug=$1 LIMIT 1`, [s]);
  return r.rowCount ? Number(r.rows[0].id) : null;
}

function attachAdmin(req, ctx) {
  // normalize school scope aggressively
  const schoolId =
    ctx.schoolId ??
    ctx.school_id ??
    ctx.school?.id ??
    null;

  req.admin_ctx = ctx;
  req.admin = {
    id: ctx.adminId,
    adminId: ctx.adminId,
    email: ctx.email,

    isSuperAdmin: !!ctx.isSuperAdmin,
    is_superadmin: !!ctx.isSuperAdmin,

    // ✅ critical: scope used by assertSchoolScope()
    school_id: schoolId != null ? Number(schoolId) : null,
    schoolId: schoolId != null ? Number(schoolId) : null,
  };
}

async function requireAdminAuth(req, res, next) {
  try {
    // 0) Legacy header support (x-admin-key)
    const legacyKey = String(req.headers["x-admin-key"] || "").trim();
    if (legacyKey) {
      req.adminAuth = { mode: "legacy", key: legacyKey };

      const ctx = normalizeAdminCtxFromLegacy(req);
      if (!ctx) return res.status(401).json({ ok: false, error: "missing_admin_ctx" });

      // If legacy ctx lacks school scope but slug provided, resolve from DB
      if (!ctx.schoolId && !ctx.school_id) {
        const slug = String(req.query.slug || req.body?.slug || "").trim();
        const sid = await resolveSchoolIdFromSlug(slug);
        if (sid) ctx.schoolId = sid;
      }

      attachAdmin(req, ctx);
      return next();
    }

    // 1) Bearer token required
    const token = getBearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "missing_auth" });

    // 2) Try classic admin JWT
    const adminPayload = tryVerifyJwt(token, process.env.MSS_ADMIN_JWT_SECRET, {
      issuer: "mss-widget-mt",
      audience: "mss-admin",
    });

    if (adminPayload) {
      const ctx = normalizeAdminCtxFromPayload(adminPayload, "admin_jwt");
      if (!ctx) return res.status(401).json({ ok: false, error: "missing_admin_ctx" });

      req.adminAuth = { mode: "admin_jwt", payload: adminPayload };

      // If token lacks school scope but slug provided, resolve from DB
      if (!ctx.schoolId && !ctx.school_id) {
        const slug = String(req.query.slug || req.body?.slug || "").trim();
        const sid = await resolveSchoolIdFromSlug(slug);
        if (sid) ctx.schoolId = sid;
      }

      attachAdmin(req, ctx);
      return next();
    }

    // 3) Try unified actor JWT (admin actor)
    const actorPayload = tryVerifyJwt(token, process.env.MSS_ACTOR_JWT_SECRET, {
      issuer: "mss-widget-mt",
      audience: "mss-actor",
    });

    if (actorPayload && String(actorPayload.actorType || "").toLowerCase() === "admin") {
      const ctx = normalizeAdminCtxFromPayload(actorPayload, "actor_jwt");
      if (!ctx) return res.status(401).json({ ok: false, error: "missing_admin_ctx" });

      req.adminAuth = { mode: "actor_jwt", payload: actorPayload };

      // If token lacks school scope but slug provided, resolve from DB
      if (!ctx.schoolId && !ctx.school_id) {
        const slug = String(req.query.slug || req.body?.slug || "").trim();
        const sid = await resolveSchoolIdFromSlug(slug);
        if (sid) ctx.schoolId = sid;
      }

      attachAdmin(req, ctx);
      return next();
    }

    return res.status(401).json({ ok: false, error: "invalid_token" });
  } catch (err) {
    return next(err);
  }
}
// ---------------------------------------------------------------------

// --- Widget image uploads ---
const uploadDir = path.join(__dirname, "uploads", "widget-images");

// ----- Core app / paths -----

const PORT = process.env.PORT || 3000;

const app = express();


// ------------------------------------------------------------
// EMAIL (Nodemailer) support (shared)
// ------------------------------------------------------------


const SMTP_FROM = process.env.SMTP_FROM || "Chris <chris@myspeakingscore.com>";

const smtpHost = (process.env.SMTP_HOST || "").trim();
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpUser = (process.env.SMTP_USER || "").trim();
const smtpPass = (process.env.SMTP_PASS || "").trim();

// If SMTP_SECURE explicitly set, respect it; otherwise infer from port 465.
const smtpSecure =
  String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || smtpPort === 465;

const mailTransporter =
  smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: smtpUser, pass: smtpPass },
      })
    : null;

if (!mailTransporter) {
  console.warn("[SMTP] Missing SMTP_HOST/SMTP_USER/SMTP_PASS. Email sending disabled.");
}

async function sendMailSafe({ to, subject, html, text }) {
  if (!mailTransporter) {
    return { ok: false, skipped: true, message: "SMTP not configured" };
  }
  try {
    const info = await mailTransporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
    });
    return { ok: true, info };
  } catch (err) {
    console.error("[SMTP] sendMail failed:", err);
    return { ok: false, error: err?.message || String(err) };
  }
}

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = path.join(ROOT, "public");
const THEMES_DIR = path.join(ROOT, "themes");



// ---------- CORS MIDDLEWARE (Render ↔ Vercel) ----------
const allowedOrigins = [
  // --- Production domains ---
  "https://mss-widget-mt.vercel.app",
  "https://mss-widget-mt.onrender.com",

  // ESL Success Club (prod)
  "https://eslsuccess.club",
  "https://www.eslsuccess.club",

  // --- Local development ---
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",

  // --- Vercel preview deployments (wildcard) ---
  /^https:\/\/mss-widget-mt-.*\.vercel\.app$/,
];
// ---------------------------------------------------------------------
// CORS — supports exact + wildcard patterns from CORS_ORIGIN (CSV)
// Notes for peer review:
// - DEFAULT_ALLOWED_ORIGINS covers local + known deployments.
// - CORS_ORIGIN (CSV) augments defaults; keep defaults to avoid "works locally only".
// - Wildcards support patterns like: https://mss-widget-mt-*.vercel.app
// ---------------------------------------------------------------------

function parseAllowedOrigins(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "https://mss-widget-mt.vercel.app",
  "https://mss-widget-mt.onrender.com",
  "https://eslsuccess.club",
  "https://www.eslsuccess.club",
];

// Env augment (CSV). Example: CORS_ORIGIN="https://foo.com,https://bar.com,https://mss-widget-mt-*.vercel.app"
const ENV_ORIGINS = parseAllowedOrigins(process.env.CORS_ORIGIN);

// Single source of truth (deduped)
const ALLOWED_ORIGINS = Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...ENV_ORIGINS]));

function originMatches(allowed, origin) {
  if (!allowed || !origin) return false;
  if (allowed === origin) return true;

  // Wildcard support
  if (allowed.includes("*")) {
    // Escape regex special chars, then turn '*' into '.*'
    const escaped = allowed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$", "i");
    return re.test(origin);
  }

  return false;
}

function isAllowedOrigin(origin) {
  // No Origin header: allow (curl, server-to-server, same-origin in some cases)
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((a) => originMatches(a, origin));
}

// Keep allowedHeaders aligned to what your FE actually sends.
// NOTE: We include Authorization + legacy headers for migration.
const CORS_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-admin-key",
  "x-mss-admin-key",
];

// IMPORTANT: When credentials=true, origin cannot be '*'.
// We echo back the request origin if it is in our allowlist.
const corsOptions = {
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    console.warn("[CORS] Blocked origin:", origin, "Allowed:", ALLOWED_ORIGINS);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: CORS_ALLOWED_HEADERS,
  maxAge: 86400,
};

// Apply once (single source of truth)
app.use(cors(corsOptions));

// Preflight handler — keep explicit to avoid edge cases with some proxies.
// (If you later confirm all environments handle preflight cleanly, this can be simplified.)
// NOTE: Express route patterns can be picky; use a regex to catch all.
app.options(/.*/, cors(corsOptions));

// ---------------------------------------------------------------------
// Body parsers (single source of truth)
// ---------------------------------------------------------------------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------

// Uploaded assets
app.use("/uploads", express.static(UPLOADS_DIR));
// Public assets (single mount)
app.use(express.static(PUBLIC_DIR));

// Themes
// DE-DUPE: only mount /themes once. Prefer THEMES_DIR if it exists; otherwise fallback to PUBLIC_DIR/themes.
// NOTE: If THEMES_DIR is always the canonical location now, you can remove the fallback.
app.use(
  "/themes",
  express.static(THEMES_DIR || path.join(PUBLIC_DIR, "themes"))
);

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

// In-memory storage for branding logos
const logoUpload = multer({ storage: multer.memoryStorage() });

// POST /api/admin/branding/:slug/logo
app.post(
  "/api/admin/branding/:slug/logo",
  logoUpload.single("image"),           // field *must* be "image"
  async (req, res) => {
    const { slug } = req.params;

    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "NO_FILE",
          message: "No image uploaded",
        });
      }

      // 1) Look up school
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

      const buffer     = req.file.buffer; // raw image bytes
      const filename   = req.file.originalname || `${slug}-logo`;
      const mimeType   = req.file.mimetype || "image/png";
      const sizeBytes  = req.file.size ?? (buffer ? buffer.length : null);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 2) Insert branding_files row
        const insertRes = await client.query(
          `
          INSERT INTO branding_files (
            school_id,
            kind,
            filename,
            mime_type,
            size_bytes,
            bytes
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
          `,
          [schoolId, "logo", filename, mimeType, sizeBytes, buffer]
        );

        const fileId = insertRes.rows[0].id;

        // 3) Point school at this logo
        await client.query(
          `
          UPDATE schools
             SET branding_logo_id = $2
           WHERE id = $1
          `,
          [schoolId, fileId]
        );

        await client.query("COMMIT");

        const url = `/api/admin/branding/${encodeURIComponent(
          slug
        )}/logo`;

        return res.json({
          ok: true,
          fileId,
          url,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Logo upload DB error:", err);
        return res.status(500).json({
          ok: false,
          error: "UPLOAD_DB_FAILED",
          message: err.message || "Failed to save logo.",
        });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("❌ Logo upload handler error:", err);
      return res.status(500).json({
        ok: false,
        error: "UPLOAD_FAILED",
        message: err.message || "Logo upload failed.",
      });
    }
  }
);

// GET /api/admin/branding/:slug/logo
app.get("/api/admin/branding/:slug/logo", async (req, res) => {
  const { slug } = req.params;

  try {
    const schoolRes = await pool.query(
      `
      SELECT id, branding_logo_id
      FROM schools
      WHERE slug = $1
      LIMIT 1
      `,
      [slug]
    );

    if (!schoolRes.rowCount) {
      return res.status(404).send("School not found");
    }

    const schoolId   = schoolRes.rows[0].id;
    const logoFileId = schoolRes.rows[0].branding_logo_id;

    if (!logoFileId) {
      return res.status(404).send("Logo not set");
    }

    const fileRes = await pool.query(
      `
      SELECT mime_type, bytes
      FROM branding_files
      WHERE id = $1 AND school_id = $2
      LIMIT 1
      `,
      [logoFileId, schoolId]
    );

    if (!fileRes.rowCount) {
      return res.status(404).send("Logo not found");
    }

    const row = fileRes.rows[0];

    res.setHeader("Content-Type", row.mime_type || "image/png");
    res.send(row.bytes);
  } catch (err) {
    console.error("❌ GET /api/admin/branding/:slug/logo error:", err);
    res.status(500).send("Server error");
  }
});

// OpenAI Helper
// Small helper: safely extract the final text Dec 26
// ---- OpenAI (Responses API) -----------------------------------

async function openAiGenerateReport({ promptText, model = "gpt-4o-mini", temperature = 0.4, max_output_tokens = 900 }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  if (!promptText || !String(promptText).trim()) throw new Error("promptText is required");

  const timeoutMs = 25000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);



  try {
    console.log("[AI] OpenAI request starting", { model, temperature, max_output_tokens, chars: String(promptText).length });

    const response = await openai.responses.create(
      {
        model,
        input: promptText,
        temperature,
        max_output_tokens,
      },
      {
        signal: controller.signal,
      }
    );

    const text = (response.output_text || "").trim();
    console.log("[AI] OpenAI response received", { chars: text.length });

    if (!text) throw new Error("Empty response from OpenAI");

    return {
      text,
      // Useful if you want it later:
      // response_id: response.id,
      // usage: response.usage,
      model,
      temperature,
      max_output_tokens,
    };
  } finally {
    clearTimeout(t);
  }
}
// Helper: normalize transcript text into a clean single-line string
function renderPromptTemplate(template, vars = {}) {
  let t = String(template || "");

  const isPresent = (val) => {
    if (val === null || val === undefined) return false;
    return String(val).trim().length > 0;
  };

  // {{#if key}} ... {{/if}}
  const ifRe = /\{\{\s*#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;

  let guard = 0;
  while (guard++ < 25) {
    ifRe.lastIndex = 0;            // IMPORTANT: reset for global regex
    if (!ifRe.test(t)) break;      // no more if-blocks

    t = t.replace(ifRe, (_, key, body) => {
      const v = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
      return isPresent(v) ? body : "";
    });
  }

  // {{key}}
  t = t.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
    return v === null || v === undefined ? "" : String(v);
  });

  // Keep Markdown readability; only collapse excessive blank lines
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  return t;
}

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
    // ------------------------------------------------------------
    let payload = req.body?.submission || req.body || {};

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
    // 1) Resolve school
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
    // 2) Extract widget-side metadata
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
    // 3) MSS / Vox results (OPTIONAL)
    // ------------------------------------------------------------
    let mss =
      payload.mss ??
      payload.meta ??
      payload.results ??
      null;

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

    // ✅ Always derive transcript from either MSS or payload
    let transcriptRaw =
      (mss && typeof mss === "object" ? (mss.transcript ?? null) : null) ??
      payload.transcript ??
      null;

    let transcriptClean = cleanTranscriptText(transcriptRaw);

    let mss_fluency      = null;
    let mss_grammar      = null;
    let mss_pron         = null;
    let mss_vocab        = null;
    let mss_cefr         = null;
    let mss_toefl        = null;
    let mss_ielts        = null;
    let mss_pte          = null;

    if (mss && typeof mss === "object") {
      voxScore =
        (typeof mss.score === "number" ? mss.score : null) ??
        (typeof mss.overall_score === "number" ? mss.overall_score : null) ??
        (typeof mss.overall?.score === "number" ? mss.overall.score : null) ??
        null;

      const elsa   = mss.elsa_results || mss.elsa || {};
      const scores = mss.scores || mss.details || {};

      mss_fluency = elsa.fluency ?? scores.fluency ?? null;
      mss_grammar = elsa.grammar ?? scores.grammar ?? null;
      mss_pron    = elsa.pronunciation ?? scores.pronunciation ?? null;
      mss_vocab   = elsa.vocabulary ?? scores.vocabulary ?? null;

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

    const meta = mss || null;

    // ✅ WPM: duration + compute
    const length_sec = extractDurationSec(payload, mss);
    const wpm = computeWpm(transcriptClean, length_sec);

    // ------------------------------------------------------------
    // 4) INSERT submission row
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
        question_id,
        length_sec,
        wpm
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27
      )
      RETURNING id
    `;

    const insertParams = [
      schoolId,          // $1
      questionTxt,       // $2
      studentId,         // $3
      toefl,             // $4
      ielts,             // $5
      pte,               // $6
      cefr,              // $7
      transcriptRaw,     // $8
      meta,              // $9
      null,              // $10 mss_overall not used yet
      mss_fluency,       // $11
      mss_grammar,       // $12
      mss_pron,          // $13
      mss_vocab,         // $14
      mss_cefr,          // $15
      mss_toefl,         // $16
      mss_ielts,         // $17
      mss_pte,           // $18
      voxScore,          // $19
      transcriptClean,   // $20
      help_level,        // $21
      help_surface,      // $22
      widget_variant,    // $23
      dashboard_variant, // $24
      questionId,        // $25
      length_sec,        // $26 ✅
      wpm                // $27 ✅
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
      length_sec,
      wpm,
      dashboardUrl
    });

    return res.json({
      ok: true,
      submissionId,
      dashboardUrl,
      // Optional: return computed metrics for immediate UI/debug visibility
      length_sec,
      wpm
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
      SELECT
        submission_id AS id,
        submitted_at,
        school_slug,
        school_name,
        student_id,
        student_email,
        question,
        wpm,
        toefl,
        ielts,
        pte,
        cefr,
        vox_score,
        mss_overall,
        mss_fluency,
        mss_grammar,
        mss_pron,
        mss_vocab,
        mss_cefr,
        mss_toefl,
        mss_ielts,
        mss_pte,
        transcript_clean
      FROM vw_widget_reports
      WHERE school_slug = $1
      ORDER BY submitted_at DESC
      LIMIT $2
    `;

    const result = await pool.query(sql, [slug, limit]);

    return res.json({
      ok: true,
      tests: result.rows,
    });
  } catch (err) {
    console.error("❌ /api/admin/reports error:", err);
    return res.status(500).json({
      ok: false,
      error: "reports_failed",
      message: err.message,
    });
  }
});

//================= API request handler =====================//

app.post("/api/admin/ai-report/:id", async (req, res) => {
  try {
    const submissionId = Number(req.params.id);
    if (!submissionId) {
      return res.status(400).json({ ok: false, error: "bad_id" });
    }

    // Pull what you need to build a good prompt
    const q = `
      SELECT
        submission_id AS id,
        submitted_at,
        school_slug,
        school_name,
        student_id,
        student_email,
        question,
        wpm,
        mss_fluency,
        mss_grammar,
        mss_pron,
        mss_vocab,
        mss_cefr,
        mss_toefl,
        mss_ielts,
        mss_pte,
        transcript_clean
      FROM vw_widget_reports
      WHERE submission_id = $1
      LIMIT 1
    `;
    const r = await pool.query(q, [submissionId]);
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const row = r.rows[0];

    const safe = (v, fb = "N/A") =>
      v === null || v === undefined || v === "" ? fb : v;

    const defaultGoal =
      "reach a level of English that is strong enough for full-time work, admission to a college or university program, and higher scores on tests like TOEFL, IELTS, or PTE.";

    const promptText = `
Act as an experienced English tutor speaking directly to a student who has just completed a speaking task on the topic:

"${safe(row.question, "Not specified")}"

Student: ${safe(row.student_email || row.student_id, "Unknown student")}

Here are this student's MSS speaking results:
- Speed: ${safe(row.wpm, "N/A")} words per minute
- Fluency: ${safe(row.mss_fluency)} / 100
- Pronunciation: ${safe(row.mss_pron)} / 100
- Grammar: ${safe(row.mss_grammar)} / 100
- Vocabulary: ${safe(row.mss_vocab)} / 100
- Overall level: CEFR ${safe(row.mss_cefr)}
- Estimated TOEFL Speaking: ${safe(row.mss_toefl)} / 30
- Estimated IELTS Speaking: ${safe(row.mss_ielts)} / 9
- Estimated PTE Speaking: ${safe(row.mss_pte)} / 100

Transcript (what the student said):
"${safe(row.transcript_clean, "")}"

The student's general goal is to ${defaultGoal}

Please do TWO things:

1) FEEDBACK REPORT
Write a structured feedback report directly to the student in the second person ("you"), in English.
Include:
- Relevance of the answer to the question - is it logical and concise?
- A short overall summary (2–3 sentences) of what these results mean.
- 2–3 clear strengths.
- 3–5 key areas for improvement, focusing especially on the lowest scores.
- Concrete practice suggestions the student can start this week.

2) EMAIL TO THE STUDENT
Write a separate email that a teacher at the school could send to this student.
The email should:
- Have a short, clear subject line.
- Greet the student politely.
- Briefly summarize their current level using simple language.
- Invite them to sign up for lessons, a consultation, or a short trial.

Tone: warm, encouraging, and professional.
`.trim();
// Check - do we have this one already?

   const promptHash = sha256(promptText);

    // 1) If report already exists for this submission, return it (no API call)
      const existing = await pool.query(
       `SELECT report_text
        FROM ai_reports
        WHERE submission_id = $1
        LIMIT 1`,
       [submissionId]
    );

    if (existing.rowCount) {
        console.log("[AI] cache hit", { submissionId });
        return res.json({ ok: true, reportText: existing.rows[0].report_text, source: "cache" });
      }

     // 2) Otherwise generate + store
      console.log("[AI] cache miss → generating", { submissionId });

     const ai = await openAiGenerateReport({
       promptText,
       model: "gpt-4o-mini",
       temperature: 0.4,
       max_output_tokens: 900
    });

   const reportText = ai.text;

    // save (create once)
    await pool.query(
      `INSERT INTO ai_reports (submission_id, prompt_hash, model, temperature, max_output_tokens, report_text)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [submissionId, promptHash, ai.model, ai.temperature, ai.max_output_tokens, reportText]
    );

     return res.json({ ok: true, reportText, source: "openai" });


   

    // and when saving:
    model = ai.model; temperature = ai.temperature; max_output_tokens = ai.max_output_tokens;

    return res.json({
      ok: true,
      reportText,
    });
  } catch (err) {
    console.error("❌ /api/admin/ai-report failed:", err);
    return res.status(500).json({
      ok: false,
      error: "ai_report_failed",
      message: err.message || "AI report failed",
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

// ------------ WPM helper  ---------------------//

function extractDurationSec(payload = {}) {
  // Prefer explicit duration fields if present
  const direct =
    payload.length_sec ??
    payload.lengthSec ??
    payload.duration_sec ??
    payload.durationSec ??
    payload.audio_seconds ??
    payload.audioSeconds ??
    null;

  if (direct != null && !Number.isNaN(Number(direct))) return Number(direct);

  // Fall back to meta JSON
  const m = payload.meta || payload.mss_json || payload.mss || {};
  const metaVal =
    m.length_sec ??
    m.lengthSec ??
    m.duration_sec ??
    m.durationSec ??
    m.audio_seconds ??
    m.audioSeconds ??
    null;

  if (metaVal != null && !Number.isNaN(Number(metaVal))) return Number(metaVal);

  return null;
}

// API Log helper

async function logApiUsage({ schoolId, submissionId = null, studentId = null, apiType, apiAction = null, meta = {} }) {
  try {
    await pool.query(
      `
      INSERT INTO api_usage_log (school_id, submission_id, student_id, api_type, api_action, meta)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [schoolId, submissionId, studentId, apiType, apiAction, meta]
    );
  } catch (e) {
    console.warn("[api-usage] log failed (non-fatal):", e);
  }
}

//Dec 26 - allowing for spaces in our word count

function computeWpm(transcript, durationSec) {
  const dur = Number(durationSec);
  if (!dur || dur <= 0) return null;

  // Normalize text
  let t = String(transcript || "");

  // Remove zero-width/invisible chars that get tokenized as "words"
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return null;

  // Count words (Unicode letters/numbers, allowing apostrophes/hyphens inside a word)
  const m = t.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu);
  const words = m ? m.length : 0;
  if (!words) return null;

  return Math.round((words / dur) * 60);
}

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

// =====================================================================
// SCHOOL SIGNUP + VERIFY (Pending -> Provision -> Promote Admin)
// =====================================================================

/**
 * Finalize a pending signup row:
 * - provisions a new school via SP
 * - creates/updates admin row (admins table uses "schoolId")
 * - optionally links admin_schools (if table exists)
 * - deletes pending_signups row
 *
 * Returns: { schoolId, adminId, slug, adminEmail }
 */
async function finalizePendingSignup(client, pending) {
  const payload = pending.payload || {};

  const schoolName = pending.school_name;
  const adminEmailRaw = pending.admin_email || payload.contactEmail || "";
  const adminEmail = String(adminEmailRaw).trim().toLowerCase();

  const adminName =
    pending.admin_name ||
    payload.contactName ||
    payload.adminName ||
    "Admin";

  const passwordHash = payload.passwordHash;

  const slug =
  payload.slug ||
  slugifyPkg(schoolName || "new-school", { lower: true, strict: true, trim: true });

  if (!schoolName || !adminEmail || !passwordHash) {
    throw new Error("Pending signup is missing required fields (schoolName/adminEmail/passwordHash).");
  }

  const sourceSlug = payload.sourceSlug || "mss-demo";

  // 1) Provision school
  const spResult = await client.query(
    "SELECT mss_provision_school_from_slug($1, $2, $3) AS school_id",
    [slug, schoolName, sourceSlug]
  );

  const newSchoolId = spResult.rows?.[0]?.school_id;
  if (!newSchoolId) {
    throw new Error("Stored procedure did not return school_id");
  }

 // 2) Upsert admin (admins schema: school_id, email, full_name, password_hash, is_owner, is_active, is_superadmin)
let adminId;

// Find by email (assumes email is unique in admins, which is what your code already implies)
const existingAdmin = await client.query(
  `
    SELECT id
    FROM admins
    WHERE lower(email) = lower($1)
      AND school_id = $2
    LIMIT 1
  `,
  [adminEmail, newSchoolId]
);

if (existingAdmin.rows.length > 0) {
  adminId = existingAdmin.rows[0].id;

  // repair-safe: ensure linkage + keep values current
 await client.query(
  `
    UPDATE admins
    SET full_name = COALESCE(NULLIF(full_name, ''), $1),
        password_hash = COALESCE(password_hash, $2),
        is_active = true
    WHERE id = $3
  `,
  [adminName, passwordHash, adminId]
);

} else {
  const insAdmin = await client.query(
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
      VALUES ($1, $2, $3, $4, true, true, false)
      RETURNING id
    `,
    [newSchoolId, adminEmail, adminName, passwordHash]
  );
  adminId = insAdmin.rows[0].id;
}
  // 3) Optional: keep admin_schools link (safe if table exists & has proper unique constraint)
  // If you don't need it, you can remove this block.
  try {
    await client.query(
      `
        INSERT INTO admin_schools (admin_id, school_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [adminId, newSchoolId]
    );
  } catch (e) {
    // If admin_schools isn't present or schema differs, don't break finalize
    console.warn("[finalizePendingSignup] admin_schools link skipped:", e.message);
  }

  // 4) Delete pending row
  await client.query("DELETE FROM pending_signups WHERE id = $1", [pending.id]);

  return { schoolId: newSchoolId, adminId, slug, adminEmail };
}

// ---------------------------------------------------------------------
// School sign-up: create pending record + send verification email
// Supports Super Admin auto-confirm:
//   - if sendConfirmationEmail === false OR autoConfirm === true, finalize immediately
// ---------------------------------------------------------------------
app.post("/api/school-signup", async (req, res) => {
  try {
    const body = req.body || {};

    const {
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
      adminPassword,

      // ✅ super admin flags (from SchoolSignUp.js)
      sendConfirmationEmail,
      autoConfirm,
      skipEmailVerification,

      // optional overrides
      sourceSlug,
      slug,
    } = body;

    // ---- basic validation ----
    if (!schoolName || !websiteUrl || !country || !contactName || !contactEmail || !adminPassword) {
      return res.status(400).json({
        ok: false,
        error: "validation_error",
        message: "Please fill in all required fields.",
      });
    }

    // normalise
    const teacherCountNum =
      typeof teacherCount === "string" ? parseInt(teacherCount, 10) : (teacherCount ?? null);

    const testsPerMonthNum =
      typeof testsPerMonth === "string" ? parseInt(testsPerMonth, 10) : (testsPerMonth ?? null);

    const examsArray = Array.isArray(exams) ? exams : (exams ? [exams] : []);

    const cleanSlug =
      (slug && String(slug).trim()) ||
      slugify(schoolName, { lower: true, strict: true, trim: true }) ||
      "new-school";

    const token = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const adminEmail = String(contactEmail).trim().toLowerCase();
    const adminName = String(contactName).trim();

    const payload = {
      slug: cleanSlug,
      websiteUrl,
      country,
      timeZone: timeZone || null,
      contactName,
      contactEmail: adminEmail,
      roleTitle,
      teacherCount: teacherCountNum,
      heard: heard || null,
      programDescription,
      exams: examsArray,
      testsPerMonth: testsPerMonthNum,
      anonymousFunnel: anonymousFunnel || "yes",
      funnelUrl: funnelUrl || null,
      notes: notes || null,

      passwordHash,               // used by finalize
      sourceSlug: sourceSlug || "mss-demo",

      // keep flags for traceability (optional)
      sendConfirmationEmail: sendConfirmationEmail !== false,
      autoConfirm: !!autoConfirm,
      skipEmailVerification: !!skipEmailVerification,
    };

    // create pending row
    await pool.query(
      `
        INSERT INTO pending_signups (admin_email, admin_name, school_name, token, payload)
        VALUES ($1, $2, $3, $4, $5::jsonb)
      `,
      [adminEmail, adminName, schoolName, token, payload]
    );

    // If super-admin chose "No email" or requested autoConfirm, finalize immediately
    const shouldAutoConfirm =
      autoConfirm === true || sendConfirmationEmail === false || skipEmailVerification === true;

    if (shouldAutoConfirm) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const pendingRes = await client.query(
          `SELECT * FROM pending_signups WHERE token = $1 FOR UPDATE`,
          [token]
        );
        if (!pendingRes.rowCount) throw new Error("Pending signup row not found after insert.");

        const out = await finalizePendingSignup(client, pendingRes.rows[0]);

        await client.query("COMMIT");

        return res.json({
          ok: true,
          autoConfirmed: true,
          schoolId: out.schoolId,
          adminId: out.adminId,
          slug: out.slug,
          adminEmail: out.adminEmail,
          message: "Done. The school was created as CONFIRMED (no verification email sent).",
        });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[school-signup] autoConfirm finalize failed:", e);
        return res.status(500).json({
          ok: false,
          error: "finalize_failed",
          message: e.message || "Internal error finalizing signup.",
        });
      } finally {
        client.release();
      }
    }

    // otherwise, email verification flow
    const publicBase = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
    const verifyUrl = `${publicBase}/signup/VerifySignup.html?token=${encodeURIComponent(token)}`;

    const mailOptions = {
      from: `"MySpeakingScore" <${smtpUser}>`,
      to: adminEmail,
      subject: "Confirm your MySpeakingScore school sign-up",
      html: `
        <p>Hi ${adminName || "there"},</p>
        <p>We received a request to set up a <strong>MySpeakingScore school portal</strong> for:</p>
        <p><strong>${schoolName}</strong></p>
        <p>To confirm that this request is really from you, please click the button below:</p>
        <p>
          <a href="${verifyUrl}"
             style="display:inline-block;padding:10px 18px;background:#0053ff;color:#ffffff;
                    text-decoration:none;border-radius:4px;font-weight:600;">
             Confirm my email
          </a>
        </p>
        <p>If the button doesn’t work, copy and paste this link into your browser:</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      `,
    };

    try {
      await mailTransporter.sendMail(mailOptions);
    } catch (mailErr) {
      console.error("[school-signup] email error:", mailErr);
      // pending record exists; client can still verify via token URL if delivered by other means
    }

    return res.json({
      ok: true,
      message: "Signup received. Please check your email to confirm.",
    });
  } catch (err) {
    console.error("[school-signup] failed:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Could not submit sign-up. Please try again later.",
    });
  }
});

// ---------------------------------------------------------------------
// VERIFY SCHOOL SIGN-UP (SP-only finalize)
// POST /api/school-signup/verify { token }
// ---------------------------------------------------------------------
app.post("/api/school-signup/verify", async (req, res) => {
  const token = String(req.body?.token || "").trim();

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

    const { rows } = await client.query(
      `
      SELECT *
      FROM pending_signups
      WHERE token = $1
      FOR UPDATE
      `,
      [token]
    );

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "invalid_token",
        message: "Signup record not found.",
      });
    }

    const p = rows[0];

    // Basic lifecycle checks
    if (p.used_at) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "token_used",
        message: "This verification link has already been used.",
      });
    }

    if (p.expires_at && new Date(p.expires_at).getTime() < Date.now()) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "token_expired",
        message: "This verification link has expired. Please sign up again.",
      });
    }

    // Core fields from columns
    const schoolName = String(p.school_name || "").trim();
    const adminEmail = String(p.admin_email || "").trim().toLowerCase();
    const adminFullName = String(p.admin_name || "").trim();

    // payload is JSONB; pg returns as object already (usually),
    // but we defensively parse if it arrives as a string.
    let payload = p.payload || {};
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }

    // Pull required SP inputs from payload
    // We accept a few key variants so you don’t get brittle failures.
    const passwordHash =
      String(payload.passwordHash || payload.password_hash || "").trim();

    const sourceSlug =
      String(payload.sourceSlug || payload.source_slug || "mss-demo").trim() || "mss-demo";

    // Optional: a preferred slug stored in payload (else we generate)
    const preferredSlug =
      String(payload.slug || payload.schoolSlug || "").trim();

    if (!schoolName || !adminEmail || !adminFullName || !passwordHash) {
      throw new Error(
        `Pending signup missing required fields. ` +
        `schoolName=${!!schoolName}, adminEmail=${!!adminEmail}, adminFullName=${!!adminFullName}, passwordHash=${!!passwordHash}`
      );
    }

    // Slug strategy: prefer payload.slug if present, else derive from schoolName.
    const baseSlug =
      normalizeSlug(preferredSlug || schoolName) || "new-school";

    // IMPORTANT: ensureUniqueSlug currently takes (baseSlug, pool).
    // For transactional safety, it’s better to use client. If your helper only accepts pool,
    // either update it to accept client OR use a collision-proof slug here.
    //
    // Option A (recommended): update ensureUniqueSlug to accept a queryable client
    const slug = await ensureUniqueSlug(baseSlug, client);

    // SP-only write
    const sp = await client.query(
      `SELECT * FROM public.mss_provision_school_with_admin($1,$2,$3,$4,$5,$6)`,
      [slug, schoolName, adminEmail, adminFullName, passwordHash, sourceSlug]
    );

    const out = sp.rows?.[0] || {};
    const schoolId = out.school_id;
    const adminId = out.admin_id;

    if (!schoolId || !adminId) {
      throw new Error(`Unexpected SP output: ${JSON.stringify(out)}`);
    }

    // Mark token as used (do NOT delete unless you want zero audit trail)
    await client.query(
      `
      UPDATE pending_signups
      SET used_at = NOW(),
          verified_at = COALESCE(verified_at, NOW()),
          status = 'provisioned'
      WHERE id = $1
      `,
      [p.id]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      schoolId,
      adminId,
      slug,
      adminEmail,
      message:
        "Your MySpeakingScore school has been created. You can now sign in to your admin portal with your email and password.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[school-signup/verify] failed:", err);

    return res.status(500).json({
      ok: false,
      error: "verify_failed",
      message: err.message || "Internal error while creating your school.",
      code: err.code || null,
    });
  } finally {
    client.release();
  }
});
// ---------------------------------------------------------------------
// List admins for a given school (by slug)
// GET /api/admin/school/:slug/admins
// ---------------------------------------------------------------------
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

    // ✅ actual schema (admins uses "schoolId")
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

// ----------------------
// Slug helpers
// ----------------------
function normalizeSlug(nameOrSlug) {
  if (!nameOrSlug) return "";
  return slugifyPkg(nameOrSlug, { lower: true, strict: true, trim: true });
}

async function ensureUniqueSlug(baseSlug, db) {
  let candidate = baseSlug || "school";
  let suffix = 1;

  while (true) {
    const { rows } = await db.query(
      `
      SELECT 1 FROM schools WHERE slug = $1
      UNION ALL
      SELECT 1 FROM pending_signups
      WHERE payload->>'slug' = $1
      LIMIT 1
      `,
      [candidate]
    );

    if (!rows.length) return candidate;

    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
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

function httpError(status, message) {
  const e = new Error(message || "error");
  e.status = status;
  return e;
}

// Normal admin: must match schoolId exactly.
// Superadmin: always allowed.

function assertSchoolScope(req, requiredSchoolId) {
  const admin = req.admin;
  if (!admin) {
    const err = new Error("missing_admin_context");
    err.status = 401;
    throw err;
  }

  // Tolerant superadmin bypass
  const isSuper = !!(
    admin.is_superadmin === true ||
    admin.isSuperadmin === true ||
    admin.isSuperAdmin === true ||
    admin.superadmin === true
  );
  if (isSuper) return true;

  const tokenSchoolId = Number(admin.school_id || 0);
  const need = Number(requiredSchoolId || 0);

  if (!tokenSchoolId) {
    const err = new Error("missing_school_scope");
    err.status = 403;
    throw err;
  }

  if (!need) {
    console.error("[SCOPE] bad_required_school_id", {
      url: req.originalUrl,
      requiredSchoolId,
      tokenSchoolId,
      adminKeys: Object.keys(admin || {}),
    });
    const err = new Error("bad_required_school_id");
    err.status = 400; // was 500
    throw err;
  }

  if (tokenSchoolId !== need) {
    const err = new Error("forbidden_school_scope");
    err.status = 403;
    err.debug = { tokenSchoolId, need };
    throw err;
  }

  return true;
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


// ---------------------------------------------------------------------
// List available widget layouts in /public/widgets
// ---------------------------------------------------------------------
app.get("/api/widgets", (req, res) => {
  try {
    const widgetsDir = path.join(__dirname, "public", "widgets");

    fs.readdir(widgetsDir, (err, files) => {
      if (err) {
        console.error("Error reading widgets directory:", err);
        return res.status(500).json({
          ok: false,
          error: "fs_error",
          message: "Unable to list widget layouts.",
        });
      }

      const widgets = files
        .filter((f) => f.toLowerCase().endsWith(".html"))
        .filter((f) => !f.startsWith(".")); // ignore .DS_Store etc.

      return res.json({
        ok: true,
        widgets, // ["Widget.html","Widget3.html","WidgetMin.html",...]
      });
    });
  } catch (err) {
    console.error("Unexpected /api/widgets error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Unable to list widget layouts.",
    });
  }
});

// ---------------------------------------------------------------------
// List available widget HTML templates from /public/widgets
// Used by ConfigAdmin widget layout dropdown Dec 10
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// List available widget templates from /public/widgets
// ---------------------------------------------------------------------
app.get("/api/admin/widgets", async (req, res) => {
  try {
    const widgetsDir = path.join(PUBLIC_DIR, "widgets");
    console.log("[widgets] listing directory:", widgetsDir);

    // If the dir doesn't exist, return an empty list gracefully
    if (!fsSync.existsSync(widgetsDir)) {
      console.warn("[widgets] directory does not exist:", widgetsDir);
      return res.json({ widgets: [] });
    }

    const entries = await fs.readdir(widgetsDir, { withFileTypes: true });

    const widgets = entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.toLowerCase().endsWith(".html")
      )
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    console.log("[widgets] found templates:", widgets);
    return res.json({ widgets });
  } catch (err) {
    console.error("Error listing widgets:", err);
    return res.status(500).json({
      ok: false,
      error: "widgets_list_error",
      message: err.message,
    });
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
        AND is_public = true
        ORDER BY ord ASC, id ASC
      `,
      [assessmentId]
    );

    const questions = qRes.rows.map((r) => ({
      id: r.id,
      question: r.question,
      slug: String(r.id),
    }));

      // 4) Image / logo
    const uploadedImageUrl =
      settings.image && typeof settings.image.url === "string"
        ? settings.image.url
        : null;

    let imageUrl = null;

    // 4a) New DB-backed branding logo
    if (school.branding_logo_id) {
      imageUrl = `/api/admin/branding/${encodeURIComponent(slug)}/logo`;
    }

    // 4b) Fallback to settings.image.url if present
    if (!imageUrl && uploadedImageUrl) {
      imageUrl = uploadedImageUrl;
    }

    // 4c) Legacy school_assets fallback
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
    return res.status(400).json({ questions: [], error: "Invalid assessmentId" });
  }

  try {
    const sql = `
      SELECT
        q.id,
        q.question,
        q.position AS sort_order,
        q.is_public,
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
        is_public: r.is_public,          // NEW
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
    return res.status(400).json({ success: false, error: "Invalid assessmentId" });
  }

  const questions = Array.isArray(req.body.questions) ? req.body.questions : [];
  if (!questions.length) {
    return res.status(400).json({ success: false, error: "No questions provided" });
  }

  // Default TRUE unless explicitly false
  const normalizeIsPublic = (v) => (v === false ? false : true);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const assessRow = await client.query(
      `SELECT school_id FROM assessments WHERE id = $1`,
      [assessmentId]
    );
    if (!assessRow.rowCount) throw new Error(`Assessment ${assessmentId} not found`);
    const schoolId = assessRow.rows[0].school_id;

    const incomingIds = questions
      .map((q) => (q.id != null ? Number(q.id) : null))
      .filter((id) => Number.isFinite(id) && id > 0);

    // 1) Update existing questions
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      if (!q.id) continue;

      const text = (q.question || "").toString().trim();
      const order = idx + 1;
      const isPublic = normalizeIsPublic(q.is_public);

      await client.query(
        `
        UPDATE questions
        SET position   = $1,
            sort_order = $1,
            question   = $2,
            is_public  = $3,
            updated_at = NOW()
        WHERE id = $4 AND assessment_id = $5
        `,
        [order, text, isPublic, Number(q.id), assessmentId]
      );
    }

    // 2) Insert new questions
    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx];
      if (q.id) continue;

      const text = (q.question || "").toString().trim();
      if (!text) continue;

      const order = idx + 1;
      const isPublic = normalizeIsPublic(q.is_public);

      const insertRes = await client.query(
        `
        INSERT INTO questions (
          school_id,
          assessment_id,
          position,
          sort_order,
          question,
          is_active,
          is_public
        )
        VALUES ($1, $2, $3, $3, $4, TRUE, $5)
        RETURNING id
        `,
        [schoolId, assessmentId, order, text, isPublic]
      );

      const newId = Number(insertRes.rows[0]?.id);
      if (Number.isFinite(newId)) incomingIds.push(newId);
    }

    // 3) Deletes unchanged
    const existingRes = await client.query(
      `SELECT id FROM questions WHERE assessment_id = $1`,
      [assessmentId]
    );
    const existingIds = existingRes.rows
      .map((r) => Number(r.id))
      .filter((id) => Number.isInteger(id));

    const idsToDelete = existingIds.filter((id) => !incomingIds.includes(id));

    if (idsToDelete.length) {
      await client.query(
        `DELETE FROM questions_help WHERE question_id = ANY($1::int[])`,
        [idsToDelete]
      );
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
// ---------------------------------------------------------------------
// GET /api/admin/my-schools
// Returns the list of schools this admin can see.
//
// Query params:
//   ?adminId=24&email=chrish@mss.com
//
// Behaviour:
//   - Look up the admin by id (preferred) or email.
//   - If is_superadmin = true  -> return ALL schools
//   - Else                     -> return only their school_id (if any)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// GET /api/admin/my-schools
//  - Superadmin  → all schools
//  - Normal admin → only their own school_id
// Query: ?adminId=24&email=chrish@mss.com
// ---------------------------------------------------------------------
//Dec 13 - many changes to the whole school sign up process
// ---------------------------------------------------------------------
// Which schools can this admin see?
//  - Superadmin  → all schools
//  - Normal admin → only their own school (admins.school_id)
// Called by SchoolPortal.js with ?email=&adminId=
// ---------------------------------------------------------------------

// DEPRECATE MY-SCHOOLS 
app.get("/api/admin/my-schools", async (req, res) => {
  const emailRaw = (req.query.email || "").toString().trim().toLowerCase();
  const adminIdRaw = (req.query.adminId ?? "").toString().trim();

  if (!emailRaw && !adminIdRaw) {
    return res.status(400).json({
      ok: false,
      error: "missing_params",
      message: "email or adminId is required.",
    });
  }

  try {
    // --- 1) Look up the admin record ---------------------------------
    let admin;
    if (adminIdRaw) {
      const adminId = Number(adminIdRaw);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return res.status(400).json({
          ok: false,
          error: "invalid_adminId",
          message: "adminId must be a positive integer.",
        });
      }

      const { rows, rowCount } = await pool.query(
        `
          SELECT
            id,
            email,
            full_name,
            is_superadmin,
            is_active,
            school_id
          FROM admins
          WHERE id = $1
          LIMIT 1
        `,
        [adminId]
      );

      if (!rowCount) {
        return res.status(401).json({
          ok: false,
          error: "admin_not_found",
          message: "No admin account found for this login.",
        });
      }

      admin = rows[0];
    } else {
      const { rows, rowCount } = await pool.query(
        `
          SELECT
            id,
            email,
            full_name,
            is_superadmin,
            is_active,
            school_id
          FROM admins
          WHERE lower(email) = $1
          LIMIT 1
        `,
        [emailRaw]
      );

      if (!rowCount) {
        return res.status(401).json({
          ok: false,
          error: "admin_not_found",
          message: "No admin account found for this login.",
        });
      }

      admin = rows[0];
    }

    if (admin.is_active === false) {
      return res.status(403).json({
        ok: false,
        error: "admin_inactive",
        message: "This admin account is not active.",
      });
    }

    const isSuper = !!admin.is_superadmin;

    // --- 2) Load schools ---------------------------------------------
    let schools = [];

    if (isSuper) {
      const { rows } = await pool.query(
        `
          SELECT
            id,
            slug,
            name,
            branding
          FROM schools
          ORDER BY name
        `
      );
      schools = rows;
    } else if (admin.school_id != null) {
      const { rows } = await pool.query(
        `
          SELECT
            id,
            slug,
            name,
            branding
          FROM schools
          WHERE id = $1
          LIMIT 1
        `,
        [admin.school_id]
      );
      schools = rows;
    }

    return res.json({
      ok: true,
      admin: {
        adminId: admin.id,
        email: admin.email,
        fullName: admin.full_name || "",
        isSuperAdmin: isSuper,
        schoolId: admin.school_id ?? null,
      },
      schools,
    });
  } catch (err) {
    console.error("GET /api/admin/my-schools error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Unable to load schools for this admin.",
    });
  }
});



// ---------------------------------------------------------------------
// ADMIN LOGIN API (admins only; JWT session)
// POST /api/admin/login
// Body: { email, password }
// ---------------------------------------------------------------------
async function handleAdminLogin(req, res) {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "Email and password are required.",
    });
  }

  try {
    const { rows, rowCount } = await pool.query(
      `
      SELECT
        id,
        school_id,
        email,
        full_name,
        password_hash,
        is_active,
        is_superadmin,
        is_owner
      FROM admins
      WHERE lower(email) = $1
      ORDER BY id ASC
      LIMIT 1
      `,
      [email]
    );

    if (!rowCount) {
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "Invalid email or password.",
      });
    }

    const a = rows[0];

    if (a.is_active === false) {
      return res.status(403).json({
        ok: false,
        error: "admin_inactive",
        message: "This admin account is not active.",
      });
    }

    const hash = String(a.password_hash || "").trim();
    if (!hash) {
      return res.status(403).json({
        ok: false,
        error: "missing_password",
        message: "This admin account has no password set.",
      });
    }

    const okPassword = await bcrypt.compare(password, hash);
    if (!okPassword) {
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "Invalid email or password.",
      });
    }

    const admin = {
      adminId: a.id,
      email: a.email,
      fullName: a.full_name || "",
      isSuperAdmin: !!a.is_superadmin,
      schoolId: a.school_id ?? null,
      isOwner: !!a.is_owner,
    };

    let token = "";
    try {
      token = signAdminToken(admin);
    } catch (jwtErr) {
      console.error("❌ JWT SIGN FAILED in /api/admin/login", {
        hasSecret: !!process.env.MSS_ADMIN_JWT_SECRET,
        secretLen: process.env.MSS_ADMIN_JWT_SECRET
          ? String(process.env.MSS_ADMIN_JWT_SECRET).length
          : 0,
        ttl: process.env.MSS_ADMIN_JWT_TTL || "(default)",
        error: jwtErr?.message,
      });

      return res.status(500).json({
        ok: false,
        error: "jwt_failed",
        message: jwtErr?.message || "JWT signing failed",
      });
    }

    return res.json({ ok: true, admin, token });
  } catch (err) {
    console.error("❌ handleAdminLogin error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Server error while logging in.",
    });
  }
}

// ✅ Keep ONLY this binding for the legacy admin login:
app.post("/api/admin/login", handleAdminLogin);

// ---------------------------------------------------------------------
// UNIFIED LOGIN API (admin OR teacher; slug disambiguation)
// POST /api/login
// Body: { email, password, slug? }
// ---------------------------------------------------------------------

async function handleUnifiedLogin(req, res) {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  const slug = String(body.slug || "").trim();

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      error: "missing_fields",
      message: "Email and password are required.",
    });
  }

  // Helper: choose ONE row deterministically when multiple candidates exist
  // within the SAME school context.
  function pickBestCandidate(rowsInSameSchool) {
    if (!Array.isArray(rowsInSameSchool) || rowsInSameSchool.length === 0) return null;

    // Prefer admin over teacher (policy: admin login wins if an email exists in both tables)
    const adminRow = rowsInSameSchool.find((r) => String(r.actor_type) === "admin");
    if (adminRow) return adminRow;

    const teacherRow = rowsInSameSchool.find((r) => String(r.actor_type) === "teacher");
    if (teacherRow) return teacherRow;

    // Fallback: first row
    return rowsInSameSchool[0];
  }

  try {
    // 1) Fetch all candidate identities for this email (admins + teachers)
    const cand = await pool.query(
      `SELECT * FROM public.sp_login_candidates($1::text)`,
      [email]
    );

    const rows = cand.rows || [];
    if (!rows.length) {
      // IMPORTANT: this means sp_login_candidates returned nothing for this email.
      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "Invalid email or password.",
      });
    }

    // Optional: lightweight debug (no hashes)
    console.log("[/api/login] candidates", {
      email,
      providedSlug: slug || null,
      count: rows.length,
      schools: Array.from(new Set(rows.map((r) => String(r.slug || "").trim()))),
      actorTypes: Array.from(new Set(rows.map((r) => String(r.actor_type || "").trim()))),
    });

   // 2) If slug provided, filter to that school context
let scoped = rows;
if (slug) {
  scoped = rows.filter((r) => String(r.slug || "").trim() === slug);
  if (!scoped.length) {
    return res.status(401).json({
      ok: false,
      error: "invalid_context",
      message: "Email is not valid for that school.",
    });
  }

  // 2b) If slug scoped but multiple actors remain (same school), pick deterministically
  if (scoped.length > 1) {
    const adminRow = scoped.find((r) => String(r.actor_type) === "admin");
    const teacherRow = scoped.find((r) => String(r.actor_type) === "teacher");
    scoped = adminRow ? [adminRow] : teacherRow ? [teacherRow] : [scoped[0]];
  }
} else {
  // 2c) No slug: try deterministic choice before forcing school selection
  const admins = scoped.filter((r) => String(r.actor_type) === "admin");
  const teachers = scoped.filter((r) => String(r.actor_type) === "teacher");

  // If exactly one admin record exists for this email, prefer it
  if (admins.length === 1) {
    scoped = [admins[0]];
  }
  // Else if exactly one teacher record exists, use it
  else if (teachers.length === 1) {
    scoped = [teachers[0]];
  }
  // Else multiple contexts -> force selection
  else if (scoped.length > 1) {
    const map = new Map();
    for (const r of scoped) {
      const key = String(r.slug || "");
      if (!map.has(key)) {
        map.set(key, {
          slug: r.slug,
          name: r.school_name,
          school_id: r.school_id,
          actor_types: new Set(),
          has_pw_any: false,
        });
      }
      const entry = map.get(key);
      entry.actor_types.add(r.actor_type);
      entry.has_pw_any = entry.has_pw_any || !!r.has_pw;
    }

    const schools = Array.from(map.values()).map((s) => ({
      slug: s.slug,
      name: s.name,
      school_id: s.school_id,
      actor_types: Array.from(s.actor_types),
      has_pw_any: !!s.has_pw_any, // optional: helps UI messaging later
    }));

    return res.status(200).json({
      ok: false,
      error: "needs_school_selection",
      message: "Select your school to continue.",
      schools,
    });
  }
}

// 4) Now expect exactly one candidate
const c = scoped[0];

    // Safety checks
    if (!c) {
      return res.status(500).json({
        ok: false,
        error: "server_error",
        message: "Login resolver returned no candidate.",
      });
    }

    if (c.is_active === false) {
      return res.status(403).json({
        ok: false,
        error: "account_inactive",
        message: "This account is not active.",
      });
    }

    const hash = String(c.password_hash || "").trim();
    if (!hash) {
      // This is the likely culprit for teacher accounts if teachers.password_hash is not populated.
      console.warn("[/api/login] missing_password_hash", {
        email,
        actor_type: c.actor_type,
        actor_id: c.actor_id,
        slug: c.slug,
        school_id: c.school_id,
      });

      return res.status(403).json({
        ok: false,
        error: "missing_password",
        message: "This account has no password set.",
      });
    }

    const okPassword = await bcrypt.compare(password, hash);
    if (!okPassword) {
      console.warn("[/api/login] bad_password", {
        email,
        actor_type: c.actor_type,
        actor_id: c.actor_id,
        slug: c.slug,
        school_id: c.school_id,
      });

      return res.status(401).json({
        ok: false,
        error: "invalid_credentials",
        message: "Invalid email or password.",
      });
    }

    // 5) Build unified actor payload
    const actor = {
      actorType: String(c.actor_type || "").trim(), // 'admin' | 'teacher'
      actorId: c.actor_id,
      schoolId: c.school_id,
      slug: String(c.slug || "").trim(),
      email: String(c.email || "").trim().toLowerCase(),
      fullName: c.full_name || "",

      // role flags (admin flags will be false/null for teacher rows unless your SP supplies them)
      isSuperAdmin: !!c.is_superadmin,
      isOwner: !!c.is_owner,
      isTeacherAdmin: !!c.is_teacher_admin,
    };

    // 6) JWT (DIAGNOSTIC WRAP)
    let token = "";
    try {
      token = signActorToken(actor);
    } catch (jwtErr) {
      console.error("❌ JWT SIGN FAILED in /api/login", {
        hasSecret: !!process.env.MSS_ACTOR_JWT_SECRET,
        secretLen: process.env.MSS_ACTOR_JWT_SECRET
          ? String(process.env.MSS_ACTOR_JWT_SECRET).length
          : 0,
        ttl: process.env.MSS_ACTOR_JWT_TTL || "(default)",
        error: jwtErr?.message,
        stack: jwtErr?.stack,
      });

      return res.status(500).json({
        ok: false,
        error: "jwt_failed",
        message: jwtErr?.message || "JWT signing failed",
      });
    }

    // 7) Success
    return res.json({ ok: true, actor, token });
  } catch (err) {
    console.error("❌ handleUnifiedLogin error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Server error while logging in.",
    });
  }
}

app.post("/api/login", handleUnifiedLogin);

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

//routes are here - imports above - old routes commented out

const adminTeachers = adminTeachersRouter({
  pool,
  requireAdminOrTeacherAdmin,
  requireSchoolCtxFromActor,
  asyncHandler,
});

app.use("/api/admin", requireActorAuth, adminTeachers);

// ---------------------------------------------------------------------
// Invite School Sign-up (Super Admin only) — JWT
// POST /api/admin/invite-school-signup
// Authorization: Bearer <token>
// Body: { to, firstName, subject, message, bcc }
// ---------------------------------------------------------------------
app.post(
  "/api/admin/invite-school-signup",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
   const body = req.body || {};

// Accept BOTH naming conventions:
//  - Legacy: to, message
//  - Newer UI: toEmail, messageHtml
const toEmail = String(body.toEmail ?? body.to ?? "").trim().toLowerCase();
const firstName = String(body.firstName ?? "").trim();
const subject = String(body.subject ?? "").trim();
const messageHtml = String(body.messageHtml ?? body.message ?? "").trim(); // HTML allowed
const bcc = String(body.bcc ?? "").trim();

// available if you want it
const senderEmail = req.adminAuth?.email || null;
const senderAdminId = req.adminAuth?.aid || null;

if (!toEmail || !subject || !messageHtml) {
  return res.status(400).json({
    ok: false,
    error: "validation_error",
    message: "to, subject, and message are required.",
  });
}
    try {
      await mailTransporter.sendMail({
        from: `"MySpeakingScore" <${smtpUser}>`,
        to: toEmail,
        subject,
        html: messageHtml,
        bcc: bcc || undefined,
      });

      return res.json({ ok: true, message: "Invite sent." });
    } catch (err) {
      console.error("[invite-school-signup] sendMail failed:", err);
      return res.status(500).json({
        ok: false,
        error: "email_failed",
        message: "Unable to send invite email.",
      });
    }
  }
);
//Dec 13

// ---------------------------------------------------------------------
// SCHOOL SIGN-UP (V2 / SP-ONLY)
// POST /api/school-signup/v2
// Writes rule: ONLY execute the SP for writes.
// ---------------------------------------------------------------------
app.post("/api/school-signup/v2", async (req, res) => {
  const body = req.body || {};

  const schoolName = String(body.schoolName || "").trim();
  const websiteUrl = String(body.websiteUrl || "").trim();
  const country = String(body.country || "").trim();
  const timeZone = String(body.timeZone || "").trim() || null;

  const contactName = String(body.contactName || "").trim();
  const contactEmail = String(body.contactEmail || "").trim().toLowerCase();

  const roleTitle = String(body.roleTitle || "").trim() || null;

  // Safe numeric parsing
  const teacherCount =
    body.teacherCount === "" || body.teacherCount == null
      ? null
      : Number.isFinite(Number(body.teacherCount))
      ? Number(body.teacherCount)
      : null;

  const heard = String(body.heard || "").trim() || null;
  const programDescription = String(body.programDescription || "").trim() || null;

  const exams = Array.isArray(body.exams)
    ? body.exams
    : body.exams
    ? [body.exams]
    : [];

  const testsPerMonth =
    body.testsPerMonth === "" || body.testsPerMonth == null
      ? null
      : Number.isFinite(Number(body.testsPerMonth))
      ? Number(body.testsPerMonth)
      : null;

  const anonymousFunnel = String(body.anonymousFunnel || "yes").trim();
  const funnelUrl = String(body.funnelUrl || "").trim() || null;

  const notes = String(body.notes || "").trim() || null; // optional
  const adminPassword = String(body.adminPassword || "").trim();

  // Required for SP-only finalize path
  const verifiedEmail = body.verifiedEmail === true;

  // ---- Basic validation ----
  const missing = [];
  if (!schoolName) missing.push("schoolName");
  if (!websiteUrl) missing.push("websiteUrl");
  if (!country) missing.push("country");
  if (!contactName) missing.push("contactName");
  if (!contactEmail) missing.push("contactEmail");
  if (!adminPassword) missing.push("adminPassword");
  if (!verifiedEmail) missing.push("verifiedEmail");

  if (missing.length) {
    return res.status(400).json({
      ok: false,
      error: "validation_error",
      message: `Missing/invalid fields: ${missing.join(", ")}`,
      missing,
    });
  }

  // ---- Build collision-proof slug ----
  const baseSlug =
  slugifyPkg(schoolName, { lower: true, strict: true, trim: true }) || "new-school";
  const rand = crypto.randomBytes(3).toString("hex"); // 6 chars
  const slug = `${baseSlug}-${Date.now()}-${rand}`;

  const sourceSlug = String(body.sourceSlug || "mss-demo").trim() || "mss-demo";
  const adminFullName = contactName;
  const adminEmail = contactEmail;

  // ---- Hash password ----
  let passwordHash;
  try {
    passwordHash = await bcrypt.hash(adminPassword, 10);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "hash_failed",
      message: "Unable to secure password.",
    });
  }

  // ---- Execute SP (ONLY write) ----
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sp = await client.query(
  `
  SELECT *
  FROM public.mss_provision_school_with_admin(
    $1,$2,$3,$4,$5,$6,
    $7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
  )
  `,
  [
    slug,
    schoolName,
    adminEmail,
    adminFullName,
    passwordHash,
    sourceSlug,

    websiteUrl,
    country,
    timeZone,
    roleTitle,
    teacherCount,
    heard,
    programDescription,
    exams,
    testsPerMonth,
    (anonymousFunnel || "yes") === "yes",
    funnelUrl,
    notes
  ]
);

    if (!sp.rows || sp.rows.length === 0) {
      throw new Error("SP returned no rows (unexpected for RETURNS TABLE).");
    }

   // ✅ THIS BLOCK IS REQUIRED
     const out = sp.rows[0];

     const schoolId = out.out_school_id ?? out.school_id;
     const adminId  = out.out_admin_id  ?? out.admin_id;

    

     if (!schoolId || !adminId) {
      throw new Error(`Unexpected SP output: ${JSON.stringify(out)}`);
     }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      schoolId,
      adminId,
      slug,
      adminEmail,
      message: "School created successfully (SP-only path). You can now log in.",
      schoolName,
      contactName,

      // FYI: keeping these for future audit use (not sensitive)
      meta: {
        websiteUrl,
        country,
        timeZone,
        roleTitle,
        teacherCount,
        heard,
        programDescription,
        exams,
        testsPerMonth,
        anonymousFunnel,
        funnelUrl,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[school-signup/v2] failed:", err);

    return res.status(500).json({
      ok: false,
      error: "signup_failed",
      message: err.message || "Internal error creating school.",
      code: err.code || null,
    });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// Manage Schools (Super Admin)
// ---------------------------------------------------------------------

app.options("/api/admin/manage-schools/*", (req, res) => res.sendStatus(204));

/* ----------------------------- Helpers ----------------------------- */

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
//2
async function makeUniqueSchoolSlug(baseSlug) {
  const base = (baseSlug && String(baseSlug).trim()) ? String(baseSlug).trim() : "school";
  let slug = base;
  let n = 2; // base-2, base-3...

  while (true) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schools WHERE slug = $1 LIMIT 1",
      [slug]
    );
    if (!rows.length) return slug;
    slug = `${base}-${n++}`;
  }
}

function toNullableNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function pickSignupFromBody(body) {
  const b = body || {};

  const teacherCount = toNullableNumber(b.teacherCount);
  const testsPerMonth = toNullableNumber(b.testsPerMonth);

  if (Number.isNaN(teacherCount)) {
    return { ok: false, message: "teacherCount must be a number (or blank)." };
  }
  if (Number.isNaN(testsPerMonth)) {
    return { ok: false, message: "testsPerMonth must be a number (or blank)." };
  }

  return {
    ok: true,
    signup: {
      websiteUrl: String(b.websiteUrl || "").trim(),
      country: String(b.country || "").trim(),
      timeZone: String(b.timeZone || "").trim(),
      programDescription: String(b.programDescription || "").trim(),
      contactName: String(b.contactName || "").trim(),
      contactEmail: String(b.contactEmail || "").trim(),
      roleTitle: String(b.roleTitle || "").trim(),
      teacherCount,
      testsPerMonth,
      heard: String(b.heard || "").trim(),
      funnelUrl: String(b.funnelUrl || "").trim(),
      notes: String(b.notes || "").trim(),
    },
  };
}

function flattenSchoolRow(row) {
  const settings = row?.settings || {};
  const signup = settings?.signup || {};

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,

    websiteUrl: signup.websiteUrl || "",
    country: signup.country || "",
    timeZone: signup.timeZone || "",
    programDescription: signup.programDescription || "",
    contactName: signup.contactName || "",
    contactEmail: signup.contactEmail || "",
    roleTitle: signup.roleTitle || "",
    teacherCount: signup.teacherCount ?? "",
    testsPerMonth: signup.testsPerMonth ?? "",
    heard: signup.heard || "",
    funnelUrl: signup.funnelUrl || "",
    notes: signup.notes || "",
  };
}

/* ----------------------------- Routes ------------------------------ */

// List (dropdown)
app.get(
  "/api/admin/manage-schools/schools",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, name, slug FROM schools ORDER BY name ASC"
      );
      return res.json({ ok: true, schools: rows });
    } catch (err) {
      console.error("[ManageSchools] list error:", err);
      return res.status(500).json({ ok: false, message: err.message || "Server error." });
    }
  }
);

// Purge (existing)
app.post(
  "/api/admin/manage-schools/purge",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
    const schoolId = Number(req.body?.schoolId);
    const mode = String(req.body?.mode || "PURGE").trim().toUpperCase();
    const dryRun = !!req.body?.dryRun;

    if (!Number.isFinite(schoolId) || schoolId <= 0) {
      return res.status(400).json({ ok: false, message: "schoolId (number) is required." });
    }
    if (!["PURGE", "DELETE", "SOFT"].includes(mode)) {
      return res.status(400).json({ ok: false, message: "mode must be PURGE | DELETE | SOFT." });
    }

    try {
      const { rows } = await pool.query(
        "SELECT * FROM admin_purge_school($1, $2, $3);",
        [schoolId, mode, dryRun]
      );
      return res.json({ ok: true, result: rows });
    } catch (err) {
      console.error("[ManageSchools] purge error:", err);
      return res.status(500).json({ ok: false, message: err.message || "Purge failed." });
    }
  }
);

// Read one (inline editor)
app.get("/api/admin/manage-schools/school/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  const schoolId = Number(req.params.id);
  if (!Number.isFinite(schoolId) || schoolId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid school id" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        s.id,
        s.slug,
        s.name,

        ss.website_url,
        ss.country,
        ss.time_zone,
        ss.program_description,
        ss.contact_name,
        ss.contact_email,
        ss.role_title,
        ss.teacher_count,
        ss.tests_per_month,
        ss.heard_about,
        ss.funnel_url,
        ss.notes
      FROM schools s
      LEFT JOIN school_signups ss
        ON ss.school_id = s.id
      WHERE s.id = $1
      LIMIT 1;
      `,
      [schoolId]
    );

    if (!rows.length) return res.status(404).json({ ok: false, message: "School not found" });

    const r = rows[0];

    return res.json({
      ok: true,
      school: {
        id: r.id,
        slug: r.slug,
        name: r.name,

        websiteUrl: r.website_url || "",
        country: r.country || "",
        timeZone: r.time_zone || "",
        programDescription: r.program_description || "",
        contactName: r.contact_name || "",
        contactEmail: r.contact_email || "",
        roleTitle: r.role_title || "",
        teacherCount: r.teacher_count == null ? "" : String(r.teacher_count),
        testsPerMonth: r.tests_per_month == null ? "" : String(r.tests_per_month),
        heard: r.heard_about || "",
        funnelUrl: r.funnel_url || "",
        notes: r.notes || "",
      },
    });
  } catch (e) {
    console.error("[manage-schools] load school:", e);
    return res.status(500).json({ ok: false, message: "Failed to load school" });
  }
});

// Update one (inline editor)
app.put("/api/admin/manage-schools/school/:id", requireAdminAuth, requireSuperAdmin, async (req, res) => {
  const schoolId = Number(req.params.id);
  if (!Number.isFinite(schoolId) || schoolId <= 0) {
    return res.status(400).json({ ok: false, message: "Invalid school id" });
  }

  const body = req.body || {};

  // Map form payload → normalized server vars
  const name = String(body.name || "").trim(); // from getFormValues()
  const websiteUrl = String(body.websiteUrl || "").trim() || null;
  const country = String(body.country || "").trim() || null;
  const timeZone = String(body.timeZone || "").trim() || null;
  const programDescription = String(body.programDescription || "").trim() || null;

  const contactName = String(body.contactName || "").trim() || null;
  const contactEmail = String(body.contactEmail || "").trim().toLowerCase() || null;
  const roleTitle = String(body.roleTitle || "").trim() || null;

  const teacherCount =
    body.teacherCount === "" || body.teacherCount == null ? null : Number(body.teacherCount);

  const testsPerMonth =
    body.testsPerMonth === "" || body.testsPerMonth == null ? null : Number(body.testsPerMonth);

  const heard = String(body.heard || "").trim() || null;
  const funnelUrl = String(body.funnelUrl || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;

  if (!name) return res.status(400).json({ ok: false, message: "School name is required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) schools.name (dropdown + canonical)
    await client.query(
      `UPDATE schools SET name = $2 WHERE id = $1`,
      [schoolId, name]
    );

    // 2) school_signups upsert (source-of-truth fields)
    // NOTE: "id" in school_signups auto-increments via default sequence.
    await client.query(
      `
      INSERT INTO school_signups (
        school_id,
        school_name,
        website_url,
        country,
        time_zone,
        program_description,
        contact_name,
        contact_email,
        role_title,
        teacher_count,
        tests_per_month,
        heard_about,
        funnel_url,
        notes,
        token,
        verified
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        encode(gen_random_bytes(24), 'hex'),
        true
      )
      ON CONFLICT (school_id) DO UPDATE SET
        school_name         = EXCLUDED.school_name,
        website_url         = EXCLUDED.website_url,
        country             = EXCLUDED.country,
        time_zone           = EXCLUDED.time_zone,
        program_description = EXCLUDED.program_description,
        contact_name        = EXCLUDED.contact_name,
        contact_email       = EXCLUDED.contact_email,
        role_title          = EXCLUDED.role_title,
        teacher_count       = EXCLUDED.teacher_count,
        tests_per_month     = EXCLUDED.tests_per_month,
        heard_about         = EXCLUDED.heard_about,
        funnel_url          = EXCLUDED.funnel_url,
        notes               = EXCLUDED.notes,
        verified            = true,
        verified_at         = now();
      `,
      [
        schoolId,
        name,
        websiteUrl,
        country,
        timeZone,
        programDescription,
        contactName,
        contactEmail,
        roleTitle,
        Number.isFinite(teacherCount) ? teacherCount : null,
        Number.isFinite(testsPerMonth) ? testsPerMonth : null,
        heard,
        funnelUrl,
        notes,
      ]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      school: { id: schoolId },
      message: "School updated.",
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[manage-schools] update school:", e);
    return res.status(500).json({ ok: false, message: e.message || "Failed to update school" });
  } finally {
    client.release();
  }
});

// Create new school (inline editor)
app.post(
  "/api/admin/manage-schools/school",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ ok: false, message: "School name is required." });
    }

    const picked = pickSignupFromBody(req.body);
    if (!picked.ok) {
      return res.status(400).json({ ok: false, message: picked.message });
    }

    try {
      const baseSlug = slugifyLocal(name) || "school";
      const slug = await makeUniqueSchoolSlug(baseSlug);

      const settings = { signup: picked.signup };

      const { rows } = await pool.query(
        `
        INSERT INTO schools (name, slug, settings)
        VALUES ($1, $2, $3::jsonb)
        RETURNING id, name, slug, COALESCE(settings, '{}'::jsonb) AS settings
        `,
        [name, slug, JSON.stringify(settings)]
      );

      return res.status(201).json({ ok: true, school: flattenSchoolRow(rows[0]) });
    } catch (err) {
      console.error("[ManageSchools] create school error:", err);
      return res.status(500).json({ ok: false, message: err.message || "Create failed." });
    }
  }
);

// Back-compat: rename endpoint (optional; keep until UI fully migrated)
app.put(
  "/api/admin/manage-schools/rename",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
    const schoolId = Number(req.body?.schoolId);
    const newName = String(req.body?.newName || "").trim();

    if (!Number.isFinite(schoolId) || schoolId <= 0 || !newName) {
      return res.status(400).json({ ok: false, message: "schoolId (number) and newName are required." });
    }

    try {
      // Only update name; preserve existing settings.signup
      const { rows } = await pool.query(
        `
        UPDATE schools
           SET name = $1
         WHERE id = $2
         RETURNING id, name, slug, COALESCE(settings, '{}'::jsonb) AS settings
        `,
        [newName, schoolId]
      );

      if (!rows.length) {
        return res.status(404).json({ ok: false, message: "School not found (id)." });
      }

      return res.json({ ok: true, school: flattenSchoolRow(rows[0]) });
    } catch (err) {
      console.error("[ManageSchools] rename error:", err);
      return res.status(500).json({ ok: false, message: err.message || "Rename failed." });
    }
  }
);
/* ------------------------------------------------------------------
   STUDENT ENROLLMENT (regen Jan 8 - on-duty + lead tag + logs)
   POST /api/student/enroll
   Body: { slug, submissionId, name?, full_name?, email }

   - Finds school by slug
   - Upserts student (students table, UNIQUE (school_id,email))
   - Links submission to student (submissions.student_pk [+ optional student_ref_id])
   - Enriches submissions.meta->student with basic info
   - Ensures student_profiles row and tags includes "lead"
   - Auto-assigns to ON-DUTY teacher if:
       (a) teacher exists with is_on_duty=true AND is_active=true, AND
       (b) student has no existing PRIMARY teacher_students row (regardless of active)
   - Writes student_logs entries:
       - lead_enroll
       - lead_auto_assigned (if assigned)
   ------------------------------------------------------------------ */
app.post("/api/student/enroll", async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};

    const slug = String(body.slug || "").trim();
    const submissionRaw = body.submissionId ?? body.submission_id;
    const fullNameRaw = body.full_name || body.name || "";
    const emailRaw = body.email || "";

    const email = String(emailRaw || "").trim().toLowerCase();
    const fullName = String(fullNameRaw || "").trim();
    const submissionId = Number(submissionRaw);

    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug", message: "slug is required" });
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_submission_id", message: "submissionId must be a positive integer" });
    }
    if (!email) return res.status(400).json({ ok: false, error: "missing_email", message: "email is required" });
    if (!fullName) return res.status(400).json({ ok: false, error: "missing_name", message: "full name is required" });

    await client.query("BEGIN");

    // 1) School
    const schoolRes = await client.query(
      `SELECT id FROM schools WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    if (!schoolRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "school_not_found", message: `No school found for slug ${slug}` });
    }
    const schoolId = Number(schoolRes.rows[0].id);

    // 2) Student upsert
    const studentRes = await client.query(
      `
      INSERT INTO students (school_id, email, full_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (school_id, email)
      DO UPDATE SET
        full_name  = EXCLUDED.full_name,
        updated_at = NOW()
      RETURNING id, school_id, email, full_name, created_at, updated_at
      `,
      [schoolId, email, fullName]
    );
    const student = studentRes.rows[0];
    const studentId = Number(student.id);

    // 3) Link submission -> student
    const submissionUpdateRes = await client.query(
      `
      UPDATE submissions
         SET student_pk     = $3,
             student_ref_id = $3,
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
      [schoolId, submissionId, studentId, student.full_name, student.email]
    );

    if (!submissionUpdateRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        ok: false,
        error: "submission_not_found",
        message: "Submission not found for this school. It may belong to a different slug or be missing.",
      });
    }

    // 4) Ensure profile + lead tag
    await client.query(
      `
      INSERT INTO student_profiles (student_id, tags)
      VALUES ($1, '[]'::jsonb)
      ON CONFLICT (student_id) DO NOTHING
      `,
      [studentId]
    );

    await client.query(
      `
      UPDATE student_profiles
         SET tags = CASE
                    WHEN COALESCE(tags, '[]'::jsonb) @> '["lead"]'::jsonb
                      THEN COALESCE(tags, '[]'::jsonb)
                    ELSE COALESCE(tags, '[]'::jsonb) || '["lead"]'::jsonb
                   END,
             updated_at = NOW()
       WHERE student_id = $1
      `,
      [studentId]
    );

    // 4b) Log: lead enrolled
    await client.query(
      `
      INSERT INTO student_logs (school_id, student_id, note_type, note_text)
      VALUES ($1, $2, 'lead_enroll', $3)
      `,
      [
        schoolId,
        studentId,
        `Lead enrolled via funnel. submission_id=${submissionId}; name="${fullName}"; email="${email}".`,
      ]
    );

    // 5) Auto-assign to on-duty teacher (only if no existing PRIMARY row of any kind)
    const existingPrimaryAny = await client.query(
      `
      SELECT 1
        FROM teacher_students
       WHERE school_id = $1
         AND student_id = $2
         AND is_primary = true
       LIMIT 1
      `,
      [schoolId, studentId]
    );

    let assignedTeacherId = null;

    if (!existingPrimaryAny.rowCount) {
      const onDuty = await client.query(
        `
        SELECT id
          FROM teachers
         WHERE school_id = $1
           AND is_active = true
           AND is_on_duty = true
         LIMIT 1
        `,
        [schoolId]
      );

      if (onDuty.rowCount) {
        assignedTeacherId = Number(onDuty.rows[0].id);

        // CRITICAL: clear any existing primary flags (defensive; also supports future reassignment)
        await client.query(
          `
          UPDATE teacher_students
             SET is_primary = false,
                 updated_at = NOW()
           WHERE school_id = $1
             AND student_id = $2
             AND is_primary = true
          `,
          [schoolId, studentId]
        );

        // Create / re-activate link
        await client.query(
          `
          INSERT INTO teacher_students (
            school_id, teacher_id, student_id,
            role, is_primary, is_active
          )
          VALUES ($1, $2, $3, 'coach', true, true)
          ON CONFLICT (teacher_id, student_id)
          DO UPDATE SET
            is_active  = true,
            is_primary = true,
            updated_at = NOW()
          `,
          [schoolId, assignedTeacherId, studentId]
        );

        // Log: auto assigned
        await client.query(
          `
          INSERT INTO student_logs (school_id, student_id, teacher_id, note_type, note_text)
          VALUES ($1, $2, $3, 'lead_auto_assigned', $4)
          `,
          [
            schoolId,
            studentId,
            assignedTeacherId,
            `Auto-assigned to on-duty teacher_id=${assignedTeacherId}.`,
          ]
        );
      }
    }

    await client.query("COMMIT");

    return res.json({
      ok: true,
      schoolId,
      submissionId: Number(submissionUpdateRes.rows[0].id),
      assignedTeacherId,
      student: {
        id: studentId,
        email: student.email,
        full_name: student.full_name,
        created_at: student.created_at,
        updated_at: student.updated_at,
      },
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("❌ POST /api/student/enroll error:", err);
    return res.status(500).json({
      ok: false,
      error: "enroll_failed",
      message: err?.message || "Server error while enrolling student",
    });
  } finally {
    client.release();
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

//Dec 14

async function notifyNewSchoolCreated({ adminEmail, schoolName, slug, schoolId }) {
  try {
    const when = new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" });

    await mailTransporter.sendMail({
      from: `"MySpeakingScore" <${smtpUser}>`,
      to: "chris@myspeakingscore.com",
      subject: `New School Created: ${schoolName}`,
      html: `
        <p><b>New School created</b></p>
        <ul>
          <li><b>School</b>: ${schoolName}</li>
          <li><b>Slug</b>: ${slug}</li>
          <li><b>school_id</b>: ${schoolId}</li>
          <li><b>Admin email</b>: ${adminEmail}</li>
          <li><b>When</b>: ${when} (ET)</li>
        </ul>
      `.trim(),
    });
  } catch (e) {
    console.warn("[notifyNewSchoolCreated] email failed:", e.message);
  }
}

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
app.put(
  "/api/admin/school/:slug/rename",
  requireAdminAuth,
  requireSuperAdmin,
  async (req, res) => {
    const currentSlug = String(req.params.slug || "").trim().toLowerCase();
    const newName = String(req.body?.name || "").trim();

    if (!currentSlug || !newName) {
      return res.status(400).json({
        ok: false,
        error: "validation_error",
        message: "Missing school slug or new name.",
      });
    }

    try {
      const baseSlug = normalizeSlug(newName);
      const newSlug = await ensureUniqueSlug(baseSlug, pool);

      await pool.query(
        `
        UPDATE schools
        SET name = $1,
            slug = $2
        WHERE slug = $3
        `,
        [newName, newSlug, currentSlug]
      );

      return res.json({
        ok: true,
        message: "School renamed successfully.",
        oldSlug: currentSlug,
        newSlug,
        name: newName,
      });
    } catch (err) {
      console.error("[rename school] error:", err);
      return res.status(500).json({
        ok: false,
        error: "rename_failed",
        message: "Server error while renaming school.",
      });
    }
  }
);

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
// ADMIN PASSWORD RESET – REQUEST (bcrypt+JWT era) Dec 2025
// POST /api/admin/password-reset/request  { email }
//  - Do NOT reveal whether the email exists
//  - Creates reset token + emails reset link (best-effort)
// ---------------------------------------------------------------------
app.post("/api/admin/password-reset/request", async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();

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

    // Find admin by email (NO enumeration)
    const { rows, rowCount } = await client.query(
      `
      SELECT id, email, full_name
      FROM admins
      WHERE lower(email) = lower($1)
        AND is_active IS NOT FALSE
      LIMIT 1
      `,
      [email]
    );

    if (!rowCount) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "If this email is registered, a reset link has been sent.",
      });
    }

    const admin = rows[0];
    const token = generateSignupToken(); // ok to reuse your existing helper
    const ttlMinutes = 120;

    await client.query(
      `
      INSERT INTO admin_password_resets (
        admin_id, email, token, status, created_at, expires_at
      )
      VALUES (
        $1, $2, $3, 'pending', NOW(),
        NOW() + ($4 || ' minutes')::interval
      )
      `,
      [admin.id, admin.email.toLowerCase(), token, String(ttlMinutes)]
    );

    await client.query("COMMIT");

    const baseUrl = getPublicBaseUrl();
    const resetUrl =
      `${baseUrl}/admin-login/PasswordReset.html?token=` +
      encodeURIComponent(token);

    // Email (best-effort)
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn("⚠️ SMTP not configured; skipping password reset email.");
    } else {
      try {
        const friendlyName = (admin.full_name || "").trim() || "there";

        await mailTransporter.sendMail({
          from: `"MySpeakingScore" <${smtpUser}>`,
          to: admin.email,
          subject: "Reset your MySpeakingScore admin password",
          text: `
Hi ${friendlyName},

We received a request to reset the password for your MySpeakingScore admin account.

To choose a new password, open this link:

  ${resetUrl}

If you did not request this, you can safely ignore this email.

— MySpeakingScore
          `.trim(),
          html: `
            <p>Hi ${friendlyName},</p>
            <p>
              We received a request to reset the password for your
              <strong>MySpeakingScore admin account</strong>.
            </p>
            <p>To choose a new password, click the button below:</p>
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
      }
    }

    return res.json({
      ok: true,
      message: "If this email is registered, a reset link has been sent.",
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
// ADMIN PASSWORD RESET – APPLY (JWT-era) Dec 2025
// POST /api/admin/password-reset  { token, password }
// ---------------------------------------------------------------------
app.post("/api/admin/password-reset", async (req, res) => {
  const body = req.body || {};
  const token = String(body.token || "").trim();
  const password = String(body.password || "").trim();

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
      message: "Password must be at least 8 characters.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows, rowCount } = await client.query(
      `
      SELECT id, admin_id, email, expires_at, used_at, status
      FROM admin_password_resets
      WHERE token = $1
        AND status = 'pending'
        AND used_at IS NULL
      LIMIT 1
      `,
      [token]
    );

    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        ok: false,
        error: "invalid_or_used",
        message: "Invalid or expired reset link.",
      });
    }

    const reset = rows[0];

    // Expiry check (if expires_at is present)
    if (reset.expires_at && new Date(reset.expires_at) < new Date()) {
      await client.query(
        `
        UPDATE admin_password_resets
        SET status = 'expired'
        WHERE id = $1
        `,
        [reset.id]
      );

      await client.query("COMMIT");
      return res.status(400).json({
        ok: false,
        error: "expired_token",
        message: "This verification code has expired.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await client.query(
      `
      UPDATE admins
      SET password_hash = $1
      WHERE id = $2
      `,
      [passwordHash, reset.admin_id]
    );

    await client.query(
      `
      UPDATE admin_password_resets
      SET status = 'used', used_at = NOW()
      WHERE id = $1
      `,
      [reset.id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("POST /api/admin/password-reset error:", err);
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
      AND is_public = true
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


// ---------------------------------------------------------------------
// FUNNEL: START (collect student email, send verification link)
// POST /api/funnel/start
// ---------------------------------------------------------------------
app.post("/api/funnel/start", express.json(), async (req, res) => {
  const slug = String(req.body?.slug || "").trim();
  const submissionId = Number(req.body?.submissionId);
  const studentEmail = String(req.body?.studentEmail || "").trim().toLowerCase();

  if (!slug) return res.status(400).json({ ok: false, message: "Missing slug." });
  if (!Number.isFinite(submissionId) || submissionId <= 0) {
    return res.status(400).json({ ok: false, message: "Missing/invalid submissionId." });
  }
  if (!studentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
    return res.status(400).json({ ok: false, message: "Missing/invalid studentEmail." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) resolve school_id
    const s = await client.query(
      `SELECT id, name FROM schools WHERE slug=$1 LIMIT 1`,
      [slug]
    );
    if (!s.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "School not found for slug." });
    }
    const schoolId = s.rows[0].id;
    const schoolName = s.rows[0].name;

    // 2) ensure submission exists (and belongs to that school)
    const sub = await client.query(
      `SELECT 1 FROM submissions WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [submissionId, schoolId]
    );
    if (!sub.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, message: "Submission not found for this school." });
    }

    // 3) upsert funnel request (idempotent per submission+email)
    const newToken = crypto.randomBytes(24).toString("hex");

    const up = await client.query(
      `
      INSERT INTO funnel_requests
        (school_id, submission_id, student_email, token, status, created_at)
      VALUES
        ($1,$2,$3,$4,'pending', now())
      ON CONFLICT (submission_id, lower(student_email))
      DO UPDATE SET
        school_id     = EXCLUDED.school_id,
        -- Option A (recommended): keep existing token so old email links still work
        token         = funnel_requests.token,
        status        = CASE
                          WHEN funnel_requests.status = 'sent' THEN 'sent'
                          WHEN funnel_requests.status = 'error' THEN 'pending'
                          ELSE funnel_requests.status
                        END,
        error_message = NULL
      RETURNING id, token, status
      `,
      [schoolId, submissionId, studentEmail, newToken]
    );

    const row = up.rows[0];
    const token = row.token;
    const status = String(row.status || "pending").toLowerCase();

    // If already sent, we can simply return ok (no need to re-email student)
    if (status === "sent") {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "You have already verified your email. The school has been notified.",
      });
    }

    const verifyUrl = `${getPublicBaseUrl()}/api/funnel/verify?token=${encodeURIComponent(token)}`;

    // 4) email student
    const sent = await sendMailSafe({
      to: studentEmail,
      subject: `Verify your email to receive your free report (${schoolName})`,
      html: `
        <p>Thanks for taking the free assessment.</p>
        <p><b>One last step:</b> please verify your email to receive your free report.</p>
        <p><a href="${verifyUrl}">Verify my email</a></p>
        <p style="color:#64748b; font-size:12px;">If you did not request this, you can ignore this email.</p>
      `,
      text: `Verify your email: ${verifyUrl}`,
    });

    if (!sent.ok) {
      await client.query(
        `UPDATE funnel_requests SET status='error', error_message=$2 WHERE id=$1`,
        [row.id, sent.error || sent.message || "Email send failed"]
      );
      await client.query("COMMIT");
      return res.status(500).json({ ok: false, message: "Could not send verification email." });
    }

    await client.query("COMMIT");
    return res.json({ ok: true, message: "Verification email sent." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[api/funnel/start] failed:", err);
    return res.status(500).json({ ok: false, message: err.message || "Internal error." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// FUNNEL VERIFY (simple admin alert)
// GET /api/funnel/verify?token=...
// Verifies student email + emails school_signups.contact_email
// ---------------------------------------------------------------------
app.get("/api/funnel/verify", async (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token) return res.status(400).send("Missing token.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Load funnel request + school info
    const frq = await client.query(
      `
      SELECT fr.id,
             fr.school_id,
             fr.submission_id,
             fr.student_email,
             fr.status,
             s.slug,
             s.name
      FROM funnel_requests fr
      JOIN schools s ON s.id = fr.school_id
      WHERE fr.token = $1
      LIMIT 1
      `,
      [token]
    );

    if (!frq.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).send("Invalid or expired token.");
    }

    const fr = frq.rows[0];
    const funnelRequestId = fr.id;
    const schoolId = fr.school_id;
    const submissionId = fr.submission_id;
    const schoolSlug = fr.slug;
    const schoolName = fr.name;
    const studentEmail = fr.student_email;
    const currentStatus = String(fr.status || "").toLowerCase();

    // 1a) Idempotency: if already sent, do not resend email
    if (currentStatus === "sent") {
      await client.query("COMMIT");
      return res.status(200).send(renderVerifiedPage(true));
    }

    // 2) Mark verified (idempotent)
    await client.query(
      `
      UPDATE funnel_requests
      SET status = CASE
                     WHEN status = 'sent' THEN status
                     WHEN status = 'error' THEN status
                     ELSE 'verified'
                   END,
          verified_at = COALESCE(verified_at, now())
      WHERE id = $1
      `,
      [funnelRequestId]
    );

    // 3) Resolve admin recipient (school_signups.contact_email)
    const ssQ = await client.query(
      `
      SELECT contact_email
      FROM school_signups
      WHERE school_id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    const adminEmail = ssQ.rows[0]?.contact_email || null;

    if (!adminEmail) {
      await client.query(
        `
        UPDATE funnel_requests
        SET status='error',
            error_message='No admin contact_email found in school_signups'
        WHERE id=$1
        `,
        [funnelRequestId]
      );
      await client.query("COMMIT");
      return res
        .status(500)
        .send("Verified, but could not notify the school (no admin email).");
    }

    // 4) Optional safety: ensure submission exists (can remove if you want)
    const subQ = await client.query(
      `SELECT 1 FROM submissions WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [submissionId, schoolId]
    );
    if (!subQ.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).send("Submission not found for this token.");
    }

    // 5) Send simple admin alert
    const subject = `MSS Funnel Lead Verified: ${studentEmail} (${schoolName})`;

    const text = [
      `A student email has been verified for a new report request.`,
      ``,
      `Student: ${studentEmail}`,
      `School: ${schoolName} (${schoolSlug})`,
      `Submission ID: ${submissionId}`,
      ``,
      `Next step: Please review this submission in the portal and follow up as appropriate.`
    ].join("\n");

    const html = `
      <p><b>New verified report request</b></p>
      <p>
        <b>Student:</b> ${escapeHtml(studentEmail)}<br/>
        <b>School:</b> ${escapeHtml(schoolName)} (${escapeHtml(schoolSlug)})<br/>
        <b>Submission ID:</b> ${escapeHtml(submissionId)}
      </p>
      <p>Next step: Please review this submission in the portal and follow up as appropriate.</p>
    `;

    const sent = await sendMailSafe({
      to: adminEmail,
      subject,
      html,
      text,
    });

    if (!sent.ok) {
      await client.query(
        `
        UPDATE funnel_requests
        SET status='error',
            error_message=$2
        WHERE id=$1
        `,
        [funnelRequestId, sent.error || sent.message || "Email send failed"]
      );
      await client.query("COMMIT");
      return res
        .status(500)
        .send("Verified, but could not notify the school (email failed).");
    }

    // 6) Mark sent (idempotent)
    await client.query(
      `
      UPDATE funnel_requests
      SET status='sent',
          notified_at = COALESCE(notified_at, now())
      WHERE id=$1
      `,
      [funnelRequestId]
    );

    await client.query("COMMIT");
    return res.status(200).send(renderVerifiedPage(false));

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[funnel/verify] failed:", err);
    return res.status(500).send(err.message || "Internal error.");
  } finally {
    client.release();
  }

  // helpers
  function escapeHtml(v) {
    return String(v || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderVerifiedPage(alreadySent) {
    return `
      <html>
        <head><meta charset="utf-8"><title>Verified</title></head>
        <body style="font-family:system-ui; padding:24px;">
          <h2>Email verified</h2>
          <p>Thanks — your request has been verified.</p>
          <p>
            ${
              alreadySent
                ? "The school has already been notified."
                : "The school has been notified and will follow up with your report and next steps."
            }
          </p>
        </body>
      </html>
    `;
  }
});


// =====================================================================
// AI PROMPTS + AI REPORTS  (Cleaned + Scoped + Cache-safe)
// =====================================================================
// Assumptions:
// - requireAdminAuth populates req.admin = { isSuperAdmin:boolean, schoolId:number, ... }
// - ai_reports has NO school_id, so all scoping must be enforced via submissions (school_id)
// - Unique constraint exists on ai_reports(submission_id, prompt_id)
// - Helper fns exist: renderPromptTemplate(), sha256(), openAiGenerateReport()

async function resolveSchoolBySlug(slug) {
  const cleanSlug = String(slug || "").trim().toLowerCase();
  if (!cleanSlug) {
    const err = new Error("missing_slug");
    err.status = 400;
    err.error = "missing_slug";
    throw err;
  }

  const s = await pool.query(
    `SELECT id, slug, name
     FROM schools
     WHERE slug = $1
     LIMIT 1`,
    [cleanSlug]
  );

  if (!s.rowCount) {
    const err = new Error("school_not_found");
    err.status = 404;
    err.error = "school_not_found";
    err.slug = cleanSlug;
    throw err;
  }

  const row = s.rows[0];

  return {
    schoolId: Number(row.id),
    schoolSlug: String(row.slug || cleanSlug),
    schoolName: String(row.name || ""),
    // Optional: include row for future expansion without extra queries
    school: row,
  };
}
async function assertPromptBelongsToSchool(promptId, schoolId) {
  const pr = await pool.query(
    `SELECT 1 FROM ai_prompts WHERE id = $1 AND school_id = $2 LIMIT 1`,
    [promptId, schoolId]
  );
  if (!pr.rowCount) {
    const err = new Error("prompt_not_found");
    err.status = 404;
    throw err;
  }
}

async function assertSubmissionBelongsToSchool(submissionId, schoolId) {
  const sub = await pool.query(
    `SELECT 1
     FROM submissions
     WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [submissionId, schoolId]
  );
  if (!sub.rowCount) {
    const err = new Error("submission_not_found");
    err.status = 404;
    throw err;
  }
}

async function invalidateReportsForPromptInSchool(promptId, schoolId) {
  // ai_reports has no school_id; enforce scope via submissions
  const del = await pool.query(
    `DELETE FROM ai_reports ar
     USING submissions s
     WHERE ar.submission_id = s.id
       AND ar.prompt_id = $1
       AND s.school_id = $2
       AND s.deleted_at IS NULL`,
    [promptId, schoolId]
  );
  return del.rowCount || 0;
}

// =====================================================================
// SUGGEST SETTINGS (per-school) — stored in ai_prompt_preamble
// =====================================================================

const DEFAULT_SUGGEST_PREAMBLE = [
  "SYSTEM ROLE:",
  "You are an accomplished, thoughtful, and kind ESL teacher and instructional coach.",
  "You have assessment results for a student's spoken response and want to provide clear, concise feedback with practical suggestions the student can try immediately.",
  "If you are using a helper language, only use it to explain concepts and support instructions; keep student evidence in English.",
  "",
  "TASK:",
  "Generate a teacher-usable AI prompt TEMPLATE for feedback on a student's spoken response.",
  "This template will be stored and later used with real submission data.",
  "",
  "CONSTRAINTS:",
  "- Use ONLY the metrics the admin selected.",
  "- Do NOT invent scores or facts.",
  "- If a metric is missing/blank, gracefully omit it (do not mention it).",
  "- Be practical: actionable exercises, encouraging, teacher-friendly.",
  "- Output must be a single prompt template (not JSON).",
  "",
  "AVAILABLE RUNTIME VARIABLES (placeholders):",
  "- {{question}}",
  "- {{transcript}} (clean transcript)",
  "- {{student}} (if present)",
  "- {{wpm}} (if selected)",
  "- Selected MSS scores: {{mss_fluency}}, {{mss_pron}}, {{mss_grammar}}, {{mss_vocab}}, {{mss_cefr}}, {{mss_toefl}}",
  "",
  "REQUIRED OUTPUT STRUCTURE (Markdown):",
  "1) Quick Summary (2–3 bullets)",
  "2) Strengths (2–4 bullets)",
  "3) Priority Improvements (2–4 bullets)",
  "4) Exercises (3–6 items) tied to selected metrics",
  "5) Next Attempt Plan (short checklist)",
  "",
  "TONE:",
  "Supportive, specific, teacher-friendly, and concise."
].join("\n");

// Optional: migrate from legacy ai_prompts row if it exists
const LEGACY_SUGGEST_PREAMBLE_NAME = "__SUGGEST_PREAMBLE__";

async function loadLegacySuggestPreamble({ schoolId }) {
  const r = await pool.query(
    `SELECT id, prompt_text, notes, language
     FROM ai_prompts
     WHERE school_id = $1 AND name = $2
     LIMIT 1`,
    [schoolId, LEGACY_SUGGEST_PREAMBLE_NAME]
  );
  if (!r.rowCount) return null;

  const row = r.rows[0];
  return {
    legacy_id: Number(row.id),
    preamble: String(row.prompt_text || ""),
    default_notes: String(row.notes || ""),
    default_language: String(row.language || ""),
    default_selected_metrics: [],
  };
}

async function getOrCreateSuggestSettings({ schoolId }) {
  // Normalize + validate once
  const sid = Number(schoolId || 0);
  if (!Number.isFinite(sid) || sid <= 0) {
    const err = new Error("bad_school_id");
    err.status = 400;
    throw err;
  }

  // Helper to normalize jsonb metrics to an array of strings
  const normalizeMetrics = (v) => {
    // pg jsonb often returns already-parsed JS types
    if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean);

    // If it's null/undefined, return empty
    if (v == null) return [];

    // If it's a JSON string (rare but possible), parse it
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.map(x => String(x || "").trim()).filter(Boolean);
      } catch {
        // If it's a comma-separated string fallback
        return v.split(",").map(s => s.trim()).filter(Boolean);
      }
    }

    // Any other type (object/number/bool) -> empty for safety
    return [];
  };

  const r = await pool.query(
    `SELECT id, preamble_text, default_language, default_notes, default_metrics
       FROM ai_prompt_preamble
      WHERE school_id = $1
      LIMIT 1`,
    [sid]
  );

  if (r.rowCount) {
    const row = r.rows[0];
    return {
      id: Number(row.id),
      preamble: String(row.preamble_text || ""),
      default_language: String(row.default_language || ""),
      default_notes: String(row.default_notes || ""),
      default_selected_metrics: normalizeMetrics(row.default_metrics),
      exists: true,
    };
  }

  // Seed: legacy > env/default (sanitize everything)
  const legacy = await loadLegacySuggestPreamble({ schoolId: sid });

  const seedPreamble = String(
    legacy?.preamble || String(DEFAULT_SUGGEST_PREAMBLE || "")
  ).trim();

  const seedLanguage = String(legacy?.default_language || "").trim();
  const seedNotes = String(legacy?.default_notes || "").trim();

  const seedMetrics = normalizeMetrics(
    legacy?.default_selected_metrics ?? legacy?.default_metrics ?? []
  );

  const ins = await pool.query(
    `INSERT INTO ai_prompt_preamble
        (school_id, preamble_text, default_language, default_notes, default_metrics)
     VALUES
        ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, preamble_text, default_language, default_notes, default_metrics`,
    [sid, seedPreamble, seedLanguage, seedNotes, JSON.stringify(seedMetrics)]
  );

  const row = ins.rows[0];
  return {
    id: Number(row.id),
    preamble: String(row.preamble_text || ""),
    default_language: String(row.default_language || ""),
    default_notes: String(row.default_notes || ""),
    default_selected_metrics: normalizeMetrics(row.default_metrics),
    exists: false,
  };
}
async function upsertSuggestSettings({ schoolId, preamble, default_language, default_notes, default_selected_metrics }) {

   if (!Number.isFinite(Number(schoolId)) || Number(schoolId) <= 0) {
     const err = new Error("bad_school_id");
     err.status = 400;
     throw err;
   }

  const metrics = Array.isArray(default_selected_metrics)
    ? default_selected_metrics.map(x => String(x || "").trim()).filter(Boolean)
    : [];

  const q = await pool.query(
    `INSERT INTO ai_prompt_preamble (school_id, preamble_text, default_language, default_notes, default_metrics, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (school_id)
     DO UPDATE SET
       preamble_text = EXCLUDED.preamble_text,
       default_language = EXCLUDED.default_language,
       default_notes = EXCLUDED.default_notes,
       default_metrics = EXCLUDED.default_metrics,
       updated_at = now()
     RETURNING id, preamble_text, default_language, default_notes, default_metrics`,
    [
      schoolId,
      String(preamble ?? ""),
      String(default_language ?? ""),
      String(default_notes ?? ""),
      JSON.stringify(metrics),
    ]
  );

  const row = q.rows[0];
  return {
    id: Number(row.id),
    preamble: String(row.preamble_text || ""),
    default_language: String(row.default_language || ""),
    default_notes: String(row.default_notes || ""),
    default_selected_metrics: Array.isArray(row.default_metrics) ? row.default_metrics : [],
  };
}
//is this the right place for this function??
function buildSuggestedPromptTemplate({ preamble, language, notes, selectedMetrics }) {
  const pre = String(preamble || "").trim();
  const helperLanguage = String(language || "").trim();
  const adminNotes = String(notes || "").trim();

  // Normalize metrics to a simple array of strings
  let sel = [];
  if (Array.isArray(selectedMetrics)) {
    sel = selectedMetrics.map(x => String(x || "").trim()).filter(Boolean);
  } else if (selectedMetrics && typeof selectedMetrics === "object") {
    sel = Object.keys(selectedMetrics).filter(k => !!selectedMetrics[k]);
  } else if (typeof selectedMetrics === "string") {
    sel = selectedMetrics.split(",").map(s => s.trim()).filter(Boolean);
  }

  const helperRule = helperLanguage
    ? [
        "HELPER LANGUAGE POLICY:",
        `- Use ${helperLanguage} only to explain concepts and instructions when helpful.`,
        "- Keep ALL student evidence in English (quotes, words/phrases, pronunciation examples).",
      ].join("\n")
    : "";

  const metricsLine = sel.length
    ? `Selected metrics (use ONLY these; omit any missing at runtime): ${sel.join(", ")}`
    : "Selected metrics: (none provided) — use a safe core MSS set if available, and omit missing.";

  const parts = [];
  if (pre) parts.push(pre);
  if (helperRule) parts.push(helperRule);

  parts.push(
    [
      "TASK:",
      "Generate a teacher-usable PROMPT TEMPLATE to give feedback on a student's spoken response.",
      "The output must be a single prompt template (not JSON).",
      "",
      "RUNTIME VARIABLES AVAILABLE:",
      "- {{question}}",
      "- {{transcript}}",
      "- {{student}}",
      "- {{wpm}}",
      "- {{mss_fluency}}, {{mss_pron}}, {{mss_grammar}}, {{mss_vocab}}, {{mss_cefr}}, {{mss_toefl}}",
      "",
      metricsLine,
      "",
      adminNotes ? `Admin notes:\n${adminNotes}` : "",
      "",
      "REQUIRED OUTPUT STRUCTURE (Markdown):",
      "1) Quick Summary (2–3 bullets)",
      "2) Strengths (2–4 bullets)",
      "3) Priority Improvements (2–4 bullets)",
      "4) Exercises (3–6 items) tied to selected metrics",
      "5) Next Attempt Plan (short checklist)",
      "",
      "CONSTRAINTS:",
      "- Use ONLY the metrics selected above.",
      "- Do NOT invent scores or facts.",
      "- If a metric is missing or blank at runtime, omit it and do not mention it.",
      "",
      "Return ONLY the final prompt template text.",
    ].filter(Boolean).join("\n")
  );

  return parts.join("\n\n").trim();
}

// =====================================================================
// SUGGEST (Generate a prompt template using OpenAI)
// POST /api/admin/ai-prompts/:slug/suggest
// body: { language?, notes?, selected_metrics? }
// Also accepts: selectedMetrics, metrics, default_selected_metrics (tolerant)
// =====================================================================

// =====================================================================
// SUGGEST (Generate a prompt template using OpenAI)
// POST /api/admin/ai-prompts/:slug/suggest
// body: { language?, notes?, selected_metrics? }
// Also accepts: selectedMetrics, metrics, default_selected_metrics (tolerant)
// Access: teacher | admin | superadmin (superadmin bypasses slug scope)
// Scope: token.slug must match :slug unless superadmin
// =====================================================================
app.post("/api/admin/ai-prompts/:slug/suggest", requireStaffAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    // Deterministic scope gate (fixes admin failures caused by missing schoolId-in-ctx)
    assertStaffSchoolScopeBySlug(req, slug);

    const { schoolId, schoolSlug } = await resolveSchoolBySlug(slug);

    // 1) Load per-school defaults
    const ss = await getOrCreateSuggestSettings({ schoolId });

    // 2) Accept request overrides (tolerant keys)
    const language =
      req.body?.language != null ? String(req.body.language).trim() :
      req.body?.default_language != null ? String(req.body.default_language).trim() :
      String(ss.default_language || "").trim();

    const notes =
      req.body?.notes != null ? String(req.body.notes).trim() :
      req.body?.default_notes != null ? String(req.body.default_notes).trim() :
      String(ss.default_notes || "").trim();

    const selectedMetrics =
      req.body?.selected_metrics ??
      req.body?.selectedMetrics ??
      req.body?.metrics ??
      req.body?.default_selected_metrics ??
      req.body?.default_metrics ??
      ss.default_selected_metrics ??
      [];

    const metaPrompt = buildSuggestedPromptTemplate({
      preamble: ss.preamble,
      language,
      notes,
      selectedMetrics,
    });

    const ai = await openAiGenerateReport({
      promptText: metaPrompt,
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_output_tokens: 900,
    });

    return res.json({
      ok: true,
      slug: schoolSlug || slug,
      schoolId,
      prompt_text: ai.text,
      suggested_prompt_text: ai.text,
      model: ai.model,
    });
  } catch (e) {
    console.error("POST /suggest failed:", e);
    return res.status(e.status || 500).json({
      ok: false,
      error: e.message || "server_error",
    });
  }
});

// =====================================================================
// PUT suggest-settings
// Body: { preamble, default_language, default_notes, default_selected_metrics }
// Also accepts: default_metrics (transition)
// Access: teacher | admin | superadmin
// Scope: token.slug must match :slug unless superadmin
// =====================================================================
app.put("/api/admin/ai-prompts/:slug/suggest-settings", requireStaffAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    // Deterministic scope gate
    assertStaffSchoolScopeBySlug(req, slug);

    const { schoolId } = await resolveSchoolBySlug(slug);

    // fingerprint to confirm which handler is responding
    console.log("[SUGGEST-SETTINGS v3] PUT", req.originalUrl, "schoolId=", schoolId, "actor=", {
      actorType: req.actor_ctx?.actorType,
      actorId: req.actor_ctx?.actorId,
      slug: req.actor_ctx?.slug,
      isSuperAdmin: !!req.actor_ctx?.isSuperAdmin,
    });

    // Required
    const preamble = (req.body?.preamble != null) ? String(req.body.preamble) : null;
    if (preamble == null) {
      return res.status(400).json({ ok: false, error: "missing_preamble" });
    }

    // Optional
    const default_language = (req.body?.default_language != null) ? String(req.body.default_language).trim() : "";
    const default_notes    = (req.body?.default_notes != null) ? String(req.body.default_notes).trim() : "";

    // Accept either key during transition
    const default_selected_metrics = Array.isArray(req.body?.default_selected_metrics)
      ? req.body.default_selected_metrics
      : (Array.isArray(req.body?.default_metrics) ? req.body.default_metrics : []);

    const saved = await upsertSuggestSettings({
      schoolId,
      preamble,
      default_language,
      default_notes,
      default_selected_metrics,
    });

    return res.json({
      ok: true,
      id: saved.id,
      preamble_prompt_id: saved.id, // keep FE stable
      preamble: saved.preamble,
      default_language: saved.default_language,
      default_notes: saved.default_notes,
      default_selected_metrics: Array.isArray(saved.default_selected_metrics)
        ? saved.default_selected_metrics
        : [],
    });
  } catch (e) {
    console.error("PUT suggest-settings failed:", e);
    return res.status(e.status || 500).json({
      ok: false,
      error: e.message || "server_error",
    });
  }
});
// =====================================================================
// AI REPORTS
// =====================================================================

// ---------------------------------------------------------------------
// AI Reports - existing (cache check)
// GET /api/admin/reports/existing?submission_id=123&ai_prompt_id=456
// IMPORTANT: scope enforced via submissions.school_id
// ---------------------------------------------------------------------
app.get("/api/admin/reports/existing", requireAdminAuth, async (req, res) => {
  try {
    const submissionId = Number(req.query.submission_id || 0);
    const promptId = Number(req.query.ai_prompt_id || 0);

    if (!submissionId) return res.status(400).json({ ok: false, error: "missing_submission_id" });
    if (!promptId) return res.status(400).json({ ok: false, error: "missing_ai_prompt_id" });

    // scope via submissions
    const sc = await pool.query(
      `SELECT school_id
       FROM submissions
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [submissionId]
    );
    if (!sc.rowCount) return res.status(404).json({ ok: false, error: "submission_not_found" });

    const schoolId = Number(sc.rows[0].school_id);
    assertSchoolScope(req, schoolId);

    const r = await pool.query(
      `SELECT report_text, created_at, model, temperature, max_output_tokens
       FROM ai_reports
       WHERE submission_id = $1 AND prompt_id = $2
       LIMIT 1`,
      [submissionId, promptId]
    );

    if (!r.rowCount) return res.json({ ok: true, exists: false });

    return res.json({
      ok: true,
      exists: true,
      report_text: r.rows[0].report_text,
      meta: {
        created_at: r.rows[0].created_at,
        model: r.rows[0].model,
        temperature: r.rows[0].temperature,
        max_output_tokens: r.rows[0].max_output_tokens,
      },
      source: "cache",
    });
  } catch (err) {
    const status = err?.status || 500;
    const code = status === 500 ? "existing_failed" : String(err.message || "error");
    if (status === 500) console.error("❌ /api/admin/reports/existing failed:", err);
    return res.status(status).json({ ok: false, error: code, message: err?.message });
  }
});

// ---------------------------------------------------------------------
// AI Reports - generate (cache + OpenAI + store)
// POST /api/admin/reports/generate
// body: { slug, submission_id, ai_prompt_id, force?: true }
// - if force=true -> bypass cache and re-generate (UPSERT overwrites)
// ---------------------------------------------------------------------
app.post("/api/admin/reports/generate", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.body?.slug || "").trim();
    const submissionId = Number(req.body?.submission_id || 0);
    const promptId = Number(req.body?.ai_prompt_id || 0);
    const force = req.body?.force === true;

    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });
    if (!submissionId) return res.status(400).json({ ok: false, error: "bad_submission_id" });
    if (!promptId) return res.status(400).json({ ok: false, error: "bad_prompt_id" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    // Prompt must belong to school + be active
    const p = await pool.query(
      `SELECT id, prompt_text, notes, language
       FROM ai_prompts
       WHERE id = $1 AND school_id = $2 AND is_active = true
       LIMIT 1`,
      [promptId, schoolId]
    );
    if (!p.rowCount) return res.status(404).json({ ok: false, error: "prompt_not_found" });

    const promptText = String(p.rows[0].prompt_text || "").trim();
    const notes = String(p.rows[0].notes || "").trim();
    const languageRaw =
      p.rows[0].language === null || p.rows[0].language === undefined
        ? ""
        : String(p.rows[0].language || "").trim();
    const language = languageRaw || null;

    if (!promptText) return res.status(400).json({ ok: false, error: "empty_prompt_text" });

    // Submission must belong to school, not deleted
    const sub = await pool.query(
      `SELECT *
       FROM submissions
       WHERE id = $1
         AND school_id = $2
         AND deleted_at IS NULL
       LIMIT 1`,
      [submissionId, schoolId]
    );
    if (!sub.rowCount) return res.status(404).json({ ok: false, error: "submission_not_found" });

    const row = sub.rows[0];

    // Variables available to template
    const vars = {
      question: row.question || "",
      transcript: row.transcript_clean || row.transcript || "",
      student: row.student_name || row.student_email || row.student_id || "",

      wpm: row.wpm ?? "",

      mss_fluency: row.mss_fluency ?? "",
      mss_grammar: row.mss_grammar ?? "",
      mss_pron: row.mss_pron ?? "",
      mss_vocab: row.mss_vocab ?? "",
      mss_cefr: row.mss_cefr ?? "",
      mss_toefl: row.mss_toefl ?? "",
      mss_ielts: row.mss_ielts ?? "",
      mss_pte: row.mss_pte ?? "",

      vox_score: row.vox_score ?? "",
    };

    // Render template with vars
    const renderedPromptText = renderPromptTemplate(promptText, vars).trim();
    if (!renderedPromptText) {
      return res.status(400).json({ ok: false, error: "rendered_prompt_empty" });
    }

    // Append notes + language to rendered prompt
    const parts = [renderedPromptText];
    if (notes) parts.push(`\n\n---\nNotes / Guidance:\n${notes}\n`);
    if (language) parts.push(`\n\n---\nOutput language:\n${language}\n`);
    const finalPrompt = parts.join("");

    const promptHash = sha256(finalPrompt);

    // Cache check (unless forced)
    if (!force) {
      const existing = await pool.query(
        `SELECT report_text
         FROM ai_reports
         WHERE submission_id = $1 AND prompt_id = $2
         LIMIT 1`,
        [submissionId, promptId]
      );

      if (existing.rowCount) {
        return res.json({
          ok: true,
          report_text: existing.rows[0].report_text,
          source: "cache",
          prompt_language: language,
          forced: false,
        });
      }
    }

    // Generate via OpenAI
    const ai = await openAiGenerateReport({
      promptText: finalPrompt,
      language,
      model: "gpt-4o-mini",
      temperature: 0.4,
      max_output_tokens: 900,
    });

    const reportText = String(ai.text || "").trim();

    await pool.query(
      `INSERT INTO ai_reports (submission_id, prompt_id, prompt_hash, model, temperature, max_output_tokens, report_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (submission_id, prompt_id)
       DO UPDATE SET
         report_text = EXCLUDED.report_text,
         prompt_hash = EXCLUDED.prompt_hash,
         model = EXCLUDED.model,
         temperature = EXCLUDED.temperature,
         max_output_tokens = EXCLUDED.max_output_tokens,
         updated_at = NOW()`,
      [submissionId, promptId, promptHash, ai.model, ai.temperature, ai.max_output_tokens, reportText]
    );

    return res.json({
      ok: true,
      report_text: reportText,
      source: "openai",
      prompt_language: language,
      forced: !!force,
    });
  } catch (err) {
    const status = err?.status || 500;
    const code = status === 500 ? "generate_failed" : String(err.message || "error");
    if (status === 500) console.error("❌ /api/admin/reports/generate error:", err);
    return res.status(status).json({ ok: false, error: code, message: err?.message });
  }
});

// ---------------------------------------------------------------------
// AI Reports - delete one cached report
// DELETE /api/admin/reports/:slug/:submission_id/:prompt_id
// Scoped delete via submissions.school_id (ai_reports has no school_id)
// ---------------------------------------------------------------------
app.delete("/api/admin/reports/:slug/:submission_id/:prompt_id", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    const submissionId = Number(req.params.submission_id || 0);
    const promptId = Number(req.params.prompt_id || 0);

    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });
    if (!submissionId) return res.status(400).json({ ok: false, error: "bad_submission_id" });
    if (!promptId) return res.status(400).json({ ok: false, error: "bad_prompt_id" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    await assertSubmissionBelongsToSchool(submissionId, schoolId);
    await assertPromptBelongsToSchool(promptId, schoolId);

    const del = await pool.query(
      `DELETE FROM ai_reports ar
       USING submissions s
       WHERE ar.submission_id = s.id
         AND ar.submission_id = $1
         AND ar.prompt_id = $2
         AND s.school_id = $3
         AND s.deleted_at IS NULL`,
      [submissionId, promptId, schoolId]
    );

    return res.json({ ok: true, deleted: del.rowCount > 0, deleted_count: del.rowCount || 0 });
  } catch (err) {
    const status = err?.status || 500;
    const code = status === 500 ? "delete_failed" : String(err.message || "error");
    if (status === 500) console.error("❌ /api/admin/reports delete error:", err);
    return res.status(status).json({ ok: false, error: code, message: err?.message });
  }
});

// =====================================================================
// Teacher Student Portal + Teacher Admin (Server.js) — CLEAN REGEN (Jan 2026)
// =====================================================================
//
// Assumptions (v1):
// - Legacy path: Admin JWT (req.admin) can resolve teacher ctx via admin email.
// - Canonical path: ACTOR JWT (req.actor) is used by new teacher_admin flows.
// - Non-super must have admin_schools access (legacy) OR token slug match (actor).
//
// NOTE:
// - Ensure these helpers are defined AFTER pool exists.
// - Ensure requireActorAuth runs before routes needing req.actor.
// - Remove ALL duplicate requireSchoolCtxFromActor definitions elsewhere.
//


// ---------------------------------------------------------------------
// Helper: Resolve school + teacher context from (admin JWT + slug)
// (legacy helper; candidate for deprecation)
//
// Returns:
// {
//   schoolId,
//   adminId,
//   adminEmail,
//   isSuper,
//   teacherId | null,
//   isAdminTeacher
// }
//
// On failure: sends response + returns null
// ---------------------------------------------------------------------
async function requireTeacherCtxFromAdmin(req, res, slug) {
  const a = req.admin || {};

  const adminId = Number(
    a.adminId ??
    a.admin_id ??
    a.aid ??
    a.id ??
    a.user_id ??
    0
  );

  const adminEmail = String(
    a.email ??
    a.adminEmail ??
    a.admin_email ??
    a.email_address ??
    ""
  ).trim().toLowerCase();

  const isSuper = !!(
    a.is_superadmin ||
    a.isSuperadmin ||
    a.isSuperAdmin ||
    a.isSuper ||
    a.superadmin
  );

  if (!adminId || !adminEmail) {
    res.status(401).json({ ok: false, error: "missing_admin_ctx" });
    return null;
  }

  // ------------------------------------------------------------
  // Resolve school
  // ------------------------------------------------------------
  const reqSlug = String(slug || "").trim();
  if (!reqSlug) {
    res.status(400).json({ ok: false, error: "missing_slug" });
    return null;
  }

  const s = await pool.query(
    `SELECT id FROM schools WHERE slug = $1 LIMIT 1`,
    [reqSlug]
  );
  if (!s.rowCount) {
    res.status(404).json({ ok: false, error: "school_not_found" });
    return null;
  }
  const schoolId = Number(s.rows[0].id);

  // ------------------------------------------------------------
  // School access check (non-super)
  // ------------------------------------------------------------
  if (!isSuper) {
    const ok = await pool.query(
      `SELECT 1
         FROM admin_schools
        WHERE admin_id = $1
          AND school_id = $2
        LIMIT 1`,
      [adminId, schoolId]
    );
    if (!ok.rowCount) {
      res.status(403).json({ ok: false, error: "forbidden_school" });
      return null;
    }
  }

  // ------------------------------------------------------------
  // Teacher lookup (explicit, no guessing)
  // ------------------------------------------------------------
  const t = await pool.query(
    `SELECT id, is_admin
       FROM teachers
      WHERE school_id = $1
        AND lower(email) = $2
      LIMIT 1`,
    [schoolId, adminEmail]
  );

  let teacherId = null;
  let isAdminTeacher = false;

  if (t.rowCount) {
    teacherId = Number(t.rows[0].id);
    isAdminTeacher = !!t.rows[0].is_admin;
  }

  // ------------------------------------------------------------
  // Optional: auto-create teacher ONLY if allowed
  // ------------------------------------------------------------
  if (!teacherId && isSuper === true) {
    const fullName = String(
      a.full_name ??
      a.fullName ??
      a.name ??
      ""
    ).trim() || null;

    const ins = await pool.query(
      `INSERT INTO teachers (school_id, email, full_name, is_active, is_admin)
       VALUES ($1, $2, $3, TRUE, TRUE)
       RETURNING id`,
      [schoolId, adminEmail, fullName]
    );

    teacherId = Number(ins.rows[0].id);
    isAdminTeacher = true;
  }

  return {
    schoolId,
    adminId,
    adminEmail,
    isSuper,
    teacherId,
    isAdminTeacher,
  };
}
// ---------------------------------------------------------------------
// Canonical ctx resolver for ACTOR JWT sessions (admin OR teacher_admin)
// - Uses req.actor ONLY (set by requireActorAuth)
// - Enforces slug scoping unless admin superadmin
// - Optionally hard-verifies slug->school_id matches DB
// ---------------------------------------------------------------------
async function requireSchoolCtxFromActor(req, res, slug) {
  const a = req.actor || {};

  const actorType = String(a.actorType || "").toLowerCase();
  const actorId = Number(a.actorId || 0) || null;

  let tokenSchoolId = (a.schoolId != null ? Number(a.schoolId) : null);
  let tokenSlug = String(a.slug || "").trim();

  const isSuperAdmin = (actorType === "admin" && a.isSuperAdmin === true);

  // Must be admin (ConfigAdmin is admin + superadmin only)
  if (actorType !== "admin") {
    res.status(403).json({ ok: false, error: "admin_required" });
    return null;
  }

  const reqSlug = String(slug || "").trim();
  if (!reqSlug) {
    res.status(400).json({ ok: false, error: "missing_slug" });
    return null;
  }

  // Hard-verify slug exists
  const s = await pool.query(`SELECT id FROM schools WHERE slug = $1 LIMIT 1`, [reqSlug]);
  if (!s.rowCount) {
    res.status(404).json({ ok: false, error: "school_not_found" });
    return null;
  }
  const dbSchoolId = Number(s.rows[0].id);

  // Superadmin: allowed cross-school; we still return ctx based on reqSlug
  if (isSuperAdmin) {
    return {
      schoolId: dbSchoolId,
      slug: reqSlug,
      actorType,
      actorId,
      isSuperAdmin,
      isTeacherAdmin: false,
    };
  }

  // ------------------------------------------------------------
  // BACK-COMPAT: token missing scope -> derive from DB
  // ------------------------------------------------------------
  if (!tokenSchoolId || !tokenSlug) {
    // Validate this admin is allowed to operate on reqSlug.
    // Adjust table names to match your schema (examples below).
    const ok = await pool.query(
      `
      SELECT 1
      FROM admin_schools x
      JOIN schools s ON s.id = x.school_id
      WHERE x.admin_id = $1 AND s.slug = $2
      LIMIT 1
      `,
      [actorId, reqSlug]
    );

    if (!ok.rowCount) {
      res.status(403).json({ ok: false, error: "school_scope_mismatch" });
      return null;
    }

    // “Upgrade” scope for this request
    tokenSchoolId = dbSchoolId;
    tokenSlug = reqSlug;
  }

  // Slug mismatch protection (non-superadmin)
  if (tokenSlug !== reqSlug) {
    res.status(403).json({ ok: false, error: "slug_mismatch" });
    return null;
  }

  // SchoolId mismatch protection
  if (dbSchoolId !== tokenSchoolId) {
    res.status(403).json({ ok: false, error: "school_scope_mismatch" });
    return null;
  }

  return {
    schoolId: dbSchoolId,
    slug: reqSlug,
    actorType,
    actorId,
    isSuperAdmin: false,
    isTeacherAdmin: false,
  };
}
// ---------------------------------------------------------------------
// Teacher Student Portal - v1 (list + detail + profile upsert)
// ---------------------------------------------------------------------

// GET /api/teacher/students?slug=...&q=...&activeOnly=1&tag=...&limit=200&offset=0
app.get("/api/teacher/students", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireTeacherCtxFromAdmin(req, res, slug);
    if (!ctx) return;

    const q = (req.query.q != null ? String(req.query.q) : "").trim() || null;

    const activeOnlyRaw = req.query.activeOnly;
    const activeOnly =
      activeOnlyRaw == null
        ? true
        : String(activeOnlyRaw) === "1" ||
          String(activeOnlyRaw).toLowerCase() === "true";

    const tag = (req.query.tag != null ? String(req.query.tag) : "").trim() || null;

    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const sql = `
      SELECT * FROM public.sp_students_for_teacher(
        p_school_id    := $1,
        p_teacher_id   := $2,
        p_q            := $3,
        p_active_only  := $4,
        p_tag          := $5,
        p_limit        := $6,
        p_offset       := $7
      )
    `;
    const { rows } = await pool.query(sql, [
      ctx.schoolId,
      ctx.teacherId,
      q,
      activeOnly,
      tag,
      limit,
      offset,
    ]);

    return res.json({ ok: true, students: rows });
  } catch (err) {
    console.error("GET /api/teacher/students failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// GET /api/teacher/students/:studentId?slug=...
app.get("/api/teacher/students/:studentId", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const studentId = Number(req.params.studentId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ ok: false, error: "bad_student_id" });
    }

    const ctx = await requireTeacherCtxFromAdmin(req, res, slug);
    if (!ctx) return;

    const sql = `
      SELECT * FROM public.sp_student_get_for_teacher(
        p_school_id   := $1,
        p_teacher_id  := $2,
        p_student_id  := $3
      )
    `;
    const { rows } = await pool.query(sql, [ctx.schoolId, ctx.teacherId, studentId]);

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    return res.json({ ok: true, student: rows[0] });
  } catch (err) {
    console.error("GET /api/teacher/students/:studentId failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// PUT /api/teacher/students/:studentId/profile?slug=...
// body: { phone?, date_started?, summary?, tags?[] }
app.put(
  "/api/teacher/students/:studentId/profile",
  requireAdminAuth,
  async (req, res) => {
    try {
      const slug = String(req.query.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

      const studentId = Number(req.params.studentId);
      if (!Number.isFinite(studentId) || studentId <= 0) {
        return res.status(400).json({ ok: false, error: "bad_student_id" });
      }

      const ctx = await requireTeacherCtxFromAdmin(req, res, slug);
      if (!ctx) return;

      const phone = req.body.phone != null ? String(req.body.phone).trim() : "";
      const summary = req.body.summary != null ? String(req.body.summary).trim() : "";

      // null or 'YYYY-MM-DD'
      const dateStartedRaw = req.body.date_started;
      const dateStarted =
        dateStartedRaw == null || String(dateStartedRaw).trim() === ""
          ? null
          : String(dateStartedRaw).trim();

      // tags: array of strings => jsonb array
      let tags = [];
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags
          .map((t) => String(t || "").trim())
          .filter((t) => t.length > 0)
          .slice(0, 50);
      }

      const sql = `
        SELECT * FROM public.sp_student_profile_upsert(
          p_school_id     := $1,
          p_teacher_id    := $2,
          p_student_id    := $3,
          p_phone         := $4,
          p_date_started  := $5::date,
          p_summary       := $6,
          p_tags          := $7::jsonb
        )
      `;
      const { rows } = await pool.query(sql, [
        ctx.schoolId,
        ctx.teacherId,
        studentId,
        phone,
        dateStarted,
        summary,
        JSON.stringify(tags),
      ]);

      const out = rows && rows[0] ? rows[0] : null;
      if (!out || out.ok !== true) {
        return res.status(400).json({ ok: false, error: "upsert_failed", detail: out || null });
      }

      return res.json({ ok: true, profile: out });
    } catch (err) {
      console.error("PUT /api/teacher/students/:studentId/profile failed", err);
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);

// ---------------------------------------------------------------------
// Teacher Admin - v1 (list + upsert)
// ---------------------------------------------------------------------

// GET /api/admin/teachers?slug=...&q=...&activeOnly=1&limit=200&offset=0
app.get("/api/admin/teachers", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireSchoolCtxFromActor(req, res, slug);
    if (!ctx) return;

    const q = (req.query.q != null ? String(req.query.q) : "").trim() || null;

    const activeOnlyRaw = req.query.activeOnly;
    const activeOnly =
      activeOnlyRaw == null
        ? true
        : String(activeOnlyRaw) === "1" ||
          String(activeOnlyRaw).toLowerCase() === "true";

    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const sql = `
      SELECT * FROM public.sp_teachers_for_school(
        p_school_id   := $1,
        p_q           := $2,
        p_active_only := $3,
        p_limit       := $4,
        p_offset      := $5
      )
    `;
    const { rows } = await pool.query(sql, [ctx.schoolId, q, activeOnly, limit, offset]);

    return res.json({ ok: true, teachers: rows });
  } catch (err) {
  console.error("GET /api/admin/teachers failed", err);
  return res.status(500).json({
    ok: false,
    error: "internal_error",
    detail: String(err?.message || err),
    code: err?.code || null
  });
}
});

// PUT /api/admin/teachers?slug=...
// body: { teacher_id?, email, full_name?, is_active? }
// PUT /api/admin/teachers?slug=...
// body: { teacher_id?, email, full_name?, is_active?, is_on_duty? }
//REMOVED TO ROUTES: app.put("/api/admin/teachers", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  
// ---------------------------------------------------------------------
// AUTH QA: deterministic "who am I"
// ---------------------------------------------------------------------
app.get("/api/auth/whoami", requireActorAuth, (req, res) => {
  return res.json({ ok: true, mode: req.auth?.mode || null, actor: req.actor || null });
});
// ---------------------------------------------------------------------
// Teacher Admin — On Duty (v1) (simple)
// ---------------------------------------------------------------------
//
// Behavior:
// - At most one on-duty teacher per school (enforced by partial unique index)
// - Setting on-duty clears previous on-duty teacher in that school
// - Can clear all (teacher_id omitted OR is_on_duty=false)
// - Reject setting on-duty for an inactive teacher
//

app.get("/api/admin/teachers/on-duty", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireSchoolCtxFromActor(req, res, slug);
    if (!ctx) return;

    const cur = await pool.query(
      `
      SELECT
        id,
        email,
        full_name,
        is_active,
        is_on_duty,
        created_at AS on_duty_since
      FROM teachers
      WHERE school_id = $1
        AND is_on_duty = true
      ORDER BY id DESC
      LIMIT 1
      `,
      [ctx.schoolId]
    );

    return res.json({ ok: true, onDuty: cur.rowCount ? cur.rows[0] : null });
  } catch (err) {
    console.error("GET /api/admin/teachers/on-duty failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});
// PUT /api/admin/teachers/on-duty?slug=...
// body: { teacher_id?, is_on_duty? }  // if teacher_id missing OR is_on_duty false => clear all on-duty
app.put("/api/admin/teachers/on-duty", requireActorAuth, requireAdminOrTeacherAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireSchoolCtxFromActor(req, res, slug);
    if (!ctx) return;

    const teacherId =
      req.body.teacher_id != null ? Number(req.body.teacher_id) :
      req.body.teacherId != null ? Number(req.body.teacherId) :
      null;

    const isOnDutyRaw = req.body.is_on_duty ?? req.body.isOnDuty;
    const isOnDuty =
      isOnDutyRaw == null
        ? true
        : String(isOnDutyRaw) === "1" || String(isOnDutyRaw).toLowerCase() === "true";

    await client.query("BEGIN");

    await client.query(
      `UPDATE teachers
          SET is_on_duty = false
        WHERE school_id = $1
          AND is_on_duty = true`,
      [ctx.schoolId]
    );

    let newOnDuty = null;

    if (isOnDuty && Number.isInteger(teacherId) && teacherId > 0) {
      const t = await client.query(
        `SELECT id, is_active
           FROM teachers
          WHERE school_id = $1
            AND id = $2
          LIMIT 1`,
        [ctx.schoolId, teacherId]
      );

      if (!t.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "teacher_not_found" });
      }

      if (t.rows[0].is_active !== true) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "teacher_inactive" });
      }

      const upd = await client.query(
        `UPDATE teachers
            SET is_on_duty = true
          WHERE school_id = $1
            AND id = $2
          RETURNING id, email, full_name, is_active, is_on_duty, created_at`,
        [ctx.schoolId, teacherId]
      );

      newOnDuty = upd.rows[0] || null;
    }

    await client.query("COMMIT");
    return res.json({ ok: true, onDuty: newOnDuty });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("PUT /api/admin/teachers/on-duty failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  } finally {
    client.release();
  }
});
// =================. NOTES .=====================//
// GET /api/admin/notes?slug=...&entity_type=teacher&entity_id=9&status=open&limit=50&offset=0
app.get("/api/admin/notes", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireTeacherCtxFromAdmin(req, res, slug);
    if (!ctx) return;

    const entityType = String(req.query.entity_type || "").trim();
    const entityId = Number(req.query.entity_id || 0);
    if (!entityType) return res.status(400).json({ ok: false, error: "missing_entity_type" });
    if (!Number.isFinite(entityId) || entityId <= 0) return res.status(400).json({ ok: false, error: "bad_entity_id" });

    const status = (req.query.status != null ? String(req.query.status) : "").trim() || null;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const sql = `SELECT * FROM public.sp_notes_for_entity($1,$2,$3,$4,$5,$6)`;
    const { rows } = await pool.query(sql, [ctx.schoolId, entityType, entityId, status, limit, offset]);

    return res.json({ ok: true, notes: rows });
  } catch (err) {
    console.error("GET /api/admin/notes failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// POST /api/admin/notes?slug=...
// body: { entity_type, entity_id, body, due_at?, tags?, meta? }
app.post("/api/admin/notes", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.query.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const ctx = await requireTeacherCtxFromAdmin(req, res, slug);
    if (!ctx) return;

    const adminId = (req.admin?.id || req.adminId || null);
    if (!adminId) return res.status(401).json({ ok: false, error: "missing_admin_ctx" });

    const entityType = String(req.body.entity_type || "").trim();
    const entityId = Number(req.body.entity_id || 0);
    const body = String(req.body.body || "").trim();

    if (!entityType) return res.status(400).json({ ok: false, error: "missing_entity_type" });
    if (!Number.isFinite(entityId) || entityId <= 0) return res.status(400).json({ ok: false, error: "bad_entity_id" });
    if (!body) return res.status(400).json({ ok: false, error: "missing_body" });

    const dueAtRaw = req.body.due_at;
    const dueAt = (dueAtRaw == null || String(dueAtRaw).trim() === "") ? null : String(dueAtRaw);

    const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    const meta = (req.body.meta && typeof req.body.meta === "object") ? req.body.meta : {};

    const sql = `SELECT * FROM public.sp_note_create($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`;
    const { rows } = await pool.query(sql, [
      ctx.schoolId,
      entityType,
      entityId,
      body,
      adminId,
      dueAt,
      JSON.stringify(tags),
      JSON.stringify(meta),
    ]);

    const out = rows && rows[0] ? rows[0] : null;
    if (!out || out.ok !== true) {
      return res.status(400).json({ ok: false, error: out?.error || "create_failed" });
    }

    return res.json({ ok: true, note_id: out.note_id });
  } catch (err) {
    console.error("POST /api/admin/notes failed", err);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

//Auth and role check Jan 11
// GET /api/admin/me  (authoritative admin context from DB-backed requireAdminAuth)
app.get("/api/admin/me", requireAdminAuth, async (req, res) => {
  try {
    const p = req.adminAuth?.payload || {};

    // actor token uses actorId; admin token may use adminId
    const adminId = Number(p.adminId || p.actorId || 0);
    if (!adminId) return res.status(401).json({ ok: false, error: "bad_admin_id" });

    const q = await pool.query(
      `SELECT id, email, full_name, is_superadmin, is_owner, school_id, is_active
       FROM admins
       WHERE id = $1
       LIMIT 1`,
      [adminId]
    );

    if (!q.rowCount) return res.status(401).json({ ok: false, error: "admin_not_found" });

    const a = q.rows[0];
    if (a.is_active === false) return res.status(403).json({ ok: false, error: "admin_inactive" });

    return res.json({ ok: true, admin: a });
  } catch (e) {
    console.error("❌ /api/admin/me error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
//=================== AI Prompt CRUD =======================//
app.get("/api/admin/ai-prompts/:slug", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    const r = await pool.query(
      `
      SELECT id, school_id, name, prompt_text, is_default, is_active, sort_order,
             notes, language, created_at, updated_at
      FROM ai_prompts
      WHERE school_id = $1
        AND COALESCE(name, '') <> '__SUGGEST_PREAMBLE__'
      ORDER BY 
        COALESCE(sort_order, 999999) ASC,
        is_default DESC,
        updated_at DESC,
        id DESC
      `,
      [schoolId]
    );

    return res.json({ ok: true, prompts: r.rows });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  }
});

app.post("/api/admin/ai-prompts/:slug", requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const name = String(req.body.name || "").trim();
    const promptText = String(req.body.prompt_text || "").trim();

    if (!name) return res.status(400).json({ ok: false, error: "missing_name" });
    if (!promptText) return res.status(400).json({ ok: false, error: "missing_prompt_text" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    const isDefault = req.body.is_default === true;
    const isActive = req.body.is_active !== false; // default true
    const sortOrder = req.body.sort_order != null ? Number(req.body.sort_order) : null;
    const notes = req.body.notes != null ? String(req.body.notes) : null;
    const language = req.body.language != null ? String(req.body.language) : null;

    await client.query("BEGIN");

    // If creating as default, clear other defaults first
    if (isDefault) {
      await client.query(
        `UPDATE ai_prompts SET is_default=false, updated_at=now() WHERE school_id=$1`,
        [schoolId]
      );
    }

    const ins = await client.query(
      `
      INSERT INTO ai_prompts (school_id, name, prompt_text, is_default, is_active, sort_order, notes, language)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, school_id, name, prompt_text, is_default, is_active, sort_order, notes, language, created_at, updated_at
      `,
      [schoolId, name, promptText, isDefault, isActive, sortOrder, notes, language]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, prompt: ins.rows[0] });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}

    if (String(e.message || "").includes("ux_ai_prompts_school_name")) {
      return res.status(409).json({ ok: false, error: "duplicate_name" });
    }

    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  } finally {
    client.release();
  }
});
app.put("/api/admin/ai-prompts/:slug/:id", requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.params.slug || "").trim();
    const id = Number(req.params.id || 0);

    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });
    if (!id) return res.status(400).json({ ok: false, error: "bad_id" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    // Ensure prompt belongs to school
    const exists = await client.query(
      `SELECT id, is_default FROM ai_prompts WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [id, schoolId]
    );
    if (!exists.rowCount) return res.status(404).json({ ok: false, error: "prompt_not_found" });

    // Field builder
    const fields = [];
    const vals = [];
    let n = 1;

    const setField = (col, v) => {
      fields.push(`${col}=$${n++}`);
      vals.push(v);
    };

    // ✅ DEFINE wantsDefault (this is your crash today)
    const wantsDefault = req.body?.is_default === true;

    // Build updates (only set fields that were provided)
    if (req.body.name != null) setField("name", String(req.body.name).trim());
    if (req.body.prompt_text != null) setField("prompt_text", String(req.body.prompt_text).trim());
    if (req.body.notes != null) setField("notes", String(req.body.notes));
    if (req.body.language != null) setField("language", String(req.body.language));
    if (req.body.sort_order != null) setField("sort_order", Number(req.body.sort_order));
    if (req.body.is_active != null) setField("is_active", req.body.is_active === true);

    await client.query("BEGIN");

    if (wantsDefault) {
      // clear all defaults for this school
      await client.query(
        `UPDATE ai_prompts SET is_default=false, updated_at=now() WHERE school_id=$1`,
        [schoolId]
      );
      setField("is_default", true);
      setField("is_active", true); // keep default active
    } else if (req.body.is_default === false) {
      // explicitly turning default off
      setField("is_default", false);
    }

    // Always touch updated_at if *anything* changes
    if (fields.length) setField("updated_at", new Date());

    if (!fields.length) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, prompt: exists.rows[0], unchanged: true });
    }

    // WHERE params
    vals.push(id, schoolId);

    const upd = await client.query(
      `
      UPDATE ai_prompts
         SET ${fields.join(", ")}
       WHERE id=$${n++} AND school_id=$${n++}
       RETURNING id, school_id, name, prompt_text, is_default, is_active, sort_order, notes, language, created_at, updated_at
      `,
      vals
    );

    await client.query("COMMIT");
    return res.json({ ok: true, prompt: upd.rows[0] });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}

    if (String(e.message || "").includes("ux_ai_prompts_school_name")) {
      return res.status(409).json({ ok: false, error: "duplicate_name" });
    }

    return res.status(e.status || 500).json({ ok: false, error: e.message || "server_error" });
  } finally {
    client.release();
  }
});
app.delete("/api/admin/ai-prompts/:slug/:id", requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.params.slug || "").trim();
    const id = Number(req.params.id || 0);
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });
    if (!id) return res.status(400).json({ ok: false, error: "bad_id" });

    const school = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, school.id);

    await client.query("BEGIN");

    const p = await client.query(
      `SELECT id, is_default FROM ai_prompts WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [id, school.id]
    );
    if (!p.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "prompt_not_found" });
    }

    // Prevent deleting the default (force user to change default first)
    if (p.rows[0].is_default) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "cannot_delete_default" });
    }

    const wantHard = String(req.query.hard || "") === "1";

    if (wantHard) {
      // only if not referenced
      const ref = await client.query(
        `SELECT 1 FROM ai_reports WHERE prompt_id=$1 LIMIT 1`,
        [id]
      );
      if (ref.rowCount) {
        // fall back to soft delete
        const soft = await client.query(
          `UPDATE ai_prompts SET is_active=false, updated_at=now() WHERE id=$1 AND school_id=$2 RETURNING id`,
          [id, school.id]
        );
        await client.query("COMMIT");
        return res.json({ ok: true, deleted: true, mode: "soft", id: soft.rows[0].id });
      }

      await client.query(`DELETE FROM ai_prompts WHERE id=$1 AND school_id=$2`, [id, school.id]);
      await client.query("COMMIT");
      return res.json({ ok: true, deleted: true, mode: "hard", id });
    }

    // default: soft delete
    const soft = await client.query(
      `UPDATE ai_prompts SET is_active=false, updated_at=now() WHERE id=$1 AND school_id=$2 RETURNING id`,
      [id, school.id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, deleted: true, mode: "soft", id: soft.rows[0].id });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  } finally {
    client.release();
  }
});
app.post("/api/admin/ai-prompts/:slug/:id/set-default", requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.params.slug || "").trim();
    const id = Number(req.params.id || 0);
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });
    if (!id) return res.status(400).json({ ok: false, error: "bad_id" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    await client.query("BEGIN");

    const p = await client.query(
      `SELECT id FROM ai_prompts WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [id, schoolId]
    );
    if (!p.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "prompt_not_found" });
    }

    await client.query(
      `UPDATE ai_prompts SET is_default=false, updated_at=now() WHERE school_id=$1`,
      [schoolId]
    );

    const upd = await client.query(
      `UPDATE ai_prompts SET is_default=true, is_active=true, updated_at=now()
       WHERE id=$1 AND school_id=$2
       RETURNING id, school_id, name, is_default, is_active, updated_at`,
      [id, schoolId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, prompt: upd.rows[0] });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    return res.status(e.status || 500).json({ ok: false, error: e.message || "server_error" });
  } finally {
    client.release();
  }
});
app.put("/api/admin/ai-prompts/:slug/reorder", requireAdminAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const slug = String(req.params.slug || "").trim();
    const order = Array.isArray(req.body.order) ? req.body.order : [];
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const school = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, school.id);

    await client.query("BEGIN");

    for (const item of order) {
      const id = Number(item?.id || 0);
      const so = item?.sort_order == null ? null : Number(item.sort_order);
      if (!id) continue;

      await client.query(
        `UPDATE ai_prompts SET sort_order=$1, updated_at=now()
         WHERE id=$2 AND school_id=$3`,
        [so, id, school.id]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    const status = e.status || 500;
    return res.status(status).json({ ok: false, error: e.message || "server_error" });
  } finally {
    client.release();
  }
});
// ---------------------------------------------------------------------
// AI Prompt Suggest Settings (per-school)
// Stored in ai_prompt_preamble
//
// GET /api/admin/ai-prompts/:slug/suggest-settings
// PUT /api/admin/ai-prompts/:slug/suggest-settings
// body: { preamble, default_language, default_notes, default_selected_metrics }
// also accepts: default_metrics (FE transition key)
// ---------------------------------------------------------------------

app.get("/api/admin/ai-prompts/:slug/suggest-settings", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    const s = await getOrCreateSuggestSettings({ schoolId });

    return res.json({
      ok: true,
      id: s.id,
      preamble_prompt_id: s.id, // keep FE stable (legacy name)
      preamble: s.preamble,
      default_language: s.default_language,
      default_notes: s.default_notes,
      default_selected_metrics: Array.isArray(s.default_selected_metrics) ? s.default_selected_metrics : [],
      exists: !!s.exists,
    });
  } catch (e) {
    console.error("GET suggest-settings failed:", e);
    return res.status(e.status || 500).json({ ok: false, error: e.message || "server_error" });
  }
});

app.put("/api/admin/ai-prompts/:slug/suggest-settings", requireAdminAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || "").trim();
    if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

    const { schoolId } = await resolveSchoolBySlug(slug);
    assertSchoolScope(req, schoolId);

    console.log("[SUGGEST-SETTINGS v2] PUT", req.originalUrl, "schoolId=", schoolId);

    const preamble = req.body?.preamble != null ? String(req.body.preamble) : null;
    if (preamble == null) return res.status(400).json({ ok: false, error: "missing_preamble" });

    const default_language = req.body?.default_language != null ? String(req.body.default_language) : "";
    const default_notes = req.body?.default_notes != null ? String(req.body.default_notes) : "";

    const default_selected_metrics = Array.isArray(req.body?.default_selected_metrics)
      ? req.body.default_selected_metrics
      : (Array.isArray(req.body?.default_metrics) ? req.body.default_metrics : []);

    const saved = await upsertSuggestSettings({
      schoolId,
      preamble,
      default_language,
      default_notes,
      default_selected_metrics,
    });

    return res.json({
      ok: true,
      id: saved.id,
      preamble_prompt_id: saved.id, // keep FE stable
      preamble: saved.preamble,
      default_language: saved.default_language,
      default_notes: saved.default_notes,
      default_selected_metrics: Array.isArray(saved.default_selected_metrics) ? saved.default_selected_metrics : [],
    });
  } catch (e) {
    console.error("PUT suggest-settings failed:", e);
    return res.status(e.status || 500).json({ ok: false, error: e.message || "server_error" });
  }
});
//bug tracking

// Deep route probe: recursively traverses nested routers
function collectRoutes(stack, prefix = "") {
  const out = [];

  for (const layer of stack || []) {
    // Direct route (app.get/post/etc)
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods || {})
        .filter(Boolean)
        .map(m => m.toUpperCase())
        .join(",");
      out.push(`${methods} ${prefix}${layer.route.path}`);
      continue;
    }

    // Nested router (app.use(...router))
    if (layer.name === "router" && layer.handle && layer.handle.stack) {
      // layer.regexp is not trivial to stringify; keep prefix as-is.
      // We still descend and collect children routes.
      out.push(...collectRoutes(layer.handle.stack, prefix));
    }
  }
  return out;
}

app.get("/api/__routes_probe", (req, res) => {
  const routes = collectRoutes(app._router?.stack || []);
  const ai = routes.filter(r => r.includes("ai-prompts"));
  const hasSuggest = ai.some(r => r.includes("POST /api/admin/ai-prompts/:slug/suggest"));
  res.json({
    ok: true,
    total: routes.length,
    ai_count: ai.length,
    hasSuggest,
    ai_routes: ai.sort()
  });
});
