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
