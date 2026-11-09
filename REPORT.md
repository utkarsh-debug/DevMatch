# DevMatch – Semantic Contributor-to-Issue Matching
*DBMS Mini Project · PES University, Bengaluru*

## 1. Project Title
**DevMatch – Semantic Contributor-to-Issue Matching** (CRUD web application on PostgreSQL + pgvector + MongoDB, built with Next.js)

## 2. Student SRNs and Names
| SRN | Name |
|---|---|
| PES1UG24AM320 | VIJAY SURIYA P |
| PES1UG24AM310 | UTKARSH KUMAR |

## 3. Abstract
Open-source maintainers struggle to find contributors with the right skills, and new contributors struggle to find issues they can actually solve. DevMatch is a full-stack web application that connects the two. Maintainers register projects and post issues; contributors list their skills and proficiency. Both the issue text and the contributor profile are converted into 384-dimensional embedding vectors stored in PostgreSQL with the **pgvector** extension, so the application ranks issues for a contributor (and applicants for an issue) by cosine similarity instead of keyword overlap.

The system uses **polyglot persistence**. Structured, transactional data (users, projects, issues, applications, skills, notifications) lives in a normalised **PostgreSQL** schema with constraints, indexes, a view, triggers and a row-locking stored function that accepts one applicant atomically. Semi-structured, high-volume data lives in **MongoDB**: threaded discussions on issues (replies embedded in each comment document, likes as a set) and an append-only activity log with a TTL index. The user interface is a **Next.js 15** App Router application (React 19 server components, server actions, route handlers, middleware) with JWT cookie authentication. Complete CRUD is available for projects, issues, applications, profiles and comments, and a DB-insights page exposes the SQL, vector and aggregation queries behind the UI.

## 4. Technology Stack
| Layer | Technology | Used for |
|---|---|---|
| Front end / full stack | **Next.js 15.5 (App Router)**, React 19, TypeScript | pages, server components, server actions, route handlers, middleware |
| Relational DB (SQL) | **PostgreSQL 16** | users, projects, issues, applications, skills, notifications; triggers, view, PL/pgSQL |
| Vector DB | **pgvector** (`vector(384)`, cosine `<=>`, ivfflat index) | semantic matching, similar issues |
| NoSQL DB | **MongoDB 8** | `comments` and `activity_log` collections, aggregation, text and TTL indexes |
| Drivers | `pg`, `mongodb` | database access |
| Auth / security | `jose` (JWT, HttpOnly cookie), `bcryptjs` | login, sessions, password hashing |
| Embeddings | 384-d feature-hashing embedder (tested default fallback); optional MiniLM via `@huggingface/transformers` | text to vector |
| Testing | `node:test`, Playwright (Chromium) | 29 unit/DB tests, 37 end-to-end steps |
| DevOps | Docker Compose (pgvector/pgvector:pg16, mongo:7) | one-command databases |

### Architecture
Browser → Next.js (server components / server actions / route handlers) → PostgreSQL+pgvector (transactional + vector data) and MongoDB (discussions, activity). Cross-store consistency is handled in the application: deleting a project removes its Mongo threads, deleting an account anonymises that author's comments in Mongo.

![ER diagram](docs/screenshots/00-er-diagram.png)

## 5. SQL – Database Commands
Full DDL (`db/schema.sql`), which creates the tables, constraints, indexes, view, triggers and functions:

```sql
-- =====================================================================
--  DevMatch — Semantic Contributor-to-Issue Matching
--  PostgreSQL 14+ with the pgvector extension
--
--  PART 1: the DDL from the project report (unchanged, apart from one
--          typo fix: "idx_issues_embeddingON" -> "idx_issues_embedding ON")
--  PART 2: server-side logic added for the application (transactional
--          accept/reject functions and integrity triggers)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1 — Schema from the report
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20) NOT NULL
                  CHECK (role IN ('contributor', 'maintainer')),
    bio           TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skills (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

CREATE TABLE user_skills (
    user_id     INT NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,
    skill_id    INT NOT NULL
                REFERENCES skills(id)
                ON DELETE CASCADE,
    proficiency VARCHAR(20)
                CHECK (proficiency IN ('beginner', 'intermediate', 'advanced')),
    PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE projects (
    id            SERIAL PRIMARY KEY,
    maintainer_id INT NOT NULL
                  REFERENCES users(id)
                  ON DELETE CASCADE,
    title         VARCHAR(150) NOT NULL,
    repo_url      VARCHAR(255) UNIQUE NOT NULL,
    tech_stack    VARCHAR(255),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE issues (
    id          SERIAL PRIMARY KEY,
    project_id  INT NOT NULL
                REFERENCES projects(id)
                ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    difficulty  VARCHAR(20)
                CHECK (difficulty IN ('easy', 'medium', 'hard')),
    status      VARCHAR(20) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'closed')),
    embedding   VECTOR(384),
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_embeddings (
    user_id    INT PRIMARY KEY
               REFERENCES users(id)
               ON DELETE CASCADE,
    embedding  VECTOR(384),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE applications (
    id         SERIAL PRIMARY KEY,
    issue_id   INT NOT NULL
               REFERENCES issues(id)
               ON DELETE CASCADE,
    user_id    INT NOT NULL
               REFERENCES users(id)
               ON DELETE CASCADE,
    status     VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected')),
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (issue_id, user_id)
);

CREATE TABLE notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,
    message     VARCHAR(255) NOT NULL,
    read_status BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_issues_project        ON issues(project_id);
CREATE INDEX idx_issues_status         ON issues(status);
CREATE INDEX idx_applications_issue    ON applications(issue_id);
CREATE INDEX idx_applications_user     ON applications(user_id);
CREATE INDEX idx_notifications_user    ON notifications(user_id);

-- Approximate-nearest-neighbour indexes for cosine distance
CREATE INDEX idx_issues_embedding
    ON issues
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX idx_user_embeddings
    ON user_embeddings
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE VIEW open_issues_view AS
SELECT
    i.id,
    i.title,
    i.description,
    i.difficulty,
    p.title AS project_title,
    u.name  AS maintainer,
    i.created_at
FROM issues i
JOIN projects p ON i.project_id    = p.id
JOIN users    u ON p.maintainer_id = u.id
WHERE i.status = 'open';

-- Schema evolution statements from the report
ALTER TABLE users
    ADD COLUMN account_status VARCHAR(20)
    DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended'));

ALTER TABLE issues
    ALTER COLUMN difficulty SET NOT NULL;

DROP INDEX IF EXISTS idx_issues_status;


-- ---------------------------------------------------------------------
-- PART 2 — Server-side logic used by the web application
-- ---------------------------------------------------------------------

-- 2.1  Integrity guard on applications --------------------------------
--      * only active contributors may apply
--      * only to issues that are still 'open'
CREATE OR REPLACE FUNCTION fn_check_application() RETURNS trigger AS $$
DECLARE
    v_issue_status VARCHAR(20);
    v_role         VARCHAR(20);
    v_account      VARCHAR(20);
BEGIN
    SELECT status INTO v_issue_status FROM issues WHERE id = NEW.issue_id;
    IF v_issue_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'This issue is no longer open for applications';
    END IF;

    SELECT role, account_status INTO v_role, v_account
    FROM users WHERE id = NEW.user_id;

    IF v_role IS DISTINCT FROM 'contributor' THEN
        RAISE EXCEPTION 'Only contributors can apply to issues';
    END IF;
    IF v_account IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'This account is suspended';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_application
    BEFORE INSERT ON applications
    FOR EACH ROW EXECUTE FUNCTION fn_check_application();


-- 2.2  Notify the maintainer when someone applies ---------------------
CREATE OR REPLACE FUNCTION fn_notify_maintainer() RETURNS trigger AS $$
BEGIN
    INSERT INTO notifications (user_id, message)
    SELECT p.maintainer_id,
           LEFT(u.name || ' applied to "' || i.title || '"', 255)
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    JOIN users    u ON u.id = NEW.user_id
    WHERE i.id = NEW.issue_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_maintainer
    AFTER INSERT ON applications
    FOR EACH ROW EXECUTE FUNCTION fn_notify_maintainer();


-- 2.3  Accept a candidate — ONE atomic unit of work -------------------
--      Locks the issue row (so two concurrent accepts serialise), then:
--        accepted application  -> 'accepted'
--        issue                 -> 'closed'
--        all other pending     -> 'rejected' + a notification each
--        accepted contributor  -> notification
--      Any RAISE EXCEPTION rolls back the whole thing.
CREATE OR REPLACE FUNCTION accept_application(p_app_id INT, p_maintainer_id INT)
RETURNS INT AS $$
DECLARE
    v_issue_id     INT;
    v_user_id      INT;
    v_title        VARCHAR(200);
    v_issue_status VARCHAR(20);
    v_owner        INT;
    v_app_status   VARCHAR(20);
BEGIN
    SELECT issue_id, user_id INTO v_issue_id, v_user_id
    FROM applications WHERE id = p_app_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found';
    END IF;

    SELECT i.title, i.status, p.maintainer_id
      INTO v_title, v_issue_status, v_owner
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    WHERE i.id = v_issue_id
    FOR UPDATE OF i;

    IF v_owner <> p_maintainer_id THEN
        RAISE EXCEPTION 'You can only accept applicants for your own issues';
    END IF;
    IF v_issue_status = 'closed' THEN
        RAISE EXCEPTION 'This issue is already closed';
    END IF;

    SELECT status INTO v_app_status FROM applications WHERE id = p_app_id;
    IF v_app_status <> 'pending' THEN
        RAISE EXCEPTION 'This application has already been %', v_app_status;
    END IF;

    UPDATE applications SET status = 'accepted' WHERE id = p_app_id;
    UPDATE issues       SET status = 'closed'   WHERE id = v_issue_id;

    -- tell everyone else, then reject them
    INSERT INTO notifications (user_id, message)
    SELECT a.user_id,
           LEFT('Another contributor was selected for "' || v_title ||
                '". The issue is now closed - keep going, new matches are waiting in your feed.', 255)
    FROM applications a
    WHERE a.issue_id = v_issue_id AND a.id <> p_app_id AND a.status = 'pending';

    UPDATE applications
       SET status = 'rejected'
     WHERE issue_id = v_issue_id AND id <> p_app_id AND status = 'pending';

    INSERT INTO notifications (user_id, message)
    VALUES (v_user_id,
            LEFT('You were accepted for "' || v_title || '". Get started!', 255));

    RETURN v_issue_id;
END;
$$ LANGUAGE plpgsql;


-- 2.4  Reject a single candidate (issue stays open) -------------------
CREATE OR REPLACE FUNCTION reject_application(p_app_id INT, p_maintainer_id INT)
RETURNS VOID AS $$
DECLARE
    v_issue_id   INT;
    v_user_id    INT;
    v_title      VARCHAR(200);
    v_owner      INT;
    v_app_status VARCHAR(20);
BEGIN
    SELECT a.issue_id, a.user_id, a.status, i.title, p.maintainer_id
      INTO v_issue_id, v_user_id, v_app_status, v_title, v_owner
    FROM applications a
    JOIN issues   i ON i.id = a.issue_id
    JOIN projects p ON p.id = i.project_id
    WHERE a.id = p_app_id
    FOR UPDATE OF a;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application not found';
    END IF;
    IF v_owner <> p_maintainer_id THEN
        RAISE EXCEPTION 'You can only review applicants for your own issues';
    END IF;
    IF v_app_status <> 'pending' THEN
        RAISE EXCEPTION 'This application has already been %', v_app_status;
    END IF;

    UPDATE applications SET status = 'rejected' WHERE id = p_app_id;

    INSERT INTO notifications (user_id, message)
    VALUES (v_user_id,
            LEFT('Your application for "' || v_title || '" was not selected this time.', 255));
END;
$$ LANGUAGE plpgsql;
```

