// routes/ingles.routes.js (ESM)
//
// Ingle API (PoC → Cloudflare-ready design)
// ----------------------------------------
// Goals:
// - Keep identity + dateKey SERVER-owned (client cannot spoof)
// - Keep audio storage "key-based" so we can swap Disk → Cloudflare R2 later
// - Provide PUBLIC playback for feed rows (audioUrl), without auth
//
// Route surface:
//   GET  /api/ingles/today?date=YYYY-MM-DD&school_id=9999
//   GET  /api/ingles/me
//   POST /api/ingles/submit-audio        (auth required; multipart/form-data)
//   POST /api/ingles/submit              (auth required; JSON; references audio_key)
//   GET  /api/ingles/feed?date=YYYY-MM-DD&limit=50
//   GET  /api/ingles/dev/step?dir=prev|next&from=QUESTION_PK&school_id=9999  (localhost only)
//
// Notes:
// - This file does NOT register app.use("/ingle-audio", express.static(...)).
//   That belongs in server.js, because only server.js owns the Express "app".
// - submit-audio writes to disk under: ./public/ingle-audio/<audio_key>
// - server.js must expose: app.use("/ingle-audio", express.static("./public/ingle-audio"))
//   so anyone can GET /ingle-audio/<audio_key> for playback.

import express from "express";
import path from "path";
import fs from "fs/promises";
import multer from "multer";

import { requireIngleAuth, isLocalRequest } from "../auth/ingleAuth.js";

// School that owns the global public Ingle question bank.
const INGLE_BANK_SCHOOL_ID = 9999;

// Multer in-memory upload (we write the bytes ourselves).
// 25MB is enough for typical short speech recordings.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* -----------------------------
 * Date helpers (UTC canonical)
 * ----------------------------- */

function dateKeyUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function daysSinceEpochUTC(d = new Date()) {
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(utcMidnight / 86400000);
}

