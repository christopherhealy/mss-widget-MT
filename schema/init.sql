-- schema/init.sql
-- MSS Widget MT Database Schema

DROP TABLE IF EXISTS submissions CASCADE;

CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER,
  assessment_id INTEGER,
  student_id INTEGER,
  teacher_id INTEGER,
  ip TEXT,
  record_count INTEGER,
  file_name TEXT,
  length_sec NUMERIC,
  submit_time NUMERIC,
  toefl INTEGER,
  ielts NUMERIC,
  pte INTEGER,
  cefr TEXT,
  question TEXT,
  transcript TEXT,
  wpm INTEGER,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_submissions_created_at ON submissions(created_at DESC);
CREATE INDEX idx_submissions_school_id ON submissions(school_id);