Query / DML reference (`db/queries.sql`, run with `psql "$DATABASE_URL" -f db/queries.sql`; all changes are rolled back):

```sql
-- =====================================================================
--  DevMatch — SQL command reference (PostgreSQL 16)
--  Runnable against the seeded database:
--      psql "$DATABASE_URL" -f db/queries.sql
--  Everything that modifies data runs inside a transaction that is ROLLED BACK at the end,
--  so the demo data is left untouched.
-- =====================================================================
\set ON_ERROR_STOP on
\pset null '∅'

-- ---------------------------------------------------------------------
-- 1. DDL — inspect what db/schema.sql created
-- ---------------------------------------------------------------------
\echo '== 1. Tables, constraints and indexes =='
\dt
\d issues
SELECT conname AS constraint, contype AS type, conrelid::regclass AS "table"
  FROM pg_constraint
 WHERE connamespace = 'public'::regnamespace AND contype IN ('c','u','f')
 ORDER BY conrelid::regclass::text, conname;

-- ---------------------------------------------------------------------
-- 2. DML — INSERT / UPDATE / DELETE (rolled back)
-- ---------------------------------------------------------------------
\echo '== 2. DML inside a transaction that is rolled back =='
BEGIN;

INSERT INTO users (name, email, password_hash, role, bio)
VALUES ('Demo Maintainer', 'demo-m@devmatch.dev', 'x', 'maintainer', 'Temporary maintainer'),
       ('Demo Contributor', 'demo-c@devmatch.dev', 'x', 'contributor', 'Temporary contributor')
RETURNING id, name, role;

INSERT INTO projects (maintainer_id, title, repo_url, tech_stack)
SELECT id, 'Demo Project', 'https://github.com/demo/demo-project', 'SQL, PostgreSQL'
  FROM users WHERE email = 'demo-m@devmatch.dev'
RETURNING id, title;

INSERT INTO issues (project_id, title, description, difficulty)
SELECT p.id, 'Demo issue', 'Add an index to speed up a slow SQL query', 'easy'
  FROM projects p WHERE p.title = 'Demo Project'
RETURNING id, title, status;

-- the BEFORE INSERT trigger lets an active contributor apply, the AFTER INSERT trigger notifies the maintainer
INSERT INTO applications (issue_id, user_id)
SELECT i.id, u.id FROM issues i, users u
 WHERE i.title = 'Demo issue' AND u.email = 'demo-c@devmatch.dev'
RETURNING id, status;

SELECT u.name AS notified, n.message
  FROM notifications n JOIN users u ON u.id = n.user_id
 WHERE u.email = 'demo-m@devmatch.dev';

UPDATE issues SET status = 'in_progress', difficulty = 'medium'
 WHERE title = 'Demo issue'
RETURNING id, status, difficulty;

-- the same trigger now refuses new applications because the issue is no longer open:
SAVEPOINT late;
\set ON_ERROR_STOP off
INSERT INTO applications (issue_id, user_id)
SELECT i.id, u.id FROM issues i, users u WHERE i.title = 'Demo issue' AND u.role = 'contributor' AND u.email <> 'demo-c@devmatch.dev' LIMIT 1;
ROLLBACK TO SAVEPOINT late;
\set ON_ERROR_STOP on

DELETE FROM issues WHERE title = 'Demo issue' RETURNING id;   -- cascades to applications
ROLLBACK;

-- ---------------------------------------------------------------------
-- 3. SELECT — joins, aggregation, subqueries, CTEs, window functions
-- ---------------------------------------------------------------------
\echo '== 3a. INNER JOIN across 4 tables =='
SELECT i.title AS issue, p.title AS project, u.name AS maintainer, i.difficulty
  FROM issues i
  JOIN projects p ON p.id = i.project_id
  JOIN users u    ON u.id = p.maintainer_id
 WHERE i.status = 'open'
 ORDER BY p.title, i.title
 LIMIT 5;

\echo '== 3b. GROUP BY + HAVING =='
SELECT p.title AS project, COUNT(i.id) AS issues
  FROM projects p JOIN issues i ON i.project_id = p.id
 GROUP BY p.id
HAVING COUNT(i.id) >= 3
 ORDER BY issues DESC, project;

\echo '== 3c. LEFT JOIN + FILTER (projects with no pending applications show 0) =='
SELECT p.title, COUNT(a.id) FILTER (WHERE a.status = 'pending') AS pending
  FROM projects p
  LEFT JOIN issues i       ON i.project_id = p.id
  LEFT JOIN applications a ON a.issue_id = i.id
 GROUP BY p.id ORDER BY pending DESC, p.title;

\echo '== 3d. Subquery with IN and EXISTS =='
SELECT name FROM users
 WHERE role = 'contributor'
   AND id IN (SELECT user_id FROM user_skills WHERE skill_id = (SELECT id FROM skills WHERE name = 'python'))
   AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = users.id)
 ORDER BY name;

\echo '== 3e. CTE + string_agg: skills per contributor =='
WITH skill_list AS (
  SELECT us.user_id, string_agg(s.name, ', ' ORDER BY s.name) AS skills
    FROM user_skills us JOIN skills s ON s.id = us.skill_id
   GROUP BY us.user_id
)
SELECT u.name, sl.skills FROM users u JOIN skill_list sl ON sl.user_id = u.id ORDER BY u.name LIMIT 5;

\echo '== 3f. Window function: number the applicants of each issue in the order they applied =='
SELECT i.title AS issue, u.name AS applicant,
       ROW_NUMBER() OVER (PARTITION BY a.issue_id ORDER BY a.applied_at, a.id) AS position
  FROM applications a JOIN issues i ON i.id = a.issue_id JOIN users u ON u.id = a.user_id
 ORDER BY i.title, position;

\echo '== 3g. Set operation: people who are either maintainers of a project or applicants =='
SELECT name FROM users WHERE id IN (SELECT maintainer_id FROM projects)
UNION
SELECT name FROM users WHERE id IN (SELECT user_id FROM applications)
ORDER BY name;

\echo '== 3h. CASE expression =='
SELECT difficulty,
       COUNT(*) AS issues,
       CASE WHEN COUNT(*) >= 8 THEN 'plenty' WHEN COUNT(*) >= 4 THEN 'some' ELSE 'few' END AS supply
  FROM issues GROUP BY difficulty ORDER BY difficulty;

-- ---------------------------------------------------------------------
-- 4. VIEW
-- ---------------------------------------------------------------------
\echo '== 4. The open_issues_view view =='
SELECT id, title, difficulty, project_title, maintainer FROM open_issues_view ORDER BY id LIMIT 4;

-- ---------------------------------------------------------------------
-- 5. Transactions and stored functions
-- ---------------------------------------------------------------------
\echo '== 5. accept_application(): one atomic unit of work (rolled back) =='
BEGIN;
SELECT a.id AS application_id, a.issue_id, u.name AS applicant, m.id AS maintainer_id
  FROM applications a
  JOIN users u    ON u.id = a.user_id
  JOIN issues i   ON i.id = a.issue_id
  JOIN projects p ON p.id = i.project_id
  JOIN users m    ON m.id = p.maintainer_id
 WHERE a.status = 'pending'
 ORDER BY a.id LIMIT 1 \gset

SELECT accept_application(:application_id, :maintainer_id) AS closed_issue_id;
SELECT status, COUNT(*) FROM applications WHERE issue_id = :issue_id GROUP BY status ORDER BY status;
SELECT status FROM issues WHERE id = :issue_id;

-- a different maintainer is refused and nothing changes (the function raises, the statement aborts)
SAVEPOINT try_wrong_owner;
\set ON_ERROR_STOP off
SELECT accept_application(:application_id, (SELECT id FROM users WHERE role = 'maintainer' AND id <> :maintainer_id LIMIT 1));
ROLLBACK TO SAVEPOINT try_wrong_owner;
\set ON_ERROR_STOP on
ROLLBACK;

-- ---------------------------------------------------------------------
-- 6. Indexes and query plans
-- ---------------------------------------------------------------------
\echo '== 6. EXPLAIN: foreign-key index on applications(issue_id) =='
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT * FROM applications WHERE issue_id = 1;
RESET enable_seqscan;

-- ---------------------------------------------------------------------
-- 7. Schema evolution statements from the project report
-- ---------------------------------------------------------------------
\echo '== 7. account_status column added with ALTER TABLE =='
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'users' AND column_name = 'account_status';
SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_name = 'issues' AND column_name = 'difficulty';
```

