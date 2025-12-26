//================================================//
//           API for AI - stub                    //
//================================================//

app.post("/api/portal/reports/:submissionId/ai", requireAdminOrTeacher, async (req, res) => {
  const submissionId = Number(req.params.submissionId);
  const force = !!req.body?.force;

  // 1) Load submission + school + student_email
  const { rows } = await pool.query(`
    SELECT
      s.id,
      s.school_id,
      s.question,
      COALESCE(s.transcript_clean, s.transcript, '') AS transcript,
      s.cefr, s.mss_cefr,
      s.mss_fluency, s.mss_pron, s.mss_grammar, s.mss_vocab, s.mss_overall,
      s.mss_toefl, s.mss_ielts, s.mss_pte,
      v.student_email
    FROM submissions s
    LEFT JOIN v_widget_reports v ON v.submission_id = s.id
    WHERE s.id = $1
    LIMIT 1
  `, [submissionId]);

  if (!rows.length) return res.status(404).json({ ok:false, error:"not_found" });
  const sub = rows[0];

  // 2) Return cached if exists
  const cached = await pool.query(`
    SELECT * FROM ai_reports WHERE submission_id = $1 LIMIT 1
  `, [submissionId]);

  if (cached.rowCount && !force && cached.rows[0].status === "ready") {
    return res.json({ ok:true, cached:true, report: cached.rows[0] });
  }

  // 3) Generate
  const PROMPT_VERSION = "ai-report-v1.0";
  const model = process.env.AI_MODEL || "gpt-4o-mini"; // example
  const prompt = buildTeacherReportPrompt(sub);

  try {
    // mark generating (upsert)
    await pool.query(`
      INSERT INTO ai_reports (school_id, submission_id, model, prompt_version, status)
      VALUES ($1,$2,$3,$4,'generating')
      ON CONFLICT (submission_id)
      DO UPDATE SET status='generating', model=EXCLUDED.model, prompt_version=EXCLUDED.prompt_version, updated_at=now()
    `, [sub.school_id, submissionId, model, PROMPT_VERSION]);

    const aiJson = await callLLM_JSON({ model, prompt }); // must return parsed JSON

    await pool.query(`
      UPDATE ai_reports
      SET status='ready',
          report_md=$1,
          email_subject=$2,
          email_body=$3,
          meta = COALESCE(meta,'{}'::jsonb) || $4::jsonb,
          updated_at=now()
      WHERE submission_id=$5
    `, [
      aiJson.report_markdown || "",
      aiJson.email_subject || "",
      aiJson.email_body || "",
      JSON.stringify({ generated_at: new Date().toISOString() }),
      submissionId
    ]);

    const final = await pool.query(`SELECT * FROM ai_reports WHERE submission_id=$1`, [submissionId]);
    return res.json({ ok:true, cached:false, report: final.rows[0] });

  } catch (e) {
    await pool.query(`
      UPDATE ai_reports SET status='failed', meta = COALESCE(meta,'{}'::jsonb) || $1::jsonb, updated_at=now()
      WHERE submission_id=$2
    `, [JSON.stringify({ error: String(e?.message || e) }), submissionId]);

    return res.status(500).json({ ok:false, error:"ai_failed" });
  }
});
