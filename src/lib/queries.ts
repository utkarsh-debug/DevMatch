/**
 * Read queries (PostgreSQL). Semantic matching is done in SQL with pgvector:
 *     similarity = 1 - (a.embedding <=> b.embedding)       -- <=> is cosine distance
 */
import { q, q1 } from '@/lib/db';
import type { Difficulty, IssueStatus, AppStatus, Level } from '@/lib/types';

/** SQL fragment: "python (advanced), sql (intermediate)" for the user column given. */
export const skillsOf = (ref: string) => `(
  SELECT string_agg(s.name || ' (' || COALESCE(us.proficiency,'intermediate') || ')', ', ' ORDER BY s.name)
    FROM user_skills us JOIN skills s ON s.id = us.skill_id
   WHERE us.user_id = ${ref})`;

export interface IssueCardRow {
  id: number;
  title: string;
  description: string;
  difficulty: Difficulty;
  created_at: Date;
  project_title: string;
  tech_stack: string | null;
  maintainer: string;
  similarity: number | null;
  my_status: AppStatus | null;
}

// ----------------------------------------------------------------------------- stats
export async function landingStats() {
  return q1<{ open_issues: number; contributors: number; projects: number }>(
    `SELECT (SELECT COUNT(*) FROM issues WHERE status='open')       AS open_issues,
            (SELECT COUNT(*) FROM users  WHERE role='contributor')  AS contributors,
            (SELECT COUNT(*) FROM projects)                         AS projects`,
  );
}

export async function unreadCount(userId: number): Promise<number> {
  const r = await q1<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND NOT read_status', [
    userId,
  ]);
  return r?.n ?? 0;
}

// ------------------------------------------------------------- contributor: ranked feed
export async function feedFor(userId: number, search: string, difficulty: string): Promise<IssueCardRow[]> {
  const params: unknown[] = [userId, userId];
  const where = ["i.status = 'open'"];
  if (['easy', 'medium', 'hard'].includes(difficulty)) {
    params.push(difficulty);
    where.push(`i.difficulty = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(i.title ILIKE $${n} OR i.description ILIKE $${n} OR p.tech_stack ILIKE $${n} OR p.title ILIKE $${n})`);
  }
  return q<IssueCardRow>(
    `SELECT i.id, i.title, i.description, i.difficulty, i.created_at,
            p.title AS project_title, p.tech_stack, u.name AS maintainer,
            CASE WHEN ue.embedding IS NULL OR i.embedding IS NULL THEN NULL
                 ELSE 1 - (i.embedding <=> ue.embedding) END AS similarity,
            (SELECT a.status FROM applications a WHERE a.issue_id = i.id AND a.user_id = $1) AS my_status
       FROM issues i
       JOIN projects p ON p.id = i.project_id
       JOIN users u    ON u.id = p.maintainer_id
       LEFT JOIN user_embeddings ue ON ue.user_id = $2
      WHERE ${where.join(' AND ')}
      ORDER BY similarity DESC NULLS LAST, i.created_at DESC
      LIMIT 60`,
    params,
  );
}

export async function hasProfileVector(userId: number): Promise<boolean> {
  return !!(await q1('SELECT 1 FROM user_embeddings WHERE user_id = $1', [userId]));
}

// ----------------------------------------------------------- browse (uses the VIEW)
export interface ViewRow {
  id: number;
  title: string;
  description: string;
  difficulty: Difficulty;
  project_title: string;
  maintainer: string;
  created_at: Date;
}