Actual output of that script:

```text
== 1. Tables, constraints and indexes ==
              List of relations
 Schema |      Name       | Type  |  Owner   
--------+-----------------+-------+----------
 public | applications    | table | postgres
 public | issues          | table | postgres
 public | notifications   | table | postgres
 public | projects        | table | postgres
 public | skills          | table | postgres
 public | user_embeddings | table | postgres
 public | user_skills     | table | postgres
 public | users           | table | postgres
(8 rows)

                                         Table "public.issues"
   Column    |            Type             | Collation | Nullable |              Default               
-------------+-----------------------------+-----------+----------+------------------------------------
 id          | integer                     |           | not null | nextval('issues_id_seq'::regclass)
 project_id  | integer                     |           | not null | 
 title       | character varying(200)      |           | not null | 
 description | text                        |           | not null | 
 difficulty  | character varying(20)       |           | not null | 
 status      | character varying(20)       |           | not null | 'open'::character varying
 embedding   | vector(384)                 |           |          | 
 created_at  | timestamp without time zone |           |          | CURRENT_TIMESTAMP
Indexes:
    "issues_pkey" PRIMARY KEY, btree (id)
    "idx_issues_embedding" ivfflat (embedding vector_cosine_ops) WITH (lists='100')
    "idx_issues_project" btree (project_id)
Check constraints:
    "issues_difficulty_check" CHECK (difficulty::text = ANY (ARRAY['easy'::character varying, 'medium'::character varying, 'hard'::character varying]::text[]))
    "issues_status_check" CHECK (status::text = ANY (ARRAY['open'::character varying, 'in_progress'::character varying, 'closed'::character varying]::text[]))
Foreign-key constraints:
    "issues_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
Referenced by:
    TABLE "applications" CONSTRAINT "applications_issue_id_fkey" FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE

            constraint             | type |      table      
-----------------------------------+------+-----------------
 applications_issue_id_fkey        | f    | applications
 applications_issue_id_user_id_key | u    | applications
 applications_status_check         | c    | applications
 applications_user_id_fkey         | f    | applications
 issues_difficulty_check           | c    | issues
 issues_project_id_fkey            | f    | issues
 issues_status_check               | c    | issues
 notifications_user_id_fkey        | f    | notifications
 projects_maintainer_id_fkey       | f    | projects
 projects_repo_url_key             | u    | projects
 skills_name_key                   | u    | skills
 user_embeddings_user_id_fkey      | f    | user_embeddings
 user_skills_proficiency_check     | c    | user_skills
 user_skills_skill_id_fkey         | f    | user_skills
 user_skills_user_id_fkey          | f    | user_skills
 users_account_status_check        | c    | users
 users_email_key                   | u    | users
 users_role_check                  | c    | users
(18 rows)

== 2. DML inside a transaction that is rolled back ==
 id |       name       |    role     
----+------------------+-------------
 34 | Demo Maintainer  | maintainer
 35 | Demo Contributor | contributor
(2 rows)

 id |    title     
----+--------------
 34 | Demo Project
(1 row)

 id |   title    | status 
----+------------+--------
 34 | Demo issue | open
(1 row)

 id | status  
----+---------
 34 | pending
(1 row)

    notified     |                 message                  
-----------------+------------------------------------------
 Demo Maintainer | Demo Contributor applied to "Demo issue"
(1 row)

 id |   status    | difficulty 
----+-------------+------------
 34 | in_progress | medium
(1 row)

psql:db/queries.sql:61: ERROR:  This issue is no longer open for applications
CONTEXT:  PL/pgSQL function fn_check_application() line 9 at RAISE
 id 
----
 34
(1 row)

== 3a. INNER JOIN across 4 tables ==
                            issue                            |  project   | maintainer | difficulty 
-------------------------------------------------------------+------------+------------+------------
 Add a dark theme to the React components                    | BytePlot   | Marcus Lee | easy
 Make the chart legend keyboard accessible                   | BytePlot   | Marcus Lee | medium
 Migrate the tooltip component from JavaScript to TypeScript | BytePlot   | Marcus Lee | easy
 Translate the API reference into Spanish                    | DocuBridge | Priya Nair | medium
 Write a getting-started tutorial for new contributors       | DocuBridge | Priya Nair | easy
(5 rows)

== 3b. GROUP BY + HAVING ==
   project   | issues 
-------------+--------
 PipelineKit |      4
 BytePlot    |      3
 NeuroLite   |      3
 QuickAPI    |      3
 RustCache   |      3
(5 rows)

== 3c. LEFT JOIN + FILTER (projects with no pending applications show 0) ==
    title     | pending 
--------------+---------
 QuickAPI     |       4
 BytePlot     |       3
 RustCache    |       1
 DocuBridge   |       0
 NeuroLite    |       0
 PipelineKit  |       0
 PixelForge   |       0
 PocketGarden |       0
(8 rows)

== 3d. Subquery with IN and EXISTS ==
    name     
-------------
 Ananya Iyer
(1 row)

== 3e. CTE + string_agg: skills per contributor ==
     name      |                       skills                        
---------------+-----------------------------------------------------
 Ananya Iyer   | nlp, pandas, python, pytorch
 Diego Alvarez | c++, game development, glsl, opengl
 Ishaan Verma  | css, django, html, javascript
 Karthik S     | bash, docker, github actions, kubernetes, terraform
 Liam O'Brien  | go, grpc, microservices, redis
(5 rows)

== 3f. Window function: number the applicants of each issue in the order they applied ==
                        issue                         |  applicant   | position 
------------------------------------------------------+--------------+----------
 Add a dark theme to the React components             | Ishaan Verma |        1
 Add a dark theme to the React components             | Neha Kapoor  |        2
 Add pagination to the /items REST endpoint           | Vijay Kumar  |        1
 Fix typos and outdated steps in the quickstart guide | Meera Joshi  |        1
 Fix typos and outdated steps in the quickstart guide | Ishaan Verma |        2
 Make the chart legend keyboard accessible            | Neha Kapoor  |        1
 Rate-limit login attempts to prevent brute force     | Zoe Chen     |        1
 Reduce memory fragmentation in the slab allocator    | Rohan Mehta  |        1
 Speed up the slow search query with a database index | Vijay Kumar  |        1
 Speed up the slow search query with a database index | Liam O'Brien |        2
(10 rows)

== 3g. Set operation: people who are either maintainers of a project or applicants ==
     name     
--------------
 Asha Rao
 Ishaan Verma
 Liam O'Brien
 Marcus Lee
 Meera Joshi
 Neha Kapoor
 Priya Nair
 Rohan Mehta
 Tomas Silva
 Vijay Kumar
 Zoe Chen
(11 rows)

== 3h. CASE expression ==
 difficulty | issues | supply 
------------+--------+--------
 easy       |      7 | some
 hard       |      7 | some
 medium     |      8 | plenty
(3 rows)

== 4. The open_issues_view view ==
 id |                      title                       | difficulty | project_title | maintainer 
----+--------------------------------------------------+------------+---------------+------------
  1 | Cache dependency layers in the Docker build step | medium     | PipelineKit   | Asha Rao
  2 | Add a Kubernetes manifest generator command      | hard       | PipelineKit   | Asha Rao
  4 | Colourise CLI output and add a --no-color flag   | easy       | PipelineKit   | Asha Rao
  5 | Add pagination to the /items REST endpoint       | medium     | QuickAPI      | Asha Rao
(4 rows)

== 5. accept_application(): one atomic unit of work (rolled back) ==
 closed_issue_id 
-----------------
               5
(1 row)

  status  | count 
----------+-------
 accepted |     1
(1 row)

 status 
--------
 closed
(1 row)

psql:db/queries.sql:154: ERROR:  You can only accept applicants for your own issues
CONTEXT:  PL/pgSQL function accept_application(integer,integer) line 24 at RAISE
== 6. EXPLAIN: foreign-key index on applications(issue_id) ==
                    QUERY PLAN                     
---------------------------------------------------
 Bitmap Heap Scan on applications
   Recheck Cond: (issue_id = 1)
   ->  Bitmap Index Scan on idx_applications_issue
         Index Cond: (issue_id = 1)
(4 rows)

== 7. account_status column added with ALTER TABLE ==
  column_name   |     data_type     |       column_default        
----------------+-------------------+-----------------------------
 account_status | character varying | 'active'::character varying
(1 row)

 column_name | is_nullable 
-------------+-------------
 difficulty  | NO
(1 row)
```


