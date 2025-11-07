// db.js
import pkg from "pg";
const { Pool } = pkg;

const isProd = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProd ? { rejectUnauthorized: false } : undefined,
});

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

/**
 * Insert one submission row.
 * Accepts either snake_case (from server) or camelCase (from widget) fields.
 */
export async function insertSubmission(body = {}) {
  // Normalize fields to match the submissions table
  const sub = {
    school_id: body.school_id ?? body.schoolId ?? 1, // default demo school
    assessment_id: body.assessment_id ?? body.assessmentId ?? null,
    student_id: body.student_id ?? body.studentId ?? null,
    teacher_id: body.teacher_id ?? body.teacherId ?? null,
    ip: body.ip ?? null,
    record_count: body.record_count ?? body.recordCount ?? null,
    file_name: body.file_name ?? body.fileName ?? null,
    length_sec: body.length_sec ?? body.lengthSec ?? null,
    submit_time: body.submit_time ?? body.submitTime ?? null,
    toefl: body.toefl ?? null,
    ielts: body.ielts ?? null,
    pte: body.pte ?? null,
    cefr: body.cefr ?? null,
    question: body.question ?? null,
    transcript: body.transcript ?? null,
    wpm: body.wpm ?? null,
    meta: body.meta ? JSON.stringify(body.meta) : "{}", // jsonb/text column
  };

  const cols = Object.keys(sub);           // column names
  const values = Object.values(sub);       // values in the same order
  const placeholders = values.map((_, i) => `$${i + 1}`); // $1, $2, ...

  const sql = `
    INSERT INTO submissions (${cols.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING id;
  `;

  const { rows } = await pool.query(sql, values);
  return rows[0];
}