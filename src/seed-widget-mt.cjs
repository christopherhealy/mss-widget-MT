// src/seed-widget-mt.cjs
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  // 1) Ensure school_assets exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS school_assets (
      id          SERIAL PRIMARY KEY,
      school_id   INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (school_id, kind)
    );
  `);

  const schoolSlug = 'mss-demo';

  // 2) Get OR CREATE school.id from slug
  let schoolId;
  const result = await client.query(
    `SELECT id FROM schools WHERE slug = $1`,
    [schoolSlug]
  );

  if (result.rowCount === 0) {
    const insert = await client.query(
      `INSERT INTO schools (slug, name)
       VALUES ($1, $2)
       RETURNING id`,
      [schoolSlug, 'MySpeakingScore Demo School']
    );
    schoolId = insert.rows[0].id;
    console.log('Created new school with slug:', schoolSlug);
  } else {
    schoolId = result.rows[0].id;
    console.log('Using existing school with slug:', schoolSlug);
  }

  // 3) Read JSON files (now directly from src/, same folder as this script)
  const baseDir = __dirname; // src/

  const configJson = JSON.parse(
    fs.readFileSync(path.join(baseDir, 'config.json'), 'utf-8')
  );
  const formJson = JSON.parse(
    fs.readFileSync(path.join(baseDir, 'form.json'), 'utf-8')
  );

  // 4) Update schools.settings -> widgetConfig + widgetForm
  await client.query(
    `
    UPDATE schools
    SET settings =
      jsonb_set(
        jsonb_set(
          COALESCE(settings, '{}'::jsonb),
          '{widgetConfig}', $2::jsonb, true
        ),
        '{widgetForm}', $3::jsonb, true
      )
    WHERE slug = $1;
    `,
    [schoolSlug, configJson, formJson]
  );

  // 5) Read image into BYTEA
  // Rename your image file in src/ to 'logo.png' OR change this name.
  const imagePath = path.join(baseDir, 'logo.png');
  if (fs.existsSync(imagePath)) {
    const imageBuffer = fs.readFileSync(imagePath);
    const imageMime = 'image/png'; // change if JPEG, etc.

    await client.query(
      `
      INSERT INTO school_assets (school_id, kind, mime_type, data)
      VALUES ($1, 'widget-logo', $2, $3)
      ON CONFLICT (school_id, kind)
      DO UPDATE SET
        mime_type = EXCLUDED.mime_type,
        data      = EXCLUDED.data,
        created_at = NOW();
      `,
      [schoolId, imageMime, imageBuffer]
    );
    console.log('Logo image stored for school:', schoolSlug);
  } else {
    console.log('No logo.png found in src/, skipping image seed.');
  }

  console.log('WidgetMT seed complete for school:', schoolSlug);
  await client.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});