## 6. NoSQL / Vector Database Commands
### 6.1 Vector database (pgvector) — `db/vector-commands.sql`

```sql
-- =====================================================================
--  DevMatch — pgvector command reference (vector database features inside PostgreSQL)
--      psql "$DATABASE_URL" -f db/vector-commands.sql
-- =====================================================================
\set ON_ERROR_STOP on
\pset null '∅'

\echo '== 1. Extension and vector columns =='
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT table_name, column_name, udt_name
  FROM information_schema.columns WHERE udt_name = 'vector' ORDER BY table_name;
SELECT 'issues' AS "table", COUNT(*) AS vectors, MIN(vector_dims(embedding)) AS dims FROM issues WHERE embedding IS NOT NULL
UNION ALL
SELECT 'user_embeddings', COUNT(*), MIN(vector_dims(embedding)) FROM user_embeddings;

\echo '== 2. Literal vectors and the three distance operators =='
SELECT '[1,0,0]'::vector <=> '[1,1,0]'::vector  AS cosine_distance,
       '[1,0,0]'::vector <-> '[1,1,0]'::vector  AS l2_distance,
       '[1,2,3]'::vector <#> '[4,5,6]'::vector  AS negative_inner_product;

\echo '== 3. Vector arithmetic and norms =='
SELECT vector_norm('[3,4]'::vector) AS norm,
       '[1,2,3]'::vector + '[4,5,6]'::vector AS sum,
       vector_dims('[1,2,3]'::vector) AS dims;

\echo '== 4. k-nearest-neighbour: top issues for one contributor (cosine similarity) =='
SELECT u.name AS contributor, i.title AS issue,
       ROUND((1 - (i.embedding <=> ue.embedding))::numeric, 3) AS similarity
  FROM user_embeddings ue
  JOIN users u  ON u.id = ue.user_id
  JOIN issues i ON i.status = 'open'
 WHERE u.email = 'vijay@devmatch.dev'
 ORDER BY i.embedding <=> ue.embedding
 LIMIT 5;

\echo '== 5. Reverse search: best contributors for one issue =='
SELECT u.name AS contributor,
       ROUND((1 - (ue.embedding <=> i.embedding))::numeric, 3) AS similarity
  FROM issues i
  JOIN user_embeddings ue ON TRUE
  JOIN users u ON u.id = ue.user_id
 WHERE i.title = 'Speed up the slow search query with a database index'
 ORDER BY ue.embedding <=> i.embedding
 LIMIT 5;

\echo '== 6. Issue <-> issue: nearest neighbours (the "similar issues" panel) =='
SELECT j.title AS similar_issue,
       ROUND((1 - (j.embedding <=> i.embedding))::numeric, 3) AS similarity
  FROM issues i JOIN issues j ON j.id <> i.id
 WHERE i.title = 'Add pagination to the /items REST endpoint'
 ORDER BY j.embedding <=> i.embedding
 LIMIT 4;

\echo '== 7. Aggregates over vectors: the centroid of all contributor profiles =='
SELECT vector_dims(avg(embedding)) AS centroid_dims FROM user_embeddings;
SELECT i.title, ROUND((1 - (i.embedding <=> (SELECT avg(embedding) FROM user_embeddings)))::numeric, 3) AS closeness_to_community
  FROM issues i ORDER BY i.embedding <=> (SELECT avg(embedding) FROM user_embeddings) LIMIT 3;

\echo '== 8. Approximate-nearest-neighbour index (ivfflat) =='
SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('idx_issues_embedding', 'idx_user_embeddings');
SHOW ivfflat.probes;
-- how the index would be created / tuned:
--   CREATE INDEX idx_issues_embedding ON issues USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--   SET ivfflat.probes = 10;      -- more probes = better recall, slower
--   (an HNSW index is the alternative:  USING hnsw (embedding vector_cosine_ops))

\echo '== 9. Query plan for a nearest-neighbour search (index forced on) =='
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM issues ORDER BY embedding <=> (SELECT embedding FROM issues WHERE id = 1) LIMIT 3;
RESET enable_seqscan;

\echo '== 10. Dimension safety: a wrong-sized vector is rejected =='
BEGIN;
SAVEPOINT s;
\set ON_ERROR_STOP off
INSERT INTO issues (project_id, title, description, difficulty, embedding) VALUES (1, 't', 'd', 'easy', '[1,2,3]');
ROLLBACK TO SAVEPOINT s;
\set ON_ERROR_STOP on
ROLLBACK;
```

Actual output:

