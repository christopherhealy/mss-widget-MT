//RUN DATEKEY=2026-02-03 node scripts/ingle_good_morning.mjs or node scripts/ingle_good_morning.mjs

import pg from "pg";

const { Pool } = pg;

const SCHOOL_ID = 9999;

// If you want to seed a specific day:
// set DATEKEY=2026-02-03 node scripts/ingle_good_morning.mjs
const DATEKEY =
  process.env.DATEKEY ||
  new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const client = await pool.connect();
  try {
    console.log(`[Ingle Good Morning] Seeding dateKey=${DATEKEY} school_id=${SCHOOL_ID}`);

    await client.query("BEGIN");

    // 0) delete existing seeded batch for that day (safe rerun)
    await client.query(
      `
      DELETE FROM submissions
       WHERE deleted_at IS NULL
         AND (meta->>'mode')='ingle'
         AND (meta->>'dateKey')=$1
         AND (meta->>'user_pk') ~ '^[0-9]+$'
         AND (meta->>'user_pk')::bigint BETWEEN 900001 AND 900050
      `,
      [DATEKEY]
    );

    // 1) pick an active question
    const qpkRes = await client.query(
      `
      SELECT question_pk
        FROM ingle_questions
       WHERE school_id = $1
         AND is_active = true
       ORDER BY question_pk ASC
       LIMIT 1
      `,
      [SCHOOL_ID]
    );
    const qpk = qpkRes.rows?.[0]?.question_pk;
    if (!qpk) throw new Error(`No active ingle_questions for school_id=${SCHOOL_ID}`);

    // 2) reuse latest audio_key
    const audioRes = await client.query(
      `
      SELECT NULLIF(s.meta->>'audio_key','') AS audio_key
        FROM submissions s
       WHERE s.deleted_at IS NULL
         AND (s.meta->>'mode')='ingle'
         AND NULLIF(s.meta->>'audio_key','') IS NOT NULL
       ORDER BY s.created_at DESC
       LIMIT 1
      `
    );
    const audio_key = audioRes.rows?.[0]?.audio_key;
    if (!audio_key) throw new Error("Could not find any existing submissions.meta.audio_key to reuse");

    // 3) arrays
    const handles = [
      // India
      "aarav","diya","ishaan","kavya","rohan","anaya","vivaan","meera","arjun","saanvi",
      // Egypt
      "mohamed","fatma","youssef","nour","ahmed","mariam","omar","salma","ibrahim","hana",
      // Turkey
      "mehmet","ayse","mustafa","zeynep","emre","elif","kerem","selin","can","deniz",
      // China
      "liwei","xiaoyu","jing","hao","ying","chen","lin","wei","xinyi","zihan",
      // Korea
      "minjun","jiwoo","seojun","yuna","hyunwoo","soobin","jimin","dahyun","taehyun","sumin",
    ];

    const countries = [
      ...Array(10).fill("IN"),
      ...Array(10).fill("EG"),
      ...Array(10).fill("TR"),
      ...Array(10).fill("CN"),
      ...Array(10).fill("KR"),
    ];

    // 4) insert 50
    // distribution: 5 A1, 5 A2, 15 B1, 20 B2, 4 C1, 1 C2
    const cefrForN = (n) => {
      if (n <= 5) return "A1";
      if (n <= 10) return "A2";
      if (n <= 25) return "B1";
      if (n <= 45) return "B2";
      if (n <= 49) return "C1";
      return "C2";
    };

    // build bulk insert values
    const values = [];
    const params = [];
    let p = 1;

    for (let i = 1; i <= 50; i++) {
      const user_pk = 900000 + i;
      const handle = "@" + handles[i - 1];
      const country = countries[i - 1];
      const cefr = cefrForN(i);

      // created_at spread (12:00 + i minutes) UTC
      const createdAt = `${DATEKEY}T12:${String(i - 1).padStart(2, "0")}:00.000Z`;

      const meta = {
        mode: "ingle",
        dateKey: DATEKEY,
        handle,
        country_code: country,
        user_pk,
        ingle_question_pk: qpk,
        audio_key,
      };

      // 21 columns in your insert list in this script; keep aligned
      values.push(
        `($${p++}, NULL, NULL, NULL, NULL, $${p++}, $${p++}, NULL, $${p++}, $${p++}::jsonb, $${p++},` +
        ` NULL,NULL,NULL,NULL,NULL, $${p++}, NULL,NULL,NULL, NULL, NULL,NULL, 'ingle','ingle', NULL)`
      );

      params.push(
        SCHOOL_ID,                 // school_id
        32,                        // length_sec
        "Test Ingle question (seed data)", // question
        cefr,                      // cefr
        JSON.stringify(meta),      // meta
        createdAt,                 // created_at
        cefr                       // mss_cefr
      );
    }

    await client.query(
      `
      INSERT INTO submissions
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
        ${values.join(",\n")}
      `,
      params
    );

    await client.query("COMMIT");

    const dist = await client.query(
      `
      SELECT mss_cefr, count(*)
        FROM submissions
       WHERE deleted_at IS NULL
         AND (meta->>'mode')='ingle'
         AND (meta->>'dateKey')=$1
       GROUP BY 1
       ORDER BY 1
      `,
      [DATEKEY]
    );

    console.table(dist.rows);
    console.log(`[Ingle Good Morning] done. audio_key=${audio_key} qpk=${qpk}`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[Ingle Good Morning] FAILED:", e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();