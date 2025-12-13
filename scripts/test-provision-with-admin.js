/**
 * scripts/test-provision-with-admin.js
 *
 * Interactive tester for:
 *   public.mss_provision_school_with_admin(...)
 *
 * Write rule:
 *   - ONLY writes by executing the SP
 *   - SELECTs afterward are read-only QA checks
 *
 * Usage:
 *   export DATABASE_URL="postgresql://user:pass@host/db"
 *   node scripts/test-provision-with-admin.js
 */

import pg from "pg";
import bcrypt from "bcryptjs";
import readline from "readline";
import crypto from "crypto";

const { Pool } = pg;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(String(a || "").trim());
    })
  );
}

function slugifyLocal(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildPool() {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set.");

  // Render Postgres typically needs SSL; local often does not.
  const isRender = /render\.com/i.test(url);
  return new Pool({
    connectionString: url,
    ssl: isRender ? { rejectUnauthorized: false } : false,
  });
}

function makeUniqueSlug(baseSlug) {
  // collision-resistant: time + random suffix
  const rand = crypto.randomBytes(3).toString("hex"); // 6 chars
  return `${baseSlug}-${Date.now()}-${rand}`;
}

async function getRoutineSignature(client) {
  const { rows } = await client.query(
    `
    SELECT
      p.prokind AS kind,
      pg_get_function_identity_arguments(p.oid) AS args,
      pg_get_function_result(p.oid) AS result
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'mss_provision_school_with_admin'
    ORDER BY p.oid DESC
    LIMIT 1
    `
  );
  return rows;
}

function isSlugExistsError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "P0001" &&
    msg.includes("school with slug") &&
    msg.includes("already exists")
  );
}

async function main() {
  const schoolName = (await ask("School name: ")).trim();
  if (!schoolName) {
    console.error("School name is required.");
    process.exit(1);
  }

  const contactEmail = (await ask("Contact email: ")).trim().toLowerCase();
  if (!contactEmail) {
    console.error("Contact email is required.");
    process.exit(1);
  }

  const adminName =
    (contactEmail.includes("@") ? contactEmail.split("@")[0] : contactEmail)
      .replace(/\./g, " ")
      .trim() || "Admin";

  const rawPassword = "!Test123!";
  const sourceSlug = "mss-demo";
  const baseSlug = slugifyLocal(schoolName) || "new-school";

  const pool = buildPool();
  const client = await pool.connect();

  try {
    // Diagnostic: confirm routine signature matches what we think it is
    const sig = await getRoutineSignature(client);
    if (sig.length) {
      console.log("\nRoutine signature (diagnostic):");
      console.log(`- kind=${sig[0].kind} args=(${sig[0].args}) returns=${sig[0].result}`);
    } else {
      console.warn("\n⚠️ Could not find routine signature for public.mss_provision_school_with_admin");
    }

    // Read-only: pre-check for duplicate admin email
    const dup = await client.query(
      `SELECT id, school_id, email FROM admins WHERE lower(email)=lower($1) ORDER BY id`,
      [contactEmail]
    );
    if (dup.rowCount) {
      console.warn("\n⚠️ Admin email already exists in admins. Refusing to provision to avoid duplicates:");
      console.table(dup.rows);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);
    console.log("\nPassword hash sanity:");
    console.log(`- len=${passwordHash.length}, prefix=${passwordHash.slice(0, 4)}`);

    // Retry loop for extremely unlikely slug collisions
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const slug = makeUniqueSlug(baseSlug);

      console.log("\nProvisioning with:");
      console.log({
        schoolName,
        slug,
        contactEmail,
        adminName,
        password: rawPassword,
        sourceSlug,
      });

      await client.query("BEGIN");

      try {
        // ---- ONE write: call the SP ----
        const { rows } = await client.query(
          `SELECT * FROM public.mss_provision_school_with_admin($1,$2,$3,$4,$5,$6)`,
          [slug, schoolName, contactEmail, adminName, passwordHash, sourceSlug]
        );

        if (!rows?.length) {
          // If you see this but the DB still created records, the SP is not RETURN QUERY’ing a row.
          throw new Error("SP returned no rows (unexpected, since RETURNS TABLE).");
        }

        const out = rows[0];
        console.log("SP raw out:", out, "keys:", Object.keys(out || {}));

        const schoolId = out.school_id ?? out.schoolId ?? null;
        const adminId = out.admin_id ?? out.adminId ?? null;

        if (!schoolId || !adminId) {
          throw new Error(`Unexpected SP output: ${JSON.stringify(out)}`);
        }

        // ---- read-only QA checks ----
        const [schoolRes, adminRes, countsRes] = await Promise.all([
          client.query(`SELECT id, slug, name FROM schools WHERE id = $1`, [schoolId]),
          client.query(
            `
            SELECT id, email, full_name, school_id, is_owner, is_active, is_superadmin
            FROM admins
            WHERE id = $1
            `,
            [adminId]
          ),
          client.query(
            `
            SELECT
              (SELECT count(*) FROM assessments     WHERE school_id = $1) AS assessments,
              (SELECT count(*) FROM questions       WHERE school_id = $1) AS questions,
              (SELECT count(*) FROM questions_help  WHERE school_id = $1) AS helps,
              (SELECT count(*) FROM school_assets   WHERE school_id = $1) AS assets
            `,
            [schoolId]
          ),
        ]);

        await client.query("COMMIT");

        console.log("\n✅ PROVISIONING SUCCESSFUL\n");
        console.log("School   :", schoolRes.rows[0] || null);
        console.log("Admin    :", adminRes.rows[0] || null);
        console.log("Counts   :", countsRes.rows[0] || null);

        console.log("\nLOGIN DETAILS");
        console.log("-------------");
        console.log(`Email    : ${contactEmail}`);
        console.log(`Password : ${rawPassword}`);
        console.log(`Slug     : ${slug}`);

        console.log("\nNext QA step:");
        console.log("  - Log in via AdminLogin");
        console.log("  - School dropdown should show ONE school, selected & disabled");
        console.log("  - Config + Questions should load immediately");
        return;
      } catch (err) {
        await client.query("ROLLBACK");

        if (isSlugExistsError(err) && attempt < MAX_TRIES) {
          console.warn(`\n⚠️ Slug collision on attempt ${attempt}/${MAX_TRIES}. Retrying...`);
          continue;
        }

        console.error("\n❌ PROVISIONING FAILED");
        console.error(err?.message || err);
        if (err?.code) console.error("PG code:", err.code);
        process.exitCode = 1;
        return;
      }
    }

    console.error(`\n❌ PROVISIONING FAILED: exceeded ${MAX_TRIES} attempts due to slug collisions.`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e?.message || e);
  process.exit(1);
});