```text
== 1. Extension and vector columns ==
 extname | extversion 
---------+------------
 vector  | 0.6.0
(1 row)

   table_name    | column_name | udt_name 
-----------------+-------------+----------
 issues          | embedding   | vector
 user_embeddings | embedding   | vector
(2 rows)

      table      | vectors | dims 
-----------------+---------+------
 issues          |      22 |  384
 user_embeddings |      11 |  384
(2 rows)

== 2. Literal vectors and the three distance operators ==
   cosine_distance   | l2_distance | negative_inner_product 
---------------------+-------------+------------------------
 0.29289321881345254 |           1 |                    -32
(1 row)

== 3. Vector arithmetic and norms ==
 norm |   sum   | dims 
------+---------+------
    5 | [5,7,9] |    3
(1 row)

== 4. k-nearest-neighbour: top issues for one contributor (cosine similarity) ==
 contributor |                        issue                         | similarity 
-------------+------------------------------------------------------+------------
 Vijay Kumar | Speed up the slow search query with a database index |      0.784
 Vijay Kumar | Add pagination to the /items REST endpoint           |      0.777
 Vijay Kumar | Rate-limit login attempts to prevent brute force     |      0.528
 Vijay Kumar | Make the app work offline with local SQLite sync     |      0.431
 Vijay Kumar | Translate the API reference into Spanish             |      0.328
(5 rows)

== 5. Reverse search: best contributors for one issue ==
 contributor  | similarity 
--------------+------------
 Vijay Kumar  |      0.784
 Liam O'Brien |      0.456
 Meera Joshi  |      0.104
 Rohan Mehta  |      0.104
 Zoe Chen     |      0.100
(5 rows)

== 6. Issue <-> issue: nearest neighbours (the "similar issues" panel) ==
                    similar_issue                     | similarity 
------------------------------------------------------+------------
 Speed up the slow search query with a database index |      0.651
 Rate-limit login attempts to prevent brute force     |      0.629
 Translate the API reference into Spanish             |      0.433
 Make the app work offline with local SQLite sync     |      0.431
(4 rows)

== 7. Aggregates over vectors: the centroid of all contributor profiles ==
 centroid_dims 
---------------
           384
(1 row)

 title | closeness_to_community 
-------+------------------------
(0 rows)

== 8. Approximate-nearest-neighbour index (ivfflat) ==
      indexname       |                                                         indexdef                                                          
----------------------+---------------------------------------------------------------------------------------------------------------------------
 idx_issues_embedding | CREATE INDEX idx_issues_embedding ON public.issues USING ivfflat (embedding vector_cosine_ops) WITH (lists='100')
 idx_user_embeddings  | CREATE INDEX idx_user_embeddings ON public.user_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists='100')
(2 rows)

 ivfflat.probes 
----------------
 1
(1 row)

== 9. Query plan for a nearest-neighbour search (index forced on) ==
                       QUERY PLAN                        
---------------------------------------------------------
 Limit
   InitPlan 1 (returns $0)
     ->  Index Scan using issues_pkey on issues issues_1
           Index Cond: (id = 1)
   ->  Index Scan using idx_issues_embedding on issues
         Order By: (embedding <=> $0)
(6 rows)

== 10. Dimension safety: a wrong-sized vector is rejected ==
psql:db/vector-commands.sql:77: ERROR:  expected 384 dimensions, not 3
```

### 6.2 MongoDB setup — `db/mongo-init.js`

```javascript
// =====================================================================
//  DevMatch — MongoDB setup (mongosh). Same effect as setupMongo() in src/lib/mongo.ts.
//
//    mongosh "mongodb://localhost:27017/devmatch" --file db/mongo-init.js
//
//  Idempotent: safe to run more than once.
//
//  Collections
//    comments      discussion threads on issues; replies are EMBEDDED in each comment document
//    activity_log  append-only event stream; `meta` differs per event type; TTL index expires old events
// =====================================================================

const commentValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['issueId', 'authorId', 'authorName', 'authorRole', 'body', 'createdAt', 'likes', 'replies'],
    properties: {
      issueId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
      authorId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
      authorName: { bsonType: 'string' },
      authorRole: { enum: ['contributor', 'maintainer'] },
      body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
      createdAt: { bsonType: 'date' },
      likes: { bsonType: 'array', items: { bsonType: ['int', 'long', 'double'] } },
      replies: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['_id', 'authorId', 'authorName', 'body', 'createdAt'],
          properties: {
            body: { bsonType: 'string', minLength: 1, maxLength: 2000 },
            createdAt: { bsonType: 'date' },
          },
        },
      },
    },
  },
};

const activityValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['ts', 'type', 'actorId', 'actorName'],
    properties: {
      ts: { bsonType: 'date' },
      type: { bsonType: 'string' },
      actorId: { bsonType: ['int', 'long', 'double'] },
      actorName: { bsonType: 'string' },
      meta: { bsonType: 'object' },
    },
  },
};

function ensureCollection(name, validator) {
  const exists = db.getCollectionInfos({ name }).length > 0;
  if (!exists) {
    db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
    print(`created collection ${name}`);
  } else {
    db.runCommand({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
    print(`updated validator of ${name}`);
  }
}

ensureCollection('comments', commentValidator);
ensureCollection('activity_log', activityValidator);

// --- comments: thread lookup, author lookup, multikey index on the embedded array, full-text search
db.comments.createIndex({ issueId: 1, createdAt: -1 }, { name: 'issue_thread' });
db.comments.createIndex({ authorId: 1 }, { name: 'by_author' });
db.comments.createIndex({ 'replies.authorId': 1 }, { name: 'by_reply_author' });
db.comments.createIndex({ body: 'text', 'replies.body': 'text' }, { name: 'comment_text' });

// --- activity_log: newest first, by type, by actor, and a TTL index (events vanish after 90 days)
db.activity_log.createIndex({ ts: -1 }, { name: 'recent_first' });
db.activity_log.createIndex({ type: 1, ts: -1 }, { name: 'by_type' });
db.activity_log.createIndex({ actorId: 1, ts: -1 }, { name: 'by_actor' });
db.activity_log.createIndex({ ts: 1 }, { name: 'ttl_90_days', expireAfterSeconds: 60 * 60 * 24 * 90 });

print('\nIndexes on comments:      ' + db.comments.getIndexes().map((i) => i.name).join(', '));
print('Indexes on activity_log:  ' + db.activity_log.getIndexes().map((i) => i.name).join(', '));
```

### 6.3 MongoDB CRUD, aggregation, text search, indexes, validation — `db/mongo-commands.js`

