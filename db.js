// db.js
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

export async function insertSubmission(data) {
  const sql = `
    INSERT INTO submissions (
      school_id, assessment_id, student_id, teacher_id,
      ip, record_count, file_name, length_sec, submit_time,
      toefl, ielts, pte, cefr, question, transcript, wpm, meta
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING id;
  `;

  const values = [
    data.school_id || 1,
    data.assessment_id || null,
    data.student_id || null,
    data.teacher_id || null,
    data.ip || null,
    data.record_count || null,
    data.file_name || null,
    data.length_sec || null,
    data.submit_time || null,
    data.toefl || null,
    data.ielts || null,
    data.pte || null,
    data.cefr || null,
    data.question || null,
    data.transcript || null,
    data.wpm || null,
    data.meta ? JSON.stringify(data.meta) : null,
  ];

  const result = await query(sql, values);
  return result.rows[0];
}