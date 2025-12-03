// utils/submissionPlaceholder.js
// ------------------------------------------------------------
// createOrReuseSubmissionPlaceholder()
//   Ensures each (slug, student, question) gets a placeholder
//   submission row BEFORE MSS scoring.
//
//   If a row is already created for this session → reuse it.
//   If not → create a clean placeholder.
// ------------------------------------------------------------

export async function createOrReuseSubmissionPlaceholder({
  pool,
  slug,
  schoolId,
  studentId = null,
  questionId = null,
  help_level = null,
  help_surface = null,
  widget_variant = null,
  dashboard_variant = null
}) {
  if (!pool) {
    throw new Error("Postgres pool is required");
  }
  if (!slug || !schoolId) {
    throw new Error("slug and schoolId required");
  }

  // ------------------------------------------------------------
  // 1) Try to locate an existing placeholder:
  //    A placeholder is defined as a row with the same:
  //    (school_id, student_id, question_id) AND no MSS meta yet
  // ------------------------------------------------------------
  const lookupSql = `
    SELECT id
      FROM submissions
     WHERE school_id = $1
       AND (student_id = $2 OR ($2 IS NULL AND student_id IS NULL))
       AND (question_id = $3 OR ($3 IS NULL AND question_id IS NULL))
       AND (meta IS NULL OR meta = '{}'::jsonb)
     ORDER BY id DESC
     LIMIT 1
  `;

  const lookupRes = await pool.query(lookupSql, [
    schoolId,
    studentId,
    questionId
  ]);

  if (lookupRes.rowCount) {
    const existingId = lookupRes.rows[0].id;
    console.log("🔁 Reusing existing placeholder submission:", existingId);
    return existingId;
  }

  // ------------------------------------------------------------
  // 2) No placeholder → create one
  // ------------------------------------------------------------
  const insertSql = `
    INSERT INTO submissions (
      school_id,
      student_id,
      question_id,
      help_level,
      help_surface,
      widget_variant,
      dashboard_variant,
      meta
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id
  `;

  const values = [
    schoolId,
    studentId,
    questionId,
    help_level,
    help_surface,
    widget_variant,
    dashboard_variant,
    {} // meta placeholder
  ];

  const insertRes = await pool.query(insertSql, values);
  const newId = insertRes.rows[0].id;

  console.log("🆕 Created new submission placeholder:", newId);

  return newId;
}