```javascript
// =====================================================================
//  DevMatch — MongoDB command reference (mongosh)
//
//    mongosh "mongodb://localhost:27017/devmatch" --file db/mongo-commands.js
//
//  Runs against the seeded database. Documents it creates use issueId 999999 and are deleted at the end.
// =====================================================================
const show = (title, value) => {
  print('\n== ' + title + ' ==');
  printjson(value);
};

// ---------------------------------------------------------------- 0. inspect
show('0. collections and sizes', {
  database: db.getName(),
  collections: db.getCollectionNames(),
  comments: db.comments.countDocuments(),
  activity_log: db.activity_log.countDocuments(),
});
show('0. one comment document (replies are embedded)', db.comments.findOne({}, { body: 1, authorName: 1, likes: 1, replies: 1 }));

// ---------------------------------------------------------------- 1. CREATE
const t0 = new Date();
const r1 = db.comments.insertOne({
  issueId: 999999, authorId: 1, authorName: 'Demo Author', authorRole: 'contributor',
  body: 'Is a cursor-based approach acceptable for the first version?', createdAt: t0, likes: [], replies: [],
});
const r2 = db.comments.insertMany([
  { issueId: 999999, authorId: 2, authorName: 'Demo Maintainer', authorRole: 'maintainer',
    body: 'Please add a benchmark with the trigram index', createdAt: new Date(t0.getTime() + 1000), likes: [1, 3], replies: [] },
  { issueId: 999999, authorId: 3, authorName: 'Demo Reviewer', authorRole: 'contributor',
    body: 'I can pick this up next week', createdAt: new Date(t0.getTime() + 2000), likes: [], replies: [] },
]);
show('1. insertOne / insertMany', { insertedOne: r1.acknowledged, insertedMany: Object.keys(r2.insertedIds).length });

db.activity_log.insertOne({ ts: new Date(), type: 'demo_event', actorId: 1, actorName: 'Demo Author', actorRole: 'contributor',
  issueId: 999999, meta: { note: 'meta can hold any shape', tags: ['a', 'b'], nested: { ok: true } } });

// ---------------------------------------------------------------- 2. READ
show('2a. find + filter + projection + sort + limit',
  db.comments.find({ issueId: 999999 }, { _id: 0, authorName: 1, body: 1 }).sort({ createdAt: -1 }).limit(2).toArray());
show('2b. comparison and logical operators ($gte, $and, $or)',
  db.comments.find({ $and: [{ issueId: { $gte: 1 } }, { $or: [{ authorRole: 'maintainer' }, { likes: { $size: 2 } }] }] },
    { _id: 0, issueId: 1, authorName: 1, authorRole: 1 }).limit(4).toArray());
show('2c. array operators: likes contains 1, $size, $elemMatch on embedded replies',
  {
    likedByUser1: db.comments.countDocuments({ issueId: 999999, likes: 1 }),
    withTwoLikes: db.comments.countDocuments({ issueId: 999999, likes: { $size: 2 } }),
    withMaintainerReply: db.comments.countDocuments({ replies: { $elemMatch: { authorRole: 'maintainer' } } }),
  });
show('2d. regular expression + dot notation into an embedded document',
  db.comments.find({ body: /index/i }, { _id: 0, authorName: 1, body: 1 }).limit(3).toArray());
show('2e. distinct and count', {
  eventTypes: db.activity_log.distinct('type'),
  issuesWithThreads: db.comments.distinct('issueId').length,
});

// ---------------------------------------------------------------- 3. UPDATE
const first = db.comments.findOne({ issueId: 999999, authorId: 1 });
db.comments.updateOne({ _id: first._id }, { $set: { body: first.body + ' (edited)' } });
db.comments.updateOne({ _id: first._id }, {
  $push: { replies: { _id: new ObjectId(), authorId: 2, authorName: 'Demo Maintainer', authorRole: 'maintainer', body: 'Yes, cursor-based please', createdAt: new Date() } },
});
db.comments.updateOne({ _id: first._id }, { $addToSet: { likes: 2 } });
db.comments.updateOne({ _id: first._id }, { $addToSet: { likes: 2 } }); // duplicate -> ignored: likes behaves as a set
show('3a. $set, $push (embedded reply) and $addToSet', db.comments.findOne({ _id: first._id }, { _id: 0, body: 1, likes: 1, 'replies.body': 1 }));

db.comments.updateOne({ _id: first._id }, { $pull: { likes: 2 } });
db.comments.updateOne({ _id: first._id, 'replies.authorId': 2 }, { $set: { 'replies.$.body': 'Yes, cursor-based please (edited)' } }); // positional operator
show('3b. $pull and the positional $ operator', db.comments.findOne({ _id: first._id }, { _id: 0, likes: 1, 'replies.body': 1 }));

db.comments.updateMany({ issueId: 999999, authorId: 1 }, { $set: { authorName: '[deleted user]' } });
db.comments.updateMany({ issueId: 999999 }, { $set: { 'replies.$[r].authorName': '[deleted user]' } }, { arrayFilters: [{ 'r.authorId': 2 }] });
show('3c. updateMany + arrayFilters (anonymise an author everywhere)',
  db.comments.find({ issueId: 999999 }, { _id: 0, authorName: 1, 'replies.authorName': 1 }).sort({ createdAt: 1 }).toArray());

const up = db.activity_log.updateOne({ type: 'demo_upsert' }, { $setOnInsert: { ts: new Date(), actorId: 1, actorName: 'Demo' }, $inc: { 'meta.count': 1 } }, { upsert: true });
db.activity_log.updateOne({ type: 'demo_upsert' }, { $inc: { 'meta.count': 1 } });
show('3d. upsert + $inc', { upsertedCount: up.upsertedCount, counter: db.activity_log.findOne({ type: 'demo_upsert' }).meta.count });

// ---------------------------------------------------------------- 4. AGGREGATION
show('4a. events by type  ($group, $sort)', db.activity_log.aggregate([
  { $group: { _id: '$type', events: { $sum: 1 } } },
  { $sort: { events: -1, _id: 1 } },
  { $limit: 6 },
]).toArray());

show('4b. events per day  ($match, $dateToString)', db.activity_log.aggregate([
  { $match: { ts: { $gte: new Date(Date.now() - 14 * 86400000) } } },
  { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, events: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray().slice(-5));

show('4c. most active users  ($group + $addToSet + $project + $size)', db.activity_log.aggregate([
  { $group: { _id: { actor: '$actorName', role: '$actorRole' }, events: { $sum: 1 }, kinds: { $addToSet: '$type' }, lastSeen: { $max: '$ts' } } },
  { $project: { _id: 0, actor: '$_id.actor', role: '$_id.role', events: 1, distinctKinds: { $size: '$kinds' } } },
  { $sort: { events: -1, actor: 1 } },
  { $limit: 3 },
]).toArray());

show('4d. most discussed issues  ($project with $size, $group, $addFields)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $project: { issueId: 1, replyCount: { $size: '$replies' }, likeCount: { $size: '$likes' } } },
  { $group: { _id: '$issueId', comments: { $sum: 1 }, replies: { $sum: '$replyCount' }, likes: { $sum: '$likeCount' } } },
  { $addFields: { messages: { $add: ['$comments', '$replies'] } } },
  { $sort: { messages: -1, _id: 1 } },
  { $limit: 3 },
]).toArray());

show('4e. who replies most  ($unwind on an embedded array)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $unwind: '$replies' },
  { $group: { _id: '$replies.authorName', replies: { $sum: 1 } } },
  { $sort: { replies: -1, _id: 1 } },
  { $limit: 3 },
]).toArray());

show('4f. collection-to-collection join  ($lookup)', db.comments.aggregate([
  { $match: { issueId: { $lt: 999999 } } },
  { $group: { _id: '$issueId', comments: { $sum: 1 } } },
  { $lookup: { from: 'activity_log', localField: '_id', foreignField: 'issueId', as: 'events' } },
  { $project: { _id: 1, comments: 1, relatedEvents: { $size: '$events' } } },
  { $sort: { _id: 1 } },
  { $limit: 3 },
]).toArray());

// ---------------------------------------------------------------- 5. TEXT SEARCH
show('5. full-text search with relevance score ($text, $meta: textScore)', db.comments.find(
  { $text: { $search: 'trigram index benchmark' } }, { _id: 0, authorName: 1, body: 1, score: { $meta: 'textScore' } },
).sort({ score: { $meta: 'textScore' } }).limit(3).toArray());

// ---------------------------------------------------------------- 6. INDEXES AND PLANS
const plan = db.comments.find({ issueId: 999999 }).sort({ createdAt: -1 }).explain('executionStats');
const winning = plan.queryPlanner.winningPlan.queryPlan ?? plan.queryPlanner.winningPlan;
const chain = (p) => [p.stage].concat(p.inputStage ? chain(p.inputStage) : []);
show('6a. explain(): the thread query uses the issue_thread index', {
  stages: chain(winning),
  index: JSON.stringify(plan.queryPlanner.winningPlan).match(/"indexName":"([^"]+)"/)?.[1],
  docsExamined: plan.executionStats.totalDocsExamined,
  returned: plan.executionStats.nReturned,
});
show('6b. all indexes', {
  comments: db.comments.getIndexes().map((i) => i.name),
  activity_log: db.activity_log.getIndexes().map((i) => ({ name: i.name, ttlSeconds: i.expireAfterSeconds })),
});

// ---------------------------------------------------------------- 7. SCHEMA VALIDATION
const attempts = {};
for (const [label, doc] of [
  ['missing required fields', { issueId: 1 }],
  ['empty body', { issueId: 1, authorId: 1, authorName: 'x', authorRole: 'contributor', body: '', createdAt: new Date(), likes: [], replies: [] }],
  ['invalid role', { issueId: 1, authorId: 1, authorName: 'x', authorRole: 'admin', body: 'hi', createdAt: new Date(), likes: [], replies: [] }],
]) {
  try { db.comments.insertOne(doc); attempts[label] = 'ACCEPTED (unexpected)'; } catch (e) { attempts[label] = 'rejected, code ' + e.code; }
}
show('7. $jsonSchema validator rejects bad documents', attempts);

// ---------------------------------------------------------------- 8. DELETE (cleanup)
const d1 = db.comments.deleteOne({ issueId: 999999, authorId: 3 });
const d2 = db.comments.deleteMany({ issueId: 999999 });
const d3 = db.activity_log.deleteMany({ type: { $in: ['demo_event', 'demo_upsert'] } });
show('8. deleteOne / deleteMany', { deleteOne: d1.deletedCount, deleteMany: d2.deletedCount, activityCleaned: d3.deletedCount });
```