function parseDateKeyToUTC(dateKey) {
  if (!dateKey || typeof dateKey !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* -----------------------------
 * Audio URL helper (PoC)
 * ----------------------------- */
// IMPORTANT: audio_key is a STORAGE KEY, not a URL.
// For PoC (disk), server.js serves /ingle-audio/* from ./public/ingle-audio.
// Future (Cloudflare R2): build from key (public bucket) or signed URL.
function buildPublicAudioUrlFromMeta(meta) {
  try {
    const m = meta && typeof meta === "object" ? meta : {};
    const key = String(m.audio_key || m.audioKey || "").trim(); // tolerate legacy names
    if (!key) return null;
    return `/ingle-audio/${encodeURI(key)}`;
  } catch {
    return null;
  }
}

/* -----------------------------
 * MSS extraction helpers
 * (tolerant, schema-agnostic)
 * ----------------------------- */
function extractFromMss(mss) {
  const safeNum = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  const safeInt = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const elsa = mss?.elsa_results || mss?.elsa || {};
  const cefr =
    elsa?.cefr_level ||
    mss?.mss_cefr ||
    mss?.cefr ||
    mss?.cefr_level ||
    mss?.scores?.cefr ||
    mss?.details?.cefr ||
    null;

  const vox_score =
    safeNum(mss?.vox_score) ??
    safeNum(mss?.score) ??
    safeNum(mss?.overall_score) ??
    safeNum(mss?.overall?.score) ??
    null;

  const mss_overall = safeNum(mss?.overall ?? mss?.mss_overall);
  const mss_fluency = safeNum(mss?.fluency ?? mss?.mss_fluency);
  const mss_grammar = safeNum(mss?.grammar ?? mss?.mss_grammar);
  const mss_pron = safeNum(mss?.pron ?? mss?.pronunciation ?? mss?.mss_pron);
  const mss_vocab = safeNum(mss?.vocab ?? mss?.vocabulary ?? mss?.mss_vocab);

  const mss_toefl = safeInt(mss?.toefl ?? mss?.mss_toefl);
  const mss_ielts = safeNum(mss?.ielts ?? mss?.mss_ielts);
  const mss_pte = safeInt(mss?.pte ?? mss?.mss_pte);

  const transcript =
    mss?.transcript_clean ??
    mss?.transcript ??
    mss?.asr?.transcript ??
    null;

  return {
    cefr,
    vox_score,
    mss_overall,
    mss_fluency,
    mss_grammar,
    mss_pron,
    mss_vocab,
    mss_cefr: cefr,
    mss_toefl,
    mss_ielts,
    mss_pte,
    transcript,
  };
}

/* -----------------------------
 * Router factory
 * ----------------------------- */
// pool, asyncHandler are injected so this router stays testable.
export function inglesRouter({ pool, asyncHandler }) {
  const router = express.Router();

  /* ---------------------------------------------
   * POST /api/ingles/submit-audio
   * - Auth required
   * - Multipart upload (field name: "file")
   * - Writes bytes to disk (PoC)
   * - Returns audio_key + audioUrl (public URL for immediate playback)
   *
   * Client sequence (recommended):
   *   1) POST /submit-audio  (FormData with file)
   *   2) POST /submit        (JSON including audio_key)
   * --------------------------------------------- */
  router.post(
    "/submit-audio",
    requireIngleAuth,
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "missing_file" });
      }

      // Infer extension from original name (simple PoC).
      // You can tighten this further by validating req.file.mimetype.
      const original = String(req.file.originalname || "answer.wav");
      const ext = (original.split(".").pop() || "wav").toLowerCase();
      const safeExt = ["wav", "mp3", "webm", "ogg", "m4a"].includes(ext) ? ext : "wav";

      const userPk = Number(req.ingleUser?.user_pk || 0) || null;
      const handle = String(req.ingleUser?.handle || "anon").trim() || "anon";
      const dateKey = dateKeyUTC(new Date()); // SERVER-owned

      // Storage key (stable across Disk/R2).
      // Example: ingle/2026-02-03/123/1706960030123.wav
      const audio_key = `ingle/${dateKey}/${userPk || handle}/${Date.now()}.${safeExt}`;

      // PoC: write to disk under ./public/ingle-audio/<audio_key>
      // Full file path becomes: public/ingle-audio/ingle/2026-02-03/...
      const baseDir = path.join(process.cwd(), "public", "ingle-audio");
      const fullPath = path.join(baseDir, audio_key);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, req.file.buffer);

      // Public URL (PoC) — requires server.js static mount
      const audioUrl = `/ingle-audio/${audio_key}`;

      return res.json({ ok: true, audio_key, audioUrl, dateKey });
    })
  );

  /* ---------------------------------------------
   * GET /api/ingles/me
   * - Returns auth state to client
   * - Used for gating submit behind sign-in
   * --------------------------------------------- */
  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      if (!req.ingleUser) return res.json({ ok: false });

      return res.json({
        ok: true,
        user: {
          handle: req.ingleUser.handle || "anon",
          email: req.ingleUser.email || null,
          is_dev: !!req.ingleUser.is_dev,
        },
      });
    })
  );

  /* ---------------------------------------------
   * GET /api/ingles/today
   * Calendar-driven rotation across ingle_questions.
   *
   * Optional:
   *   ?date=YYYY-MM-DD   (dev viewing / QA)
   *   ?school_id=9999    (defaults INGLE_BANK_SCHOOL_ID)
   * --------------------------------------------- */
  router.get(
    "/today",
    asyncHandler(async (req, res) => {
      const schoolId = Number(req.query.school_id || INGLE_BANK_SCHOOL_ID);

      const dateParam = String(req.query.date || "").trim();
      const dateObj = dateParam ? parseDateKeyToUTC(dateParam) : new Date();

      const dateKey = dateKeyUTC(dateObj || new Date());
      const dayIdx = daysSinceEpochUTC(dateObj || new Date());

      const cRes = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM ingle_questions
          WHERE school_id = $1
            AND is_active = true`,
        [schoolId]
      );

      const n = cRes.rows?.[0]?.n || 0;
      if (!n) {
        return res.json({
          ok: false,
          error: "no_questions",
          message: `No active Ingle questions for school_id=${schoolId}`,
        });
      }

      const todayOffset = ((dayIdx % n) + n) % n;
      const tomorrowOffset = (todayOffset + 1) % n;

      const qSql = `
        SELECT question_pk, question
          FROM ingle_questions
         WHERE school_id = $1 AND is_active = true
         ORDER BY question_pk ASC
         OFFSET $2
         LIMIT 1
      `;

      const [qToday, qTom] = await Promise.all([
        pool.query(qSql, [schoolId, todayOffset]),
        pool.query(qSql, [schoolId, tomorrowOffset]),
      ]);

      const todayRow = qToday.rows?.[0] || null;
      const tomRow = qTom.rows?.[0] || null;

      if (!todayRow || !tomRow) {
        return res.json({
          ok: false,
          error: "fetch_failed",
          message: "Could not fetch today/tomorrow questions by offset.",
          schoolId,
          dateKey,
          count: n,
          offsets: { todayOffset, tomorrowOffset },
        });
      }

      const t = parseDateKeyToUTC(dateKey) || new Date();
      t.setUTCDate(t.getUTCDate() + 1);
      const tomorrowDateKey = dateKeyUTC(t);

      return res.json({
        ok: true,
        schoolId,
        dateKey,
        tomorrowDateKey,
        today: {
          question_pk: todayRow.question_pk,
          question: todayRow.question,
          offset: todayOffset,
        },
        tomorrow: {
          question_pk: tomRow.question_pk,
          question: tomRow.question,
          offset: tomorrowOffset,
        },
        count: n,
      });
    })
  );

  /* ---------------------------------------------
   * POST /api/ingles/submit
   * - Auth required
   * - JSON only (8mb)
   * - Client references audio_key produced by /submit-audio
   * - Server decides identity + dateKey (cannot spoof)
   * - One-and-done enforced per (email, dateKey) for PoC
   * --------------------------------------------- */
  router.post(
    "/submit",
    requireIngleAuth,               // MUST run before handler
    express.json({ limit: "8mb" }), // JSON only; audio is NOT sent here
    asyncHandler(async (req, res) => {
      const schoolId = INGLE_BANK_SCHOOL_ID;

      // Server-owned identity (do NOT trust client)
      const handle = String(req.ingleUser?.handle || "anon").trim() || "anon";
      const email = String(req.ingleUser?.email || "").trim().toLowerCase() || null;

      const user_pk = Number(req.ingleUser?.user_pk || 0) || null;
      const country_code =
        String(req.ingleUser?.country_code || "CA").trim().toUpperCase() || "CA";

      // Server-owned dateKey (UTC)
      const serverDateKey = dateKeyUTC(new Date());

      const {
        question_pk,
        question,
        length_sec,
        mss,
        help_level,
        help_surface,
        widget_variant,
        dashboard_variant,
        audio_key, // optional
      } = req.body || {};

      const qpk = Number(question_pk);
      if (!Number.isFinite(qpk) || qpk <= 0) {
        return res.status(400).json({ ok: false, error: "missing_question_pk" });
      }

      const qText = String(question || "").trim();
      if (!qText) {
        return res.status(400).json({ ok: false, error: "missing_question" });
      }

      const lenSec = (() => {
        const n = Number(length_sec);
        return Number.isFinite(n) && n > 0 ? n : null;
      })();

      const mssObj = mss && typeof mss === "object" ? mss : {};
      const extracted = extractFromMss(mssObj);

      // Optional audio key validation (recommended)
      const audioKey = String(audio_key || "").trim() || null;
      if (
        audioKey &&
        !/^ingle\/\d{4}-\d{2}-\d{2}\/.+\.(wav|mp3|webm|ogg|m4a)$/i.test(audioKey)
      ) {
        return res.status(400).json({ ok: false, error: "bad_audio_key" });
      }

      // One-and-done guard (PoC)
      // For concurrency-safe enforcement later: add a UNIQUE index.
      if (!req.ingleUser?.is_dev) {
        const already = await pool.query(
          `SELECT id
             FROM submissions
            WHERE school_id = $1
              AND deleted_at IS NULL
              AND (meta->>'mode') = 'ingle'
              AND (meta->>'dateKey') = $2
              AND COALESCE(student_email,'') = COALESCE($3,'')
            LIMIT 1`,
          [schoolId, serverDateKey, email]
        );

        if (already.rowCount) {
          return res.status(409).json({
            ok: false,
            error: "already_submitted_today",
            message: "You have already submitted today.",
          });
        }
      }

      // Meta: server-owned, plus optional audio_key
      const meta = {
        ...(req.body?.meta && typeof req.body.meta === "object" ? req.body.meta : {}),
        mode: "ingle",
        dateKey: serverDateKey,
        handle,
        email,
        user_pk,
        country_code,
        ingle_question_pk: qpk,
        ...(audioKey ? { audio_key: audioKey } : {}),
      };

      const ins = await pool.query(
        `INSERT INTO submissions
          (school_id, assessment_id, student_id, teacher_id,
           file_name, length_sec,
           question, transcript,
           cefr,
           meta,
           created_at,
           mss_overall, mss_fluency, mss_grammar, mss_pron, mss_vocab,
           mss_cefr, mss_toefl, mss_ielts, mss_pte,
           vox_score,
           help_level, help_surface, widget_variant, dashboard_variant,
           student_email)
         VALUES
          ($1, NULL, NULL, NULL,
           NULL, $2,
           $3, $4,
           $5,
           $6::jsonb,
           NOW(),
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16,
           $17, $18, $19, $20,
           $21)
         RETURNING id, created_at`,
        [
          schoolId,
          lenSec,
          qText,
          extracted.transcript,
          extracted.mss_cefr,
          JSON.stringify(meta),

          extracted.mss_overall,
          extracted.mss_fluency,
          extracted.mss_grammar,
          extracted.mss_pron,
          extracted.mss_vocab,

          extracted.mss_cefr,
          extracted.mss_toefl,
          extracted.mss_ielts,
          extracted.mss_pte,

          extracted.vox_score,

          help_level || null,
          help_surface || null,
          widget_variant || "ingle",
          dashboard_variant || "ingle",

          email,
        ]
      );

      const row = ins.rows?.[0];
      
            // ---- stats (soft fail; do not block submit) ----
      let stats = null;
      let counts = { followers_count: 0, following_count: 0 };

      try {
        if (!user_pk) throw new Error("missing_user_pk");

        const statsQ = await pool.query(
          `SELECT * FROM sp_ingle_apply_submit_stats($1::bigint, $2::date)`,
          [user_pk, serverDateKey]
        );
        stats = statsQ.rows?.[0] || null;

        const countsQ = await pool.query(
          `SELECT followers_count, following_count
             FROM ingle_users
            WHERE user_pk = $1::bigint`,
          [user_pk]
        );
        counts = countsQ.rows?.[0] || counts;
      } catch (e) {
        console.warn("[INGLE] stats update failed:", e?.message || e);
      }

      return res.json({
            ok: true,
            submissionId: row?.id,
            created_at: row?.created_at,
            dateKey: serverDateKey,
            handle,

            stats: stats
                ? {
                    total_recordings: stats.total_recordings,
                    current_streak: stats.current_streak,
                    best_streak: stats.best_streak,
                    last_submit_date: stats.last_submit_date,
                }
                : null,

            followers_count: counts.followers_count ?? 0,
            following_count: counts.following_count ?? 0,
            });
    })
  );

  /* ---------------------------------------------
   * GET /api/ingles/feed?date=YYYY-MM-DD&limit=50
   * - Public feed for a dateKey
   * - Includes PUBLIC audioUrl (if submission.meta.audio_key exists)
   * - viewerUserPk is optional; if auth middleware decorates req.ingleUser, we can compute is_following
   * --------------------------------------------- */
  router.get(
    "/feed",
    asyncHandler(async (req, res) => {
      const schoolId = INGLE_BANK_SCHOOL_ID;
      const dateKey = String(req.query.date || "").trim();
      const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return res.status(400).json({ ok: false, error: "bad_date" });
      }

      // Optional viewer identity. If your global auth middleware sets req.ingleUser, this works.
      const viewerUserPk = Number(req.ingleUser?.user_pk || 0) || null;

      const q = await pool.query(
        `
        WITH s AS (
            SELECT
            id,
            created_at,
            question,
            length_sec,
            vox_score,
            mss_cefr,
            meta
            FROM submissions
            WHERE school_id = $1
            AND deleted_at IS NULL
            AND (meta->>'mode') = 'ingle'
            AND (meta->>'dateKey') = $2
            ORDER BY created_at DESC
            LIMIT $3
        )
        SELECT
            s.*,

            -- meta identity
            COALESCE(NULLIF(s.meta->>'country_code',''), 'CA') AS country_code,
            NULLIF(s.meta->>'handle','') AS handle,
            NULLIF(s.meta->>'user_pk','')::bigint AS user_pk,

            -- join to user stats (may be NULL if user not in ingle_users)
            COALESCE(u.total_recordings, 0) AS total_recordings,
            COALESCE(u.current_streak, 0)   AS current_streak,
            COALESCE(u.followers_count, 0)  AS followers_count,
            COALESCE(u.following_count, 0)  AS following_count,

            CASE
            WHEN $4::bigint IS NULL THEN NULL
            WHEN NULLIF(s.meta->>'user_pk','') IS NULL THEN NULL
            ELSE EXISTS (
                SELECT 1
                FROM ingle_follows f
                WHERE f.follower_user_pk = $4::bigint
                AND f.followed_user_pk = (s.meta->>'user_pk')::bigint
            )
            END AS is_following
        FROM s
        LEFT JOIN ingle_users u
            ON u.user_pk = NULLIF(s.meta->>'user_pk','')::bigint
        `,
        [schoolId, dateKey, limit, viewerUserPk]
        );

        const items = (q.rows || []).map((r) => {
        const meta = r.meta || {};
        const handle = r.handle || String(meta.handle || "").trim() || "anon";

        return {
        id: r.id,
        created_at: r.created_at,

        // identity (for UI features like follow)
        user_pk: r.user_pk ?? null,
        handle,
        country_code: r.country_code || "CA",
        is_following: r.is_following ?? null,

        // scoring / display
        cefr: r.mss_cefr || null,
        question: r.question || "",
        length_sec: r.length_sec ?? null,

        // ✅ counters for UI
        total: Number(r.total_recordings || 0),
        streak: Number(r.current_streak || 0),
        followers_count: Number(r.followers_count || 0),
        following_count: Number(r.following_count || 0),

        // public playback
        audioUrl: buildPublicAudioUrlFromMeta(meta),

        dashboardUrl: null,
        meta: {
            ingle_question_pk: meta.ingle_question_pk ?? null,
        },
        };
    });

      return res.json({ ok: true, dateKey, items });
    })
  );

  /* ---------------------------------------------
   * GET /api/ingles/dev/step?dir=prev|next&from=QUESTION_PK
   * - Dev-only stepping through question bank
   * - Restricted to localhost
   * --------------------------------------------- */
  router.get(
    "/dev/step",
    asyncHandler(async (req, res) => {
      if (!isLocalRequest(req)) {
        return res.status(403).json({ ok: false, error: "dev_only" });
      }

      const schoolId = Number(req.query.school_id || INGLE_BANK_SCHOOL_ID);
      const dir = String(req.query.dir || "next").toLowerCase();
      const fromPk = Number(req.query.from || 0);

      if (!fromPk) {
        return res.status(400).json({
          ok: false,
          error: "missing_from",
          message: "Provide ?from=<question_pk>",
        });
      }

      let todayRow = null;

      if (dir === "prev") {
        const prev = await pool.query(
          `SELECT question_pk, question
             FROM ingle_questions
            WHERE school_id = $1
              AND is_active = true
              AND question_pk < $2
            ORDER BY question_pk DESC
            LIMIT 1`,
          [schoolId, fromPk]
        );

        if (prev.rowCount) {
          todayRow = prev.rows[0];
        } else {
          const last = await pool.query(
            `SELECT question_pk, question
               FROM ingle_questions
              WHERE school_id = $1 AND is_active = true
              ORDER BY question_pk DESC
              LIMIT 1`,
            [schoolId]
          );
          todayRow = last.rows?.[0] || null;
        }
      } else {
        const next = await pool.query(
          `SELECT question_pk, question
             FROM ingle_questions
            WHERE school_id = $1
              AND is_active = true
              AND question_pk > $2
            ORDER BY question_pk ASC
            LIMIT 1`,
          [schoolId, fromPk]
        );

        if (next.rowCount) {
          todayRow = next.rows[0];
        } else {
          const first = await pool.query(
            `SELECT question_pk, question
               FROM ingle_questions
              WHERE school_id = $1 AND is_active = true
              ORDER BY question_pk ASC
              LIMIT 1`,
            [schoolId]
          );
          todayRow = first.rows?.[0] || null;
        }
      }

      if (!todayRow) {
        return res.json({ ok: false, error: "no_questions", schoolId });
      }

      // tomorrow = next after today (wrap)
      let tomRow = null;
      const tom = await pool.query(
        `SELECT question_pk, question
           FROM ingle_questions
          WHERE school_id = $1
            AND is_active = true
            AND question_pk > $2
          ORDER BY question_pk ASC
          LIMIT 1`,
        [schoolId, Number(todayRow.question_pk)]
      );

      if (tom.rowCount) {
        tomRow = tom.rows[0];
      } else {
        const first = await pool.query(
          `SELECT question_pk, question
             FROM ingle_questions
            WHERE school_id = $1 AND is_active = true
            ORDER BY question_pk ASC
            LIMIT 1`,
          [schoolId]
        );
        tomRow = first.rows?.[0] || null;
      }

      return res.json({
        ok: true,
        schoolId,
        today: todayRow,
        tomorrow: tomRow,
      });
    })
  );

  return router;
}