--
-- PostgreSQL database dump
--

\restrict uPWSmWSpsc3GApVGTaMbPQrZyiQbZdtAr9aARRh6VaKQ2zzxUs6VuKO8p305Wfg

-- Dumped from database version 17.6 (Debian 17.6-2.pgdg12+1)
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: msswidgetmt_db_user
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO msswidgetmt_db_user;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: clean_transcript(text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.clean_transcript(html_input text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  no_tags   text;
  decoded   text;
BEGIN
  -- 1. Strip HTML tags
  no_tags := regexp_replace(html_input, '<[^>]+>', '', 'gi');

  -- 2. Convert the most common HTML entities manually
  -- (We can easily add more later.)
  decoded := no_tags;

  decoded := replace(decoded, '&nbsp;', ' ');
  decoded := replace(decoded, '&lt;',   '<');
  decoded := replace(decoded, '&gt;',   '>');
  decoded := replace(decoded, '&amp;',  '&');
  decoded := replace(decoded, '&quot;', '"');
  decoded := replace(decoded, '&#39;',  '''');

  -- 3. Convert numeric entities like &#8201; → actual Unicode
  decoded := regexp_replace(
      decoded,
      '&#([0-9]+);',
      chr((regexp_matches(decoded, '&#([0-9]+);'))[1]::int),
      'g'
  );

  RETURN decoded;
END;
$$;


ALTER FUNCTION public.clean_transcript(html_input text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_clone_school_content_from_slug(text, integer); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_clone_school_content_from_slug(p_src_slug text, p_target_school_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_src_school_id   integer;
  v_new_assessment_id integer;
  v_new_question_id   integer;
  v_count_questions   integer := 0;

  src_ass   record;
  src_q     record;
  src_help  record;
BEGIN
  -- 1) Find source school
  SELECT id
  INTO v_src_school_id
  FROM schools
  WHERE slug = p_src_slug;

  IF v_src_school_id IS NULL THEN
    RAISE EXCEPTION 'Source school with slug % not found', p_src_slug;
  END IF;

  -- 2) Temp maps: old→new IDs
  CREATE TEMP TABLE tmp_assessment_map (
    old_id integer,
    new_id integer
  ) ON COMMIT DROP;

  CREATE TEMP TABLE tmp_question_map (
    old_id integer,
    new_id integer
  ) ON COMMIT DROP;

  --------------------------------------------------------------------
  -- 3) Clone assessments from source → target
  --------------------------------------------------------------------
  FOR src_ass IN
    SELECT *
    FROM assessments
    WHERE school_id = v_src_school_id
  LOOP
    INSERT INTO assessments (
      school_id,
      name,
      description,
      is_active
      -- , ... any other columns EXCEPT id
    )
    VALUES (
      p_target_school_id,
      src_ass.name,
      src_ass.description,
      src_ass.is_active
      -- , ... same extra columns
    )
    RETURNING id INTO v_new_assessment_id;

    INSERT INTO tmp_assessment_map(old_id, new_id)
    VALUES (src_ass.id, v_new_assessment_id);
  END LOOP;

  --------------------------------------------------------------------
  -- 4) Clone questions, preserving assessment mapping
  --------------------------------------------------------------------
  FOR src_q IN
    SELECT q.*, m.new_id AS new_assessment_id
    FROM questions q
    JOIN tmp_assessment_map m
      ON m.old_id = q.assessment_id
  LOOP
    INSERT INTO questions (
      assessment_id,
      sort_order,
      prompt,
      prompt_short,
      is_active
      -- , ... other columns EXCEPT id
    )
    VALUES (
      src_q.new_assessment_id,
      src_q.sort_order,
      src_q.prompt,
      src_q.prompt_short,
      src_q.is_active
      -- , ... same extras
    )
    RETURNING id INTO v_new_question_id;

    INSERT INTO tmp_question_map(old_id, new_id)
    VALUES (src_q.id, v_new_question_id);

    v_count_questions := v_count_questions + 1;
  END LOOP;

  --------------------------------------------------------------------
  -- 5) Clone help rows (if you have a separate help table)
  --------------------------------------------------------------------
  -- Adjust table / columns if your help table has a different name.
  FOR src_help IN
    SELECT h.*, qm.new_id AS new_question_id
    FROM question_help h
    JOIN tmp_question_map qm
      ON qm.old_id = h.question_id
  LOOP
    INSERT INTO question_help (
      question_id,
      help_level,
      surface,
      body
      -- , ... other columns EXCEPT id
    )
    VALUES (
      src_help.new_question_id,
      src_help.help_level,
      src_help.surface,
      src_help.body
      -- , ...
    );
  END LOOP;

  --------------------------------------------------------------------
  -- 6) Images / branding
  --------------------------------------------------------------------
  -- Logo / image in most setups is already cloned when you copied
  -- schools.branding/settings/api. If you also keep rows in a
  -- school_images table, clone those here:
  --
  -- INSERT INTO school_images (school_id, kind, url, alt_text)
  -- SELECT p_target_school_id, kind, url, alt_text
  -- FROM school_images
  -- WHERE school_id = v_src_school_id;
  --------------------------------------------------------------------

  RETURN v_count_questions;
END;
$$;


ALTER FUNCTION public.mss_clone_school_content_from_slug(p_src_slug text, p_target_school_id integer) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_clone_school_defaults(integer, text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_clone_school_defaults(p_new_school_id integer, p_demo_school_slug text DEFAULT 'mss-demo'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_demo_school_id      integer;
  v_demo_assessment_id  integer;
  v_new_assessment_id   integer;
BEGIN
  -- 1) Locate demo school
  SELECT id
  INTO   v_demo_school_id
  FROM   schools
  WHERE  slug = p_demo_school_slug
  LIMIT  1;

  IF v_demo_school_id IS NULL THEN
    RAISE EXCEPTION 'Demo school with slug=% not found', p_demo_school_slug;
  END IF;

  -- 2) Pick the demo assessment to clone (you can refine this if needed)
  SELECT id
  INTO   v_demo_assessment_id
  FROM   assessments
  WHERE  school_id = v_demo_school_id
  ORDER  BY id
  LIMIT  1;

  IF v_demo_assessment_id IS NULL THEN
    RAISE EXCEPTION 'No assessment found for demo school id=%', v_demo_school_id;
  END IF;

  -- 3) Clone assessment row for the new school
  INSERT INTO assessments (
    school_id,
    name,
    description,
    -- add any other columns that matter, in the same order:
    -- e.g. is_active, meta, created_at, etc.
    is_active
  )
  SELECT
    p_new_school_id,
    name,
    description,
    is_active
  FROM assessments
  WHERE id = v_demo_assessment_id
  RETURNING id INTO v_new_assessment_id;

  -- 4) Clone questions (including help text etc.)
  INSERT INTO questions (
    assessment_id,
    ordinal,
    prompt,
    help_text,
    model_answer,
    meta
    -- add or remove columns to fit your schema
  )
  SELECT
    v_new_assessment_id,
    ordinal,
    prompt,
    help_text,
    model_answer,
    meta
  FROM questions
  WHERE assessment_id = v_demo_assessment_id;

  -- 5) Copy branding/settings, but keep new name/slug
  UPDATE schools s
  SET
    branding = d.branding,  -- copy logo etc
    settings = jsonb_set(
      COALESCE(s.settings, '{}'::jsonb),
      '{assessmentId}',
      to_jsonb(v_new_assessment_id),
      true
    )
  FROM schools d
  WHERE s.id = p_new_school_id
    AND d.id = v_demo_school_id;

  RAISE NOTICE 'Cloned defaults from demo school %, assessment % → new assessment %',
      v_demo_school_id, v_demo_assessment_id, v_new_assessment_id;
END;
$$;


ALTER FUNCTION public.mss_clone_school_defaults(p_new_school_id integer, p_demo_school_slug text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_create_school_from_slug(text, text, text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_create_school_from_slug(new_slug text, new_name text, source_slug text DEFAULT 'mss-demo'::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN mss_provision_school_from_slug(new_slug, new_name, source_slug);
END;
$$;


ALTER FUNCTION public.mss_create_school_from_slug(new_slug text, new_name text, source_slug text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_finalize_school_signup(integer, text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_finalize_school_signup(p_signup_id integer, p_source_slug text DEFAULT 'mss-demo'::text) RETURNS TABLE(school_id integer, admin_id integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_signup     school_signups%ROWTYPE;
  v_school_id  INTEGER;
  v_admin_id   INTEGER;
BEGIN
  -- 1. Lock the signup row so we don't double-finalize
  SELECT *
  INTO v_signup
  FROM school_signups
  WHERE id = p_signup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'school_signups row not found for id=%', p_signup_id;
  END IF;

  -- Idempotent: if already verified, just return the stored IDs
  IF v_signup.verified_at IS NOT NULL THEN
    school_id := v_signup.school_id;
    admin_id  := v_signup.admin_id;
    RETURN;
  END IF;

  -- 2. Create the cloned school (this also clones questions/help/assets,
  --    based on the mss_create_school_from_slug you already QA’d)
  v_school_id := mss_create_school_from_slug(
    v_signup.school_slug,
    v_signup.school_name,
    p_source_slug
  );

  -- 3. Patch the school row with the human-entered data
  UPDATE schools
  SET
    name          = v_signup.school_name,
    website       = v_signup.website_url,
    contact_name  = v_signup.contact_name,
    contact_email = v_signup.contact_email,
    country       = v_signup.country,
    time_zone     = v_signup.time_zone
  WHERE id = v_school_id;

  -- 4. Create the first admin user for this school
  INSERT INTO admins (
    email,
    full_name,
    password_hash,
    school_id,
    is_superadmin,
    is_active
  )
  VALUES (
    v_signup.contact_email,
    v_signup.contact_name,
    v_signup.admin_password_hash,
    v_school_id,
    FALSE,
    TRUE
  )
  RETURNING id INTO v_admin_id;

  -- 5. Mark signup as verified & attach the new IDs
  UPDATE school_signups
  SET
    verified_at = now(),
    school_id   = v_school_id,
    admin_id    = v_admin_id
  WHERE id = p_signup_id;

  school_id := v_school_id;
  admin_id  := v_admin_id;
  RETURN;
END;
$$;


ALTER FUNCTION public.mss_finalize_school_signup(p_signup_id integer, p_source_slug text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_html_to_text(text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_html_to_text(html text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT
    trim(
      -- 2) Collapse numeric HTML entities like &#8201; into simple spaces
      regexp_replace(
        -- 1) Strip HTML tags like <span ...>...</span>
        regexp_replace(
          coalesce($1, ''),
          E'<[^>]+>',       -- anything that looks like a tag
          '',
          'g'
        ),
        E'&#[0-9]+;',       -- &#8201; etc.
        ' ',                -- replace with a single space
        'g'
      )
    )
$_$;


ALTER FUNCTION public.mss_html_to_text(html text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_provision_school_from_slug(text, text, text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_provision_school_from_slug(new_slug text, new_name text, source_slug text DEFAULT 'mss-demo'::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    src_school_id         integer;
    new_school_id         integer;

    -- assessment cloning
    src_assessment        assessments%ROWTYPE;
    new_assessment_id     integer;

    -- question cloning
    src_question          questions%ROWTYPE;
    new_question_id       integer;
BEGIN
    --------------------------------------------------------------------
    -- 1. Basic validation
    --------------------------------------------------------------------
    IF new_slug IS NULL OR length(trim(new_slug)) = 0 THEN
        RAISE EXCEPTION 'new_slug cannot be empty';
    END IF;

    IF new_name IS NULL OR length(trim(new_name)) = 0 THEN
        RAISE EXCEPTION 'new_name cannot be empty';
    END IF;

    -- Slug must be unique
    PERFORM 1 FROM schools WHERE slug = new_slug;
    IF FOUND THEN
        RAISE EXCEPTION 'A school with slug % already exists', new_slug;
    END IF;

    --------------------------------------------------------------------
    -- 2. Find source school
    --------------------------------------------------------------------
    SELECT id
    INTO src_school_id
    FROM schools
    WHERE slug = source_slug
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source school not found for slug: %', source_slug;
    END IF;

    --------------------------------------------------------------------
    -- 3. Insert new school (clone core fields from source)
    --    NOTE: keep this list aligned with the current "schools" table.
    --------------------------------------------------------------------
    INSERT INTO schools (
        slug,
        name,
        branding,
        settings,
        widget_variant,
        dashboard_variant,
        api,
        branding_logo_id
    )
    SELECT
        new_slug,
        new_name,
        s.branding,
        s.settings,
        s.widget_variant,
        s.dashboard_variant,
        s.api,
        s.branding_logo_id
    FROM schools s
    WHERE s.id = src_school_id
    RETURNING id INTO new_school_id;

    --------------------------------------------------------------------
    -- 4. Clone school_assets (e.g. widget-logo)
    --------------------------------------------------------------------
    INSERT INTO school_assets (school_id, kind, mime_type, data)
    SELECT
        new_school_id,
        sa.kind,
        sa.mime_type,
        sa.data
    FROM school_assets sa
    WHERE sa.school_id = src_school_id;

    --------------------------------------------------------------------
    -- 5. Clone assessments, questions, and questions_help
    --    We loop through each source assessment and duplicate its tree.
    --------------------------------------------------------------------
    FOR src_assessment IN
        SELECT *
        FROM assessments
        WHERE school_id = src_school_id
        ORDER BY id
    LOOP
        -- 5a. Insert cloned assessment for the new school
        INSERT INTO assessments (
            school_id,
            code,
            name,
            level,
            kind,
            config,
            widget_variant
        )
        VALUES (
            new_school_id,
            src_assessment.code,
            src_assessment.name,
            src_assessment.level,
            src_assessment.kind,
            src_assessment.config,
            src_assessment.widget_variant
        )
        RETURNING id INTO new_assessment_id;

        ----------------------------------------------------------------
        -- 5b. Clone questions tied to this assessment
        --     (school_id + assessment_id combination)
        ----------------------------------------------------------------
        FOR src_question IN
            SELECT *
            FROM questions
            WHERE school_id = src_school_id
              AND assessment_id = src_assessment.id
            ORDER BY sort_order, id
        LOOP
            INSERT INTO questions (
                school_id,
                assessment_id,
                level,
                category,
                position,
                is_active,
                question,
                sort_order
            )
            VALUES (
                new_school_id,
                new_assessment_id,
                src_question.level,
                src_question.category,
                src_question.position,
                src_question.is_active,
                src_question.question,
                src_question.sort_order
            )
            RETURNING id INTO new_question_id;

            ------------------------------------------------------------
            -- 5c. Clone questions_help for this question (if any)
            ------------------------------------------------------------
            INSERT INTO questions_help (
                school_id,
                question_id,
                maxhelp,
                minhelp,
                prompt
            )
            SELECT
                new_school_id,
                new_question_id,
                qh.maxhelp,
                qh.minhelp,
                qh.prompt
            FROM questions_help qh
            WHERE qh.school_id = src_school_id
              AND qh.question_id = src_question.id;
        END LOOP;
    END LOOP;

    --------------------------------------------------------------------
    -- 6. Optionally clone "global" questions with NULL assessment_id
    --    (if you use any generic questions not tied to a specific
    --     assessment). You can remove this block if not needed.
    --------------------------------------------------------------------
    FOR src_question IN
        SELECT *
        FROM questions
        WHERE school_id = src_school_id
          AND assessment_id IS NULL
        ORDER BY sort_order, id
    LOOP
        INSERT INTO questions (
            school_id,
            assessment_id,
            level,
            category,
            position,
            is_active,
            question,
            sort_order
        )
        VALUES (
            new_school_id,
            NULL,
            src_question.level,
            src_question.category,
            src_question.position,
            src_question.is_active,
            src_question.question,
            src_question.sort_order
        )
        RETURNING id INTO new_question_id;

        INSERT INTO questions_help (
            school_id,
            question_id,
            maxhelp,
            minhelp,
            prompt
        )
        SELECT
            new_school_id,
            new_question_id,
            qh.maxhelp,
            qh.minhelp,
            qh.prompt
        FROM questions_help qh
        WHERE qh.school_id = src_school_id
          AND qh.question_id = src_question.id;
    END LOOP;

    --------------------------------------------------------------------
    -- 7. Done
    --------------------------------------------------------------------
    RETURN new_school_id;
END;
$$;


ALTER FUNCTION public.mss_provision_school_from_slug(new_slug text, new_name text, source_slug text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_purge_admin_by_email(text); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_purge_admin_by_email(p_email text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_admin_id   integer;
  v_school_id  integer;
BEGIN
  SELECT id, school_id
  INTO   v_admin_id, v_school_id
  FROM   admins
  WHERE  LOWER(email) = LOWER(p_email)
  LIMIT  1;

  IF NOT FOUND THEN
    RAISE NOTICE 'No admin found for %', p_email;
    RETURN;
  END IF;

  RAISE NOTICE 'Purging admin %, id=%, school_id=%', p_email, v_admin_id, v_school_id;

  IF v_school_id IS NOT NULL THEN
    PERFORM mss_purge_school(v_school_id);
  END IF;

  DELETE FROM admins WHERE id = v_admin_id;
END;
$$;


ALTER FUNCTION public.mss_purge_admin_by_email(p_email text) OWNER TO msswidgetmt_db_user;

--
-- Name: mss_purge_school(integer); Type: FUNCTION; Schema: public; Owner: msswidgetmt_db_user
--

CREATE FUNCTION public.mss_purge_school(p_school_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- If the school does not exist, just bail quietly
  PERFORM 1 FROM schools WHERE id = p_school_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'School % not found; nothing to purge.', p_school_id;
    RETURN;
  END IF;

  RAISE NOTICE 'Purging school id=%', p_school_id;

  -- 1) Submissions (biggest table first)
  DELETE FROM submissions
  WHERE school_id = p_school_id;

  -- 2) Students, if you have them
  BEGIN
    DELETE FROM students
    WHERE school_id = p_school_id;
  EXCEPTION WHEN undefined_table THEN
    -- Ignore if students table doesn't exist in this env
    RAISE NOTICE 'students table not found; skipping.';
  END;

  -- 3) Questions + assessments
  DELETE FROM questions
  WHERE assessment_id IN (
    SELECT id FROM assessments WHERE school_id = p_school_id
  );

  DELETE FROM assessments
  WHERE school_id = p_school_id;

  -- 4) Admins tied to this school
  DELETE FROM admins
  WHERE school_id = p_school_id;

  -- 5) Finally, the school row itself
  DELETE FROM schools
  WHERE id = p_school_id;

  RAISE NOTICE 'Purge complete for school id=%', p_school_id;
END;
$$;


ALTER FUNCTION public.mss_purge_school(p_school_id integer) OWNER TO msswidgetmt_db_user;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.admin_audit_logs (
    id integer NOT NULL,
    admin_id integer,
    school_id integer,
    action text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.admin_audit_logs OWNER TO msswidgetmt_db_user;

--
-- Name: admin_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.admin_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_audit_logs_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: admin_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.admin_audit_logs_id_seq OWNED BY public.admin_audit_logs.id;


--
-- Name: admin_password_resets; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.admin_password_resets (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    email text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '01:00:00'::interval) NOT NULL,
    used_at timestamp with time zone
);


ALTER TABLE public.admin_password_resets OWNER TO msswidgetmt_db_user;

--
-- Name: admin_password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.admin_password_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_password_resets_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: admin_password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.admin_password_resets_id_seq OWNED BY public.admin_password_resets.id;


--
-- Name: admin_schools; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.admin_schools (
    id integer NOT NULL,
    admin_id integer NOT NULL,
    school_id integer NOT NULL
);


ALTER TABLE public.admin_schools OWNER TO msswidgetmt_db_user;

--
-- Name: admin_schools_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.admin_schools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admin_schools_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: admin_schools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.admin_schools_id_seq OWNED BY public.admin_schools.id;


--
-- Name: admins; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.admins (
    id integer NOT NULL,
    school_id integer,
    email text NOT NULL,
    full_name text,
    password_hash text,
    is_owner boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    is_superadmin boolean DEFAULT false NOT NULL
);


ALTER TABLE public.admins OWNER TO msswidgetmt_db_user;

--
-- Name: admins_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.admins_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;


--
-- Name: assessments; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.assessments (
    id integer NOT NULL,
    school_id integer NOT NULL,
    name text NOT NULL,
    code text,
    level text,
    kind text DEFAULT 'placement'::text,
    config jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    widget_variant text DEFAULT 'Widget.html'::text
);


ALTER TABLE public.assessments OWNER TO msswidgetmt_db_user;

--
-- Name: assessments_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.assessments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.assessments_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: assessments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.assessments_id_seq OWNED BY public.assessments.id;


--
-- Name: branding_files; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.branding_files (
    id bigint NOT NULL,
    school_id integer NOT NULL,
    kind text DEFAULT 'logo'::text NOT NULL,
    filename text,
    mime_type text,
    bytes bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    size_bytes integer
);


ALTER TABLE public.branding_files OWNER TO msswidgetmt_db_user;

--
-- Name: branding_files_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.branding_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.branding_files_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: branding_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.branding_files_id_seq OWNED BY public.branding_files.id;


--
-- Name: pending_signups; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.pending_signups (
    id integer NOT NULL,
    admin_email text NOT NULL,
    admin_name text,
    school_name text,
    token text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    used_at timestamp with time zone
);


ALTER TABLE public.pending_signups OWNER TO msswidgetmt_db_user;

--
-- Name: pending_signups_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.pending_signups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pending_signups_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: pending_signups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.pending_signups_id_seq OWNED BY public.pending_signups.id;


--
-- Name: questions; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.questions (
    id integer NOT NULL,
    school_id integer NOT NULL,
    assessment_id integer,
    level text,
    category text,
    "position" integer DEFAULT 1,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    question text NOT NULL,
    sort_order integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.questions OWNER TO msswidgetmt_db_user;

--
-- Name: questions_help; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.questions_help (
    id integer NOT NULL,
    school_id integer NOT NULL,
    question_id integer NOT NULL,
    maxhelp text DEFAULT ''::text,
    minhelp text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.questions_help OWNER TO msswidgetmt_db_user;

--
-- Name: questions_help_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.questions_help_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.questions_help_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: questions_help_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.questions_help_id_seq OWNED BY public.questions_help.id;


--
-- Name: questions_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.questions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.questions_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: questions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.questions_id_seq OWNED BY public.questions.id;


--
-- Name: school_assets; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.school_assets (
    id integer NOT NULL,
    school_id integer NOT NULL,
    kind text NOT NULL,
    mime_type text NOT NULL,
    data bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.school_assets OWNER TO msswidgetmt_db_user;

--
-- Name: school_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.school_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.school_assets_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: school_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.school_assets_id_seq OWNED BY public.school_assets.id;


--
-- Name: school_signups; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.school_signups (
    id integer NOT NULL,
    school_name text NOT NULL,
    website_url text,
    country text,
    time_zone text,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    role_title text,
    teacher_count integer,
    heard_about text,
    program_description text NOT NULL,
    exams text[],
    tests_per_month integer,
    anonymous_funnel boolean DEFAULT true,
    funnel_url text,
    notes text,
    token text NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    verified_at timestamp with time zone
);


ALTER TABLE public.school_signups OWNER TO msswidgetmt_db_user;

--
-- Name: school_signups_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.school_signups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.school_signups_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: school_signups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.school_signups_id_seq OWNED BY public.school_signups.id;


--
-- Name: schools; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.schools (
    id integer NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    branding jsonb DEFAULT '{}'::jsonb,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    widget_variant text DEFAULT 'Widget.html'::text,
    dashboard_variant text DEFAULT 'Dashboard.html'::text,
    api jsonb DEFAULT '{}'::jsonb,
    branding_logo_id bigint,
    CONSTRAINT api_baseurl_cannot_be_scorpion CHECK (((api ->> 'baseUrl'::text) = 'https://app.myspeakingscore.com'::text)),
    CONSTRAINT api_must_contain_baseurl CHECK ((api ? 'baseUrl'::text))
);


ALTER TABLE public.schools OWNER TO msswidgetmt_db_user;

--
-- Name: schools_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.schools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.schools_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: schools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.schools_id_seq OWNED BY public.schools.id;


--
-- Name: schools_settings_backup; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.schools_settings_backup (
    id integer,
    slug text,
    settings jsonb
);


ALTER TABLE public.schools_settings_backup OWNER TO msswidgetmt_db_user;

--
-- Name: students; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.students (
    id integer NOT NULL,
    school_id integer NOT NULL,
    email text,
    full_name text,
    external_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.students OWNER TO msswidgetmt_db_user;

--
-- Name: students_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.students_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.students_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: students_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.students_id_seq OWNED BY public.students.id;


--
-- Name: submissions; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.submissions (
    id integer NOT NULL,
    school_id integer,
    assessment_id integer,
    student_id integer,
    teacher_id integer,
    ip text,
    record_count integer,
    file_name text,
    length_sec numeric,
    submit_time numeric,
    toefl integer,
    ielts numeric,
    pte integer,
    cefr text,
    question text,
    transcript text,
    wpm integer,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    "timestamp" timestamp with time zone DEFAULT now(),
    mss_overall numeric,
    mss_fluency numeric,
    mss_grammar numeric,
    mss_pron numeric,
    mss_vocab numeric,
    mss_cefr text,
    mss_toefl integer,
    mss_ielts numeric,
    mss_pte integer,
    vox_score numeric,
    transcript_clean text,
    deleted_at timestamp with time zone,
    help_level text,
    help_surface text,
    widget_variant text,
    dashboard_variant text,
    student_pk integer,
    student_email text,
    student_name text,
    student_ref_id integer,
    question_id integer
);


ALTER TABLE public.submissions OWNER TO msswidgetmt_db_user;

--
-- Name: submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.submissions_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.submissions_id_seq OWNED BY public.submissions.id;


--
-- Name: teachers; Type: TABLE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE TABLE public.teachers (
    id integer NOT NULL,
    school_id integer NOT NULL,
    email text,
    full_name text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.teachers OWNER TO msswidgetmt_db_user;

--
-- Name: teachers_id_seq; Type: SEQUENCE; Schema: public; Owner: msswidgetmt_db_user
--

CREATE SEQUENCE public.teachers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teachers_id_seq OWNER TO msswidgetmt_db_user;

--
-- Name: teachers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: msswidgetmt_db_user
--

ALTER SEQUENCE public.teachers_id_seq OWNED BY public.teachers.id;


--
-- Name: v_submission_scores; Type: VIEW; Schema: public; Owner: msswidgetmt_db_user
--

CREATE VIEW public.v_submission_scores AS
 SELECT s.id,
    s.created_at AS submitted_at,
    sch.slug,
    s.school_id,
    s.question,
    s.vox_score,
    s.toefl,
    s.ielts,
    s.pte,
    s.cefr,
    s.mss_fluency,
    s.mss_grammar,
    s.mss_pron,
    s.mss_vocab,
    s.mss_cefr,
    s.mss_toefl,
    s.mss_ielts,
    s.mss_pte,
    s.help_level,
    s.help_surface,
    s.widget_variant,
    s.dashboard_variant,
    s.transcript_clean,
    s.student_id,
    st.full_name AS student_name,
    st.email AS student_email
   FROM ((public.submissions s
     JOIN public.schools sch ON ((sch.id = s.school_id)))
     LEFT JOIN public.students st ON ((st.id = s.student_id)))
  WHERE ((s.deleted_at IS NULL) OR (s.deleted_at IS NULL));


ALTER VIEW public.v_submission_scores OWNER TO msswidgetmt_db_user;

--
-- Name: v_widget_reports; Type: VIEW; Schema: public; Owner: msswidgetmt_db_user
--

CREATE VIEW public.v_widget_reports AS
 SELECT s.id AS submission_id,
    s.created_at,
    sch.slug AS school_slug,
    sch.name AS school_name,
    s.student_id,
    s.question,
    s.toefl,
    s.ielts,
    s.pte,
    s.cefr,
    s.vox_score,
    s.mss_overall,
    s.mss_fluency,
    s.mss_grammar,
    s.mss_pron,
    s.mss_vocab,
    s.mss_cefr,
    s.mss_toefl,
    s.mss_ielts,
    s.mss_pte,
    s.transcript_clean
   FROM (public.submissions s
     JOIN public.schools sch ON ((sch.id = s.school_id)));


ALTER VIEW public.v_widget_reports OWNER TO msswidgetmt_db_user;

--
-- Name: vw_widget_reports; Type: VIEW; Schema: public; Owner: msswidgetmt_db_user
--

CREATE VIEW public.vw_widget_reports AS
 SELECT s.id,
    sch.slug AS school_slug,
    s.created_at AS submitted_at,
    s.question,
    s.student_id,
    st.full_name AS student_name,
    st.email AS student_email,
    s.toefl,
    s.ielts,
    s.pte,
    s.cefr,
    s.vox_score,
    s.mss_fluency,
    s.mss_grammar,
    s.mss_pron,
    s.mss_vocab,
    s.mss_cefr,
    s.mss_toefl,
    s.mss_ielts,
    s.mss_pte,
    s.help_level,
    s.help_surface,
    s.widget_variant,
    s.dashboard_variant,
    s.transcript_clean
   FROM ((public.submissions s
     JOIN public.schools sch ON ((sch.id = s.school_id)))
     LEFT JOIN public.students st ON ((st.id = s.student_id)))
  WHERE ((s.deleted_at IS NULL) OR (s.deleted_at IS NULL));


ALTER VIEW public.vw_widget_reports OWNER TO msswidgetmt_db_user;

--
-- Name: admin_audit_logs id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_logs_id_seq'::regclass);


--
-- Name: admin_password_resets id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_password_resets ALTER COLUMN id SET DEFAULT nextval('public.admin_password_resets_id_seq'::regclass);


--
-- Name: admin_schools id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_schools ALTER COLUMN id SET DEFAULT nextval('public.admin_schools_id_seq'::regclass);


--
-- Name: admins id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);


--
-- Name: assessments id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.assessments ALTER COLUMN id SET DEFAULT nextval('public.assessments_id_seq'::regclass);


--
-- Name: branding_files id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.branding_files ALTER COLUMN id SET DEFAULT nextval('public.branding_files_id_seq'::regclass);


--
-- Name: pending_signups id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.pending_signups ALTER COLUMN id SET DEFAULT nextval('public.pending_signups_id_seq'::regclass);


--
-- Name: questions id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions ALTER COLUMN id SET DEFAULT nextval('public.questions_id_seq'::regclass);


--
-- Name: questions_help id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help ALTER COLUMN id SET DEFAULT nextval('public.questions_help_id_seq'::regclass);


--
-- Name: school_assets id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_assets ALTER COLUMN id SET DEFAULT nextval('public.school_assets_id_seq'::regclass);


--
-- Name: school_signups id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_signups ALTER COLUMN id SET DEFAULT nextval('public.school_signups_id_seq'::regclass);


--
-- Name: schools id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.schools ALTER COLUMN id SET DEFAULT nextval('public.schools_id_seq'::regclass);


--
-- Name: students id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.students ALTER COLUMN id SET DEFAULT nextval('public.students_id_seq'::regclass);


--
-- Name: submissions id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.submissions ALTER COLUMN id SET DEFAULT nextval('public.submissions_id_seq'::regclass);


--
-- Name: teachers id; Type: DEFAULT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.teachers ALTER COLUMN id SET DEFAULT nextval('public.teachers_id_seq'::regclass);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: admin_password_resets admin_password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_password_resets
    ADD CONSTRAINT admin_password_resets_pkey PRIMARY KEY (id);


--
-- Name: admin_password_resets admin_password_resets_token_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_password_resets
    ADD CONSTRAINT admin_password_resets_token_key UNIQUE (token);


--
-- Name: admin_schools admin_schools_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_schools
    ADD CONSTRAINT admin_schools_pkey PRIMARY KEY (id);


--
-- Name: admin_schools admin_schools_unique; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_schools
    ADD CONSTRAINT admin_schools_unique UNIQUE (admin_id, school_id);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_school_id_email_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_school_id_email_key UNIQUE (school_id, email);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: assessments assessments_school_id_code_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_school_id_code_key UNIQUE (school_id, code);


--
-- Name: branding_files branding_files_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.branding_files
    ADD CONSTRAINT branding_files_pkey PRIMARY KEY (id);


--
-- Name: pending_signups pending_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.pending_signups
    ADD CONSTRAINT pending_signups_pkey PRIMARY KEY (id);


--
-- Name: pending_signups pending_signups_token_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.pending_signups
    ADD CONSTRAINT pending_signups_token_key UNIQUE (token);


--
-- Name: questions_help questions_help_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help
    ADD CONSTRAINT questions_help_pkey PRIMARY KEY (id);


--
-- Name: questions_help questions_help_school_id_question_id_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help
    ADD CONSTRAINT questions_help_school_id_question_id_key UNIQUE (school_id, question_id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: school_assets school_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_assets
    ADD CONSTRAINT school_assets_pkey PRIMARY KEY (id);


--
-- Name: school_assets school_assets_school_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_assets
    ADD CONSTRAINT school_assets_school_id_kind_key UNIQUE (school_id, kind);


--
-- Name: school_signups school_signups_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_signups
    ADD CONSTRAINT school_signups_pkey PRIMARY KEY (id);


--
-- Name: school_signups school_signups_token_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_signups
    ADD CONSTRAINT school_signups_token_key UNIQUE (token);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: schools schools_slug_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_slug_key UNIQUE (slug);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- Name: students students_school_id_email_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_school_id_email_key UNIQUE (school_id, email);


--
-- Name: submissions submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_pkey; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_pkey PRIMARY KEY (id);


--
-- Name: teachers teachers_school_id_email_key; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_school_id_email_key UNIQUE (school_id, email);


--
-- Name: questions_help uq_questions_help_school_question; Type: CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help
    ADD CONSTRAINT uq_questions_help_school_question UNIQUE (school_id, question_id);


--
-- Name: idx_branding_files_school_kind; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE INDEX idx_branding_files_school_kind ON public.branding_files USING btree (school_id, kind, created_at DESC);


--
-- Name: idx_questions_assessment_order; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE INDEX idx_questions_assessment_order ON public.questions USING btree (assessment_id, "position");


--
-- Name: idx_submissions_created_at; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE INDEX idx_submissions_created_at ON public.submissions USING btree (created_at DESC);


--
-- Name: idx_submissions_school_id; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE INDEX idx_submissions_school_id ON public.submissions USING btree (school_id);


--
-- Name: students_school_email_uq; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE UNIQUE INDEX students_school_email_uq ON public.students USING btree (school_id, email);


--
-- Name: submissions_placeholder_idx; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE UNIQUE INDEX submissions_placeholder_idx ON public.submissions USING btree (school_id, student_id, question_id) WHERE (vox_score IS NULL);


--
-- Name: uq_school_signups_email_school; Type: INDEX; Schema: public; Owner: msswidgetmt_db_user
--

CREATE UNIQUE INDEX uq_school_signups_email_school ON public.school_signups USING btree (lower(contact_email), lower(school_name));


--
-- Name: admin_audit_logs admin_audit_logs_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id);


--
-- Name: admin_audit_logs admin_audit_logs_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: admin_password_resets admin_password_resets_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_password_resets
    ADD CONSTRAINT admin_password_resets_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: admin_schools admin_schools_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_schools
    ADD CONSTRAINT admin_schools_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: admin_schools admin_schools_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admin_schools
    ADD CONSTRAINT admin_schools_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: admins admins_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: assessments assessments_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: branding_files branding_files_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.branding_files
    ADD CONSTRAINT branding_files_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: questions questions_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessments(id) ON DELETE CASCADE;


--
-- Name: questions_help questions_help_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help
    ADD CONSTRAINT questions_help_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE;


--
-- Name: questions_help questions_help_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions_help
    ADD CONSTRAINT questions_help_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: questions questions_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: school_assets school_assets_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.school_assets
    ADD CONSTRAINT school_assets_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: schools schools_branding_logo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_branding_logo_id_fkey FOREIGN KEY (branding_logo_id) REFERENCES public.branding_files(id);


--
-- Name: students students_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: submissions submissions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL;


--
-- Name: submissions submissions_student_pk_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_student_pk_fkey FOREIGN KEY (student_pk) REFERENCES public.students(id);


--
-- Name: submissions submissions_student_ref_fk; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.submissions
    ADD CONSTRAINT submissions_student_ref_fk FOREIGN KEY (student_ref_id) REFERENCES public.students(id) ON DELETE SET NULL;


--
-- Name: teachers teachers_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: msswidgetmt_db_user
--

ALTER TABLE ONLY public.teachers
    ADD CONSTRAINT teachers_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE;


--
-- Name: FUNCTION armor(bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.armor(bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION armor(bytea, text[], text[]); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.armor(bytea, text[], text[]) TO msswidgetmt_db_user;


--
-- Name: FUNCTION crypt(text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.crypt(text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION dearmor(text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.dearmor(text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION decrypt(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrypt(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION decrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.decrypt_iv(bytea, bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION digest(bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.digest(bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION digest(text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.digest(text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION encrypt(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.encrypt(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION encrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.encrypt_iv(bytea, bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION gen_random_bytes(integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gen_random_bytes(integer) TO msswidgetmt_db_user;


--
-- Name: FUNCTION gen_random_uuid(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gen_random_uuid() TO msswidgetmt_db_user;


--
-- Name: FUNCTION gen_salt(text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gen_salt(text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION gen_salt(text, integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gen_salt(text, integer) TO msswidgetmt_db_user;


--
-- Name: FUNCTION hmac(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.hmac(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION hmac(text, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.hmac(text, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_armor_headers(text, OUT key text, OUT value text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_armor_headers(text, OUT key text, OUT value text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_key_id(bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_key_id(bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt(bytea, bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt(bytea, bytea, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_encrypt(text, bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_encrypt(text, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_encrypt_bytea(bytea, bytea) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_pub_encrypt_bytea(bytea, bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_decrypt(bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_decrypt(bytea, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_decrypt_bytea(bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_decrypt_bytea(bytea, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_encrypt(text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_encrypt(text, text, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_encrypt_bytea(bytea, text) TO msswidgetmt_db_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text, text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.pgp_sym_encrypt_bytea(bytea, text, text) TO msswidgetmt_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON SEQUENCES TO msswidgetmt_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TYPES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TYPES TO msswidgetmt_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON FUNCTIONS TO msswidgetmt_db_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: -; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON TABLES TO msswidgetmt_db_user;


--
-- PostgreSQL database dump complete
--

\unrestrict uPWSmWSpsc3GApVGTaMbPQrZyiQbZdtAr9aARRh6VaKQ2zzxUs6VuKO8p305Wfg