Actual output (`mongosh --file db/mongo-commands.js`):

```text

== 0. collections and sizes ==
{
  database: 'devmatch_next',
  collections: [
    'comments',
    'activity_log'
  ],
  comments: 6,
  activity_log: 71
}

== 0. one comment document (replies are embedded) ==
{
  _id: ObjectId('6af08539d5c1c4b5944ac091'),
  authorName: 'Vijay Kumar',
  body: 'Is cursor-based pagination required, or would limit/offset be acceptable for a first version?',
  likes: [
    1
  ],
  replies: [
    {
      _id: ObjectId('6af08539d5c1c4b5944ac092'),
      authorId: 1,
      authorName: 'Asha Rao',
      authorRole: 'maintainer',
      body: 'Cursor-based please — offset gets slow on the large items table. Keep the old response shape behind a `legacy` flag.',
      createdAt: ISODate('2026-11-06T16:07:41.526Z')
    },
    {
      _id: ObjectId('6af08539d5c1c4b5944ac093'),
      authorId: 5,
      authorName: 'Vijay Kumar',
      authorRole: 'contributor',
      body: 'Makes sense. I will base the cursor on the (created_at, id) pair so ordering stays stable.',
      createdAt: ISODate('2026-11-06T16:54:41.526Z')
    }
  ]
}

== 1. insertOne / insertMany ==
{
  insertedOne: true,
  insertedMany: 2
}

== 2a. find + filter + projection + sort + limit ==
[
  {
    authorName: 'Demo Reviewer',
    body: 'I can pick this up next week'
  },
  {
    authorName: 'Demo Maintainer',
    body: 'Please add a benchmark with the trigram index'
  }
]

== 2b. comparison and logical operators ($gte, $in, $and, $or) ==
[
  {
    issueId: 6,
    authorName: "Liam O'Brien",
    authorRole: 'contributor'
  },
  {
    issueId: 999999,
    authorName: 'Demo Maintainer',
    authorRole: 'maintainer'
  }
]

== 2c. array operators: likes contains 1, $size, $elemMatch on embedded replies ==
{
  likedByUser1: 1,
  withTwoLikes: 1,
  withMaintainerReply: 4
}

== 2d. regular expression + dot notation into an embedded document ==
[
  {
    authorName: "Liam O'Brien",
    body: 'Do we have an EXPLAIN ANALYZE from production? A trigram GIN index might beat a plain B-tree for this search.'
  },
  {
    authorName: 'Demo Maintainer',
    body: 'Please add a benchmark with the trigram index'
  }
]

== 2e. distinct and count ==
{
  eventTypes: [
    'accepted',
    'applied',
    'comment',
    'demo_event',
    'issue_created',
    'login',
    'project_created',
    'register',
    'reply'
  ],
  issuesWithThreads: 7
}

== 3a. $set, $push (embedded reply) and $addToSet ==
{
  body: 'Is a cursor-based approach acceptable for the first version? (edited)',
  likes: [
    2
  ],
  replies: [
    {
      body: 'Yes, cursor-based please'
    }
  ]
}

== 3b. $pull and the positional $ operator ==
{
  likes: [],
  replies: [
    {
      body: 'Yes, cursor-based please (edited)'
    }
  ]
}

== 3c. updateMany + arrayFilters (anonymise an author everywhere) ==
[
  {
    authorName: '[deleted user]',
    replies: [
      {
        authorName: '[deleted user]'
      }
    ]
  },
  {
    authorName: 'Demo Maintainer',
    replies: []
  },
  {
    authorName: 'Demo Reviewer',
    replies: []
  }
]

== 3d. upsert + $inc ==
{
  upserted: false,
  counter: 2
}

== 4a. events by type  ($group, $sort) ==
[
  {
    _id: 'issue_created',
    events: 22
  },
  {
    _id: 'register',
    events: 15
  },
  {
    _id: 'applied',
    events: 10
  },
  {
    _id: 'project_created',
    events: 8
  },
  {
    _id: 'comment',
    events: 6
  },
  {
    _id: 'reply',
    events: 5
  }
]

== 4b. events per day  ($match, $dateToString) ==
[
  {
    _id: '2026-11-04',
    events: 2
  },
  {
    _id: '2026-11-05',
    events: 7
  },
  {
    _id: '2026-11-06',
    events: 7
  },
  {
    _id: '2026-11-07',
    events: 5
  },
  {
    _id: '2026-11-08',
    events: 3
  }
]

== 4c. most active users  ($group + $addToSet + $project + $size) ==
[
  {
    events: 14,
    actor: 'Asha Rao',
    role: 'maintainer',
    distinctKinds: 6
  },
  {
    events: 12,
    actor: 'Marcus Lee',
    role: 'maintainer',
    distinctKinds: 5
  },
  {
    events: 8,
    actor: 'Priya Nair',
    role: 'maintainer',
    distinctKinds: 3
  }
]

== 4d. most discussed issues  ($project with $size, $group, $addFields) ==
[
  {
    _id: 5,
    comments: 1,
    replies: 2,
    likes: 1,
    messages: 3
  },
  {
    _id: 6,
    comments: 1,
    replies: 1,
    likes: 2,
    messages: 2
  },
  {
    _id: 11,
    comments: 1,
    replies: 1,
    likes: 0,
    messages: 2
  }
]

== 4e. who replies most  ($unwind on an embedded array) ==
[
  {
    _id: 'Asha Rao',
    replies: 2
  },
  {
    _id: 'Marcus Lee',
    replies: 2
  },
  {
    _id: 'Vijay Kumar',
    replies: 1
  }
]

== 4f. collection-to-collection join  ($lookup) ==
[
  {
    _id: 3,
    comments: 1,
    relatedEvents: 5
  },
  {
    _id: 5,
    comments: 1,
    relatedEvents: 5
  },
  {
    _id: 6,
    comments: 1,
    relatedEvents: 5
  }
]

== 5. full-text search with relevance score ($text, $meta: textScore) ==
[
  {
    authorName: 'Demo Maintainer',
    body: 'Please add a benchmark with the trigram index',
    score: 1.7999999999999998
  },
  {
    authorName: "Liam O'Brien",
    body: 'Do we have an EXPLAIN ANALYZE from production? A trigram GIN index might beat a plain B-tree for this search.',
    score: 1.0833333333333333
  },
  {
    authorName: 'Rohan Mehta',
    body: 'Do you have a benchmark that reproduces the growth? I would like to start from a failing test.',
    score: 0.5714285714285714
  }
]

== 6a. explain(): the thread query uses the issue_thread index ==
{
  stages: [
    'FETCH',
    'IXSCAN'
  ],
  index: 'issue_thread',
  docsExamined: 3,
  returned: 3
}

== 6b. all indexes ==
{
  comments: [
    '_id_',
    'issue_thread',
    'by_author',
    'by_reply_author',
    'comment_text'
  ],
  activity_log: [
    {
      name: '_id_',
      ttlSeconds: undefined
    },
    {
      name: 'recent_first',
      ttlSeconds: undefined
    },
    {
      name: 'by_type',
      ttlSeconds: undefined
    },
    {
      name: 'by_actor',
      ttlSeconds: undefined
    },
    {
      name: 'ttl_90_days',
      ttlSeconds: 7776000
    }
  ]
}

== 7. $jsonSchema validator rejects bad documents ==
{
  'missing required fields': 'rejected, code 121',
  'empty body': 'rejected, code 121',
  'invalid role': 'rejected, code 121'
}

== 8. deleteOne / deleteMany ==
{
  deleteOne: 1,
  deleteMany: 2,
  activityCleaned: 2
}
```


## 7. Next.js – Project Tree Structure

