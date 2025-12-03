const pool = require("../db");
const {
  createOrReuseSubmissionPlaceholder
} = require("../utils/submissionPlaceholder");

async function runTest() {
  const slug = "mss-demo";
  const schoolId = 1;
  const studentId = 123;
  const questionId = 7;

  const parallel = [];
  for (let i = 0; i < 10; i++) {
    parallel.push(
      createOrReuseSubmissionPlaceholder({
        pool,
        slug,
        schoolId,
        studentId,
        questionId,
        help_level: 0,
        help_surface: "none",
        widget_variant: "Widget.html",
        dashboard_variant: "Dashboard3.html"
      })
    );
  }

  const results = await Promise.all(parallel);
  console.log("All returned submission IDs:", results);
  await pool.end();
}

runTest();