// routes/adminTeachers.routes.js
import express from "express";

/**
 * Admin Teachers Routes
 * Mounted at: /api/admin   (server.js does: app.use("/api/admin", router))
 *
 * Endpoints:
 *   PUT /teachers?slug=...
 *   GET /teachers?slug=...      (add later if you want)
 *   GET /teachers/on-duty?...   (add later)
 */
export function adminTeachersRouter({
  pool,
  requireAdminOrTeacherAdmin,
  requireSchoolCtxFromActor,
  asyncHandler,
}) {
  if (!pool) throw new Error("buildAdminTeachersRouter: missing pool");
  if (!requireAdminOrTeacherAdmin) throw new Error("buildAdminTeachersRouter: missing requireAdminOrTeacherAdmin");
  if (!requireSchoolCtxFromActor) throw new Error("buildAdminTeachersRouter: missing requireSchoolCtxFromActor");
  if (!asyncHandler) throw new Error("buildAdminTeachersRouter: missing asyncHandler");

  // ✅ This is exactly where it belongs
  const router = express.Router();

  router.put(
    "/teachers",
    requireAdminOrTeacherAdmin,
    asyncHandler(async (req, res) => {
      const slug = String(req.query.slug || "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "missing_slug" });

      const ctx = await requireSchoolCtxFromActor(req, res, slug);
      if (!ctx) return;

      const teacherId = req.body.teacher_id != null ? Number(req.body.teacher_id) : null;
      const email = String(req.body.email || "").trim();
      const fullName = (req.body.full_name != null ? String(req.body.full_name) : "").trim() || null;

      const isActiveRaw = req.body.is_active;
      const isActive =
        isActiveRaw == null ? true : (String(isActiveRaw) === "1" || String(isActiveRaw).toLowerCase() === "true");

      const isOnDutyRaw = req.body.is_on_duty;
      const isOnDuty =
        isOnDutyRaw == null ? false : (String(isOnDutyRaw) === "1" || String(isOnDutyRaw).toLowerCase() === "true");

      if (!email) return res.status(400).json({ ok: false, error: "missing_email" });

      const sql = `
        SELECT * FROM public.sp_teacher_upsert(
          p_school_id   := $1,
          p_email       := $2,
          p_teacher_id  := $3,
          p_full_name   := $4,
          p_is_active   := $5,
          p_is_on_duty  := $6
        )
      `;

      const { rows } = await pool.query(sql, [
        ctx.schoolId,
        email,
        teacherId,
        fullName,
        isActive,
        isOnDuty,
      ]);

      const out = rows && rows[0] ? rows[0] : null;
      if (!out || out.ok !== true) {
        return res.status(400).json({ ok: false, error: "upsert_failed", detail: out || null });
      }

      return res.json({ ok: true, teacher: out });
    })
  );

  return router;
}