```text
devmatch/
├── db
│   ├── mongo-commands.js
│   ├── mongo-init.js
│   ├── queries.sql
│   ├── schema.sql
│   └── vector-commands.sql
├── docs
│   ├── screenshots
│   ├── er-diagram.mmd
│   └── project-tree.txt
├── public
├── scripts
│   ├── env.ts
│   ├── init-db.ts
│   ├── reindex.ts
│   ├── seed-data.json
│   └── seed.ts
├── src
│   ├── app
│   │   ├── actions
│   │   │   ├── applications.ts
│   │   │   ├── auth.ts
│   │   │   ├── comments.ts
│   │   │   ├── issues.ts
│   │   │   ├── notifications.ts
│   │   │   ├── profile.ts
│   │   │   └── projects.ts
│   │   ├── activity
│   │   │   └── page.tsx
│   │   ├── api
│   │   │   ├── feed
│   │   │   │   └── route.ts
│   │   │   ├── health
│   │   │   │   └── route.ts
│   │   │   ├── issues
│   │   │   │   ├── [id]
│   │   │   │   │   ├── matches
│   │   │   │   │   │   └── route.ts
│   │   │   │   │   └── similar
│   │   │   │   │       └── route.ts
│   │   │   │   └── route.ts
│   │   │   └── me
│   │   │       └── route.ts
│   │   ├── applications
│   │   │   └── page.tsx
│   │   ├── dashboard
│   │   │   └── page.tsx
│   │   ├── feed
│   │   │   └── page.tsx
│   │   ├── insights
│   │   │   └── page.tsx
│   │   ├── issues
│   │   │   ├── [id]
│   │   │   │   ├── edit
│   │   │   │   │   └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   └── page.tsx
│   │   ├── login
│   │   │   └── page.tsx
│   │   ├── notifications
│   │   │   └── page.tsx
│   │   ├── profile
│   │   │   └── page.tsx
│   │   ├── projects
│   │   │   ├── [id]
│   │   │   │   ├── edit
│   │   │   │   │   └── page.tsx
│   │   │   │   ├── issues
│   │   │   │   │   └── new
│   │   │   │   │       └── page.tsx
│   │   │   │   └── page.tsx
│   │   │   └── new
│   │   │       └── page.tsx
│   │   ├── register
│   │   │   └── page.tsx
│   │   ├── error.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── not-found.tsx
│   │   └── page.tsx
│   ├── components
│   │   ├── forms
│   │   │   ├── AuthForms.tsx
│   │   │   ├── ProfileForm.tsx
│   │   │   └── ProjectIssueForms.tsx
│   │   ├── ConfirmForm.tsx
│   │   ├── Flash.tsx
│   │   ├── Header.tsx
│   │   ├── NavLink.tsx
│   │   ├── SkillEditor.tsx
│   │   ├── SubmitButton.tsx
│   │   ├── Thread.tsx
│   │   ├── ui.tsx
│   │   └── useActionForm.ts
│   ├── lib
│   │   ├── activity.ts
│   │   ├── analytics.ts
│   │   ├── auth.ts
│   │   ├── db.ts
│   │   ├── discussion.ts
│   │   ├── embedder.ts
│   │   ├── flash.ts
│   │   ├── format.ts
│   │   ├── insights.ts
│   │   ├── mongo.ts
│   │   ├── params.ts
│   │   ├── queries.ts
│   │   ├── types.ts
│   │   └── writes.ts
│   └── middleware.ts
├── tests
│   ├── db.test.ts
│   ├── e2e.cjs
│   └── embedder.test.ts
├── .env.example
├── .gitignore
├── docker-compose.yml
├── next-env.d.ts
├── next.config.mjs
├── package-lock.json
├── package.json
└── tsconfig.json
```

Next.js features used: App Router with nested dynamic routes (`issues/[id]`, `projects/[id]/edit`), server components that query the databases directly, **server actions** for every mutation (`src/app/actions`), **route handlers** (`src/app/api/*`), **middleware** for route protection, `loading`/`error`/`not-found` conventions, and client components only where interactivity is needed (header, skill editor, discussion thread).

## 8. Sample Screenshots of Application Code and Demo
Demo logins (password `password123`): `asha@devmatch.dev` (maintainer), `vijay@devmatch.dev`, `neha@devmatch.dev`, `ishaan@devmatch.dev` (contributors).

### 8.1 Application demo

**Entity-relationship diagram (PostgreSQL tables + MongoDB collections linked by issueId / actorId)**

![Entity-relationship diagram (PostgreSQL tables + MongoDB collections linked by issueId / actorId)](docs/screenshots/00-er-diagram.png)

**Landing page**

![Landing page](docs/screenshots/01-landing.png)

**Login**

![Login](docs/screenshots/02-login.png)

**Registration (role selection)**

![Registration (role selection)](docs/screenshots/03-register.png)

**Contributor feed — issues ranked by pgvector cosine similarity**

![Contributor feed — issues ranked by pgvector cosine similarity](docs/screenshots/04-feed-contributor.png)

**Issue detail: match score, similar issues (pgvector), discussion thread (MongoDB, replies embedded)**

![Issue detail: match score, similar issues (pgvector), discussion thread (MongoDB, replies embedded)](docs/screenshots/05-issue-detail-match-discussion.png)

**Contributor: my applications**

![Contributor: my applications](docs/screenshots/06-my-applications.png)

**Notifications (written by a PostgreSQL trigger)**

![Notifications (written by a PostgreSQL trigger)](docs/screenshots/07-notifications.png)

**Profile and skills (re-embeds the user vector on save)**

![Profile and skills (re-embeds the user vector on save)](docs/screenshots/08-profile.png)

**DB insights page: SQL aggregates, pgvector queries and MongoDB pipelines side by side**

![DB insights page: SQL aggregates, pgvector queries and MongoDB pipelines side by side](docs/screenshots/09-insights-sql-vector-mongo.png)

**Activity feed (MongoDB activity_log, TTL index)**

![Activity feed (MongoDB activity_log, TTL index)](docs/screenshots/10-activity-mongodb.png)

**REST route handler /api/issues/[id]/similar**

![REST route handler /api/issues/[id]/similar](docs/screenshots/11-api-similar-json.png)

**Maintainer dashboard and review queue (best fit first)**

![Maintainer dashboard and review queue (best fit first)](docs/screenshots/12-maintainer-dashboard.png)

### 8.2 Code

**SQL: transactional accept_application() PL/pgSQL function**

![SQL: transactional accept_application() PL/pgSQL function](docs/screenshots/13-code-sql-accept-application.png)

**MongoDB: collection validators and indexes (setupMongo)**

![MongoDB: collection validators and indexes (setupMongo)](docs/screenshots/14-code-mongodb-setup.png)

**Next.js: server actions for applications**

![Next.js: server actions for applications](docs/screenshots/15-code-nextjs-server-action.png)

**Next.js: route handler**

![Next.js: route handler](docs/screenshots/16-code-nextjs-api-route.png)

**pgvector: k-nearest-neighbour queries**

![pgvector: k-nearest-neighbour queries](docs/screenshots/17-code-pgvector-query.png)

**MongoDB: aggregation pipelines**

![MongoDB: aggregation pipelines](docs/screenshots/18-code-mongo-aggregation.png)

## 9. Evaluation Rubrics – Completion Status
The table maps each item the professors listed, and the usual DBMS evaluation criteria, to where it is implemented.

| # | Rubric item | Status | Evidence |
|---|---|---|---|
| 1 | Project title | Complete | Section 1 |
| 2 | Student SRNs and names | Complete | Section 2 |
| 3 | Abstract | Complete | Section 3 |
| 4 | Technology stack | Complete | Section 4, `package.json`, `docker-compose.yml` |
| 5 | SQL database commands (DDL, DML, queries) | Complete | `db/schema.sql`, `db/queries.sql` with executed output |
| 6a | Vector database commands | Complete | `db/vector-commands.sql` (pgvector, KNN, ivfflat) |
| 6b | NoSQL commands | Complete | `db/mongo-init.js`, `db/mongo-commands.js` (CRUD, aggregation, text, TTL, validation) |
| 7 | Next.js project tree | Complete | Section 7, `src/app` |
| 8 | Screenshots of code and demo | Complete | `docs/screenshots/` (19 images) |
| 9 | Rubric completion status | Complete | this table |
| – | ER diagram / normalisation | Complete | Section 4, `docs/er-diagram.mmd` |
| – | Constraints, keys, indexes | Complete | PK/FK/UNIQUE/CHECK, B-tree, ivfflat, Mongo multikey/text/TTL |
| – | Triggers, stored procedures, views | Complete | `fn_check_application`, `fn_notify_maintainer`, `accept_application`, `open_issues_view` |
| – | Transactions / concurrency | Complete | `accept_application` uses `SELECT … FOR UPDATE` in one transaction |
| – | CRUD with a UI | Complete | projects, issues, applications, profile, comments |
| – | Authentication | Complete | JWT HttpOnly cookie, bcrypt, middleware |
| – | Automated tests | Complete | 6 embedder + 23 DB tests; 37-step Playwright e2e |
| – | Optional MiniLM neural embeddings | Implemented, untested | needs internet to download the model; hash embedder is the tested default |