export async function browseOpenIssues(search: string, difficulty: string, limit = 100): Promise<ViewRow[]> {
  const where = ['TRUE'];
  const params: unknown[] = [];
  if (['easy', 'medium', 'hard'].includes(difficulty)) {
    params.push(difficulty);
    where.push(`difficulty = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const n = params.length;
    where.push(`(title ILIKE $${n} OR description ILIKE $${n} OR project_title ILIKE $${n})`);
  }
  params.push(limit);
  return q<ViewRow>(
    `SELECT * FROM open_issues_view WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
}

// ------------------------------------------------------------------ issue detail
export interface IssueDetail {
  id: number;
  title: string;
  description: string;
  difficulty: Difficulty;
  status: IssueStatus;
  created_at: Date;
  project_id: number;
  project_title: string;
  repo_url: string;
  tech_stack: string | null;
  maintainer_id: number;
  maintainer: string;
}

export async function issueDetail(id: number) {
  return q1<IssueDetail>(
    `SELECT i.id, i.title, i.description, i.difficulty, i.status, i.created_at,
            p.id AS project_id, p.title AS project_title, p.repo_url, p.tech_stack,
            p.maintainer_id, u.name AS maintainer
       FROM issues i
       JOIN projects p ON p.id = i.project_id
       JOIN users u    ON u.id = p.maintainer_id
      WHERE i.id = $1`,
    [id],
  );
}

export async function myApplication(issueId: number, userId: number) {
  return q1<{ id: number; status: AppStatus; applied_at: Date }>(
    'SELECT id, status, applied_at FROM applications WHERE issue_id = $1 AND user_id = $2',
    [issueId, userId],
  );
}

/** How well does THIS contributor match THIS issue? */
export async function userIssueSimilarity(userId: number, issueId: number): Promise<number | null> {
  const r = await q1<{ s: number }>(
    `SELECT 1 - (i.embedding <=> ue.embedding) AS s
       FROM issues i JOIN user_embeddings ue ON ue.user_id = $1
      WHERE i.id = $2 AND i.embedding IS NOT NULL`,
    [userId, issueId],
  );
  return r?.s ?? null;
}

export interface ApplicantRow {
  id: number;
  status: AppStatus;
  applied_at: Date;
  user_id: number;
  name: string;
  bio: string | null;
  similarity: number | null;
  skills: string | null;
}

/** Applicants for an issue, best semantic fit first (accepted candidate pinned on top). */
export async function applicantsFor(issueId: number): Promise<ApplicantRow[]> {
  return q<ApplicantRow>(
    `SELECT a.id, a.status, a.applied_at, u.id AS user_id, u.name, u.bio,
            CASE WHEN ue.embedding IS NULL OR i.embedding IS NULL THEN NULL
                 ELSE 1 - (ue.embedding <=> i.embedding) END AS similarity,
            ${skillsOf('u.id')} AS skills
       FROM applications a
       JOIN users u  ON u.id = a.user_id
       JOIN issues i ON i.id = a.issue_id
       LEFT JOIN user_embeddings ue ON ue.user_id = u.id
      WHERE a.issue_id = $1
      ORDER BY (a.status = 'accepted') DESC, similarity DESC NULLS LAST, a.applied_at`,
    [issueId],
  );
}

export interface SuggestedRow {
  id: number;
  name: string;
  bio: string | null;
  similarity: number;
  skills: string | null;
}

/** Nearest-neighbour search: contributors whose vectors are closest to the issue and who haven't applied. */
export async function suggestedContributors(issueId: number, limit = 5, minSimilarity = 0.2): Promise<SuggestedRow[]> {
  return q<SuggestedRow>(
    `SELECT u.id, u.name, u.bio, 1 - (ue.embedding <=> i.embedding) AS similarity, ${skillsOf('u.id')} AS skills
       FROM issues i
       JOIN user_embeddings ue ON TRUE
       JOIN users u ON u.id = ue.user_id
      WHERE i.id = $1 AND i.embedding IS NOT NULL
        AND u.role = 'contributor' AND u.account_status = 'active'
        AND 1 - (ue.embedding <=> i.embedding) >= $3
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.issue_id = i.id AND a.user_id = u.id)
      ORDER BY ue.embedding <=> i.embedding
      LIMIT $2`,
    [issueId, limit, minSimilarity],
  );
}

export interface SimilarIssueRow {
  id: number;
  title: string;
  difficulty: Difficulty;
  project_title: string;
  similarity: number;
}

/** Issue-to-issue vector search: other open issues closest to this one. */
export async function similarIssues(issueId: number, limit = 4, minSimilarity = 0.3): Promise<SimilarIssueRow[]> {
  return q<SimilarIssueRow>(
    `SELECT j.id, j.title, j.difficulty, p.title AS project_title, 1 - (j.embedding <=> i.embedding) AS similarity
       FROM issues i
       JOIN issues j   ON j.id <> i.id AND j.status = 'open' AND j.embedding IS NOT NULL
       JOIN projects p ON p.id = j.project_id
      WHERE i.id = $1 AND i.embedding IS NOT NULL
        AND 1 - (j.embedding <=> i.embedding) >= $3
      ORDER BY j.embedding <=> i.embedding
      LIMIT $2`,
    [issueId, limit, minSimilarity],
  );
}

// ----------------------------------------------------------------- maintainer dashboard
export interface ProjectSummary {
  id: number;
  title: string;
  repo_url: string;
  tech_stack: string | null;
  issue_count: number;
  open_count: number;
  pending_count: number;
}

export async function projectsOf(maintainerId: number): Promise<ProjectSummary[]> {
  return q<ProjectSummary>(
    `SELECT p.id, p.title, p.repo_url, p.tech_stack,
            COUNT(DISTINCT i.id)                                     AS issue_count,
            COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'open')    AS open_count,
            COUNT(a.id)          FILTER (WHERE a.status = 'pending') AS pending_count
       FROM projects p
       LEFT JOIN issues i       ON i.project_id = p.id
       LEFT JOIN applications a ON a.issue_id   = i.id
      WHERE p.maintainer_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC`,
    [maintainerId],
  );
}

export interface QueueRow {
  app_id: number;
  applied_at: Date;
  issue_id: number;
  issue_title: string;
  applicant: string;
  similarity: number | null;
  skills: string | null;
}

export async function reviewQueue(maintainerId: number, limit = 8): Promise<QueueRow[]> {
  return q<QueueRow>(
    `SELECT a.id AS app_id, a.applied_at, i.id AS issue_id, i.title AS issue_title, u.name AS applicant,
            1 - (ue.embedding <=> i.embedding) AS similarity, ${skillsOf('u.id')} AS skills
       FROM applications a
       JOIN issues i   ON i.id = a.issue_id
       JOIN projects p ON p.id = i.project_id
       JOIN users u    ON u.id = a.user_id
       LEFT JOIN user_embeddings ue ON ue.user_id = u.id
      WHERE p.maintainer_id = $1 AND a.status = 'pending'
      ORDER BY similarity DESC NULLS LAST, a.applied_at
      LIMIT $2`,
    [maintainerId, limit],
  );
}

export async function projectById(id: number) {
  return q1<{ id: number; maintainer_id: number; title: string; repo_url: string; tech_stack: string | null }>(
    'SELECT id, maintainer_id, title, repo_url, tech_stack FROM projects WHERE id = $1',
    [id],
  );
}

export interface ProjectIssueRow {
  id: number;
  title: string;
  difficulty: Difficulty;
  status: IssueStatus;
  created_at: Date;
  applicants: number;
  pending: number;
}

export async function issuesOfProject(projectId: number): Promise<ProjectIssueRow[]> {
  return q<ProjectIssueRow>(
    `SELECT i.id, i.title, i.difficulty, i.status, i.created_at,
            COUNT(a.id) AS applicants,
            COUNT(a.id) FILTER (WHERE a.status = 'pending') AS pending
       FROM issues i LEFT JOIN applications a ON a.issue_id = i.id
      WHERE i.project_id = $1
      GROUP BY i.id ORDER BY i.created_at DESC`,
    [projectId],
  );
}

export async function issueForEdit(id: number) {
  return q1<{
    id: number;
    project_id: number;
    title: string;
    description: string;
    difficulty: Difficulty;
    status: IssueStatus;
    maintainer_id: number;
    project_title: string;
    tech_stack: string | null;
  }>(
    `SELECT i.id, i.project_id, i.title, i.description, i.difficulty, i.status,
            p.maintainer_id, p.title AS project_title, p.tech_stack
       FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
    [id],
  );
}

// ------------------------------------------------------------ contributor applications
export interface MyApplicationRow {
  id: number;
  status: AppStatus;
  applied_at: Date;
  issue_id: number;
  title: string;
  difficulty: Difficulty;
  issue_status: IssueStatus;
  project_title: string;
  similarity: number | null;
}

export async function applicationsOf(userId: number): Promise<MyApplicationRow[]> {
  return q<MyApplicationRow>(
    `SELECT a.id, a.status, a.applied_at, i.id AS issue_id, i.title, i.difficulty,
            i.status AS issue_status, p.title AS project_title,
            CASE WHEN ue.embedding IS NULL OR i.embedding IS NULL THEN NULL
                 ELSE 1 - (ue.embedding <=> i.embedding) END AS similarity
       FROM applications a
       JOIN issues i   ON i.id = a.issue_id
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN user_embeddings ue ON ue.user_id = a.user_id
      WHERE a.user_id = $1
      ORDER BY a.applied_at DESC`,
    [userId],
  );
}

// ------------------------------------------------------------------------ notifications
export async function notificationsOf(userId: number) {
  return q<{ id: number; message: string; read_status: boolean; created_at: Date }>(
    'SELECT id, message, read_status, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100',
    [userId],
  );
}

// ---------------------------------------------------------------------------- profile
export async function profileOf(userId: number) {
  const user = await q1<{ id: number; name: string; email: string; role: string; bio: string | null; created_at: Date }>(
    'SELECT id, name, email, role, bio, created_at FROM users WHERE id = $1',
    [userId],
  );
  const skills = await q<{ name: string; level: Level }>(
    `SELECT s.name, COALESCE(us.proficiency,'intermediate') AS level
       FROM user_skills us JOIN skills s ON s.id = us.skill_id
      WHERE us.user_id = $1 ORDER BY s.name`,
    [userId],
  );
  return { user, skills };
}

export async function allSkillNames(): Promise<string[]> {
  return (await q<{ name: string }>('SELECT name FROM skills ORDER BY name')).map((r) => r.name);
}

export async function issueTitles(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await q<{ id: number; title: string }>('SELECT id, title FROM issues WHERE id = ANY($1::int[])', [ids]);
  return new Map(rows.map((r) => [r.id, r.title]));
}
