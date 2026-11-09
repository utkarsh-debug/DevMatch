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
