/**
 * Analytical SQL shown on the "DB insights" page (joins, GROUP BY, HAVING, window-free aggregates, pgvector).
 * Kept in one place so the page, the report and db/queries.sql stay identical.
 */
import { q } from '@/lib/db';

export interface SqlInsight {
  title: string;
  concept: string;
  sql: string;
}

export const SQL_INSIGHTS: SqlInsight[] = [
  {
    title: 'Rows per table',
    concept: 'UNION ALL',
    sql: `SELECT 'users' AS "table", COUNT(*) AS rows FROM users
UNION ALL SELECT 'skills', COUNT(*) FROM skills
UNION ALL SELECT 'user_skills', COUNT(*) FROM user_skills
UNION ALL SELECT 'projects', COUNT(*) FROM projects
UNION ALL SELECT 'issues', COUNT(*) FROM issues
UNION ALL SELECT 'user_embeddings', COUNT(*) FROM user_embeddings
UNION ALL SELECT 'applications', COUNT(*) FROM applications
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications`,
  },
  {
    title: 'Most common skills',
    concept: 'JOIN + GROUP BY + FILTER',
    sql: `SELECT s.name AS skill, COUNT(*) AS contributors,
       COUNT(*) FILTER (WHERE us.proficiency = 'advanced') AS advanced
  FROM user_skills us JOIN skills s ON s.id = us.skill_id
 GROUP BY s.name ORDER BY contributors DESC, s.name LIMIT 8`,
  },
  {
    title: 'Issues by status and difficulty',
    concept: 'GROUP BY on two columns',
    sql: `SELECT status, difficulty, COUNT(*) AS issues
  FROM issues GROUP BY status, difficulty ORDER BY status, difficulty`,
  },
  {
    title: 'Application funnel',
    concept: 'GROUP BY',
    sql: `SELECT status, COUNT(*) AS applications
  FROM applications GROUP BY status ORDER BY applications DESC`,
  },
  {
    title: 'Most-contested open issues',
    concept: 'HAVING',
    sql: `SELECT i.title, COUNT(a.id) AS applicants
  FROM issues i JOIN applications a ON a.issue_id = i.id
 WHERE i.status = 'open'
 GROUP BY i.id HAVING COUNT(a.id) >= 1
 ORDER BY applicants DESC, i.title LIMIT 5`,
  },
  {
    title: 'Maintainers ranked by project activity',
    concept: 'multi-table LEFT JOIN + COUNT(DISTINCT)',
    sql: `SELECT u.name AS maintainer, COUNT(DISTINCT p.id) AS projects,
       COUNT(DISTINCT i.id) AS issues, COUNT(a.id) AS applications_received
  FROM users u
  JOIN projects p ON p.maintainer_id = u.id
  LEFT JOIN issues i ON i.project_id = p.id
  LEFT JOIN applications a ON a.issue_id = i.id
 GROUP BY u.id ORDER BY issues DESC, maintainer`,
  },
  {
    title: 'Contributors who applied to more than the average number of issues',
    concept: 'subquery in HAVING',
    sql: `SELECT u.name, COUNT(*) AS applications
  FROM applications a JOIN users u ON u.id = a.user_id
 GROUP BY u.id
HAVING COUNT(*) > (SELECT AVG(c) FROM (SELECT COUNT(*) AS c FROM applications GROUP BY user_id) t)
 ORDER BY applications DESC, u.name`,
  },
];

export const VECTOR_INSIGHTS: SqlInsight[] = [
  {
    title: 'Best semantic pairs: contributor ↔ open issue',
    concept: 'pgvector cosine distance (<=>) with a cross join',
    sql: `SELECT u.name AS contributor, i.title AS issue,
       ROUND((1 - (ue.embedding <=> i.embedding))::numeric, 3) AS cosine_similarity
  FROM user_embeddings ue
  JOIN users u  ON u.id = ue.user_id
  JOIN issues i ON i.status = 'open'
 ORDER BY ue.embedding <=> i.embedding LIMIT 5`,
  },
  {
    title: 'Three distance operators on the same vectors',
    concept: '<=> cosine, <-> Euclidean (L2), <#> negative inner product',
    sql: `WITH me AS (
  SELECT ue.embedding, u.name FROM user_embeddings ue JOIN users u ON u.id = ue.user_id
   ORDER BY ue.user_id LIMIT 1
)
SELECT me.name AS contributor, i.title AS issue,
       ROUND((i.embedding <=> me.embedding)::numeric, 4)        AS cosine_distance,
       ROUND((i.embedding <-> me.embedding)::numeric, 4)        AS l2_distance,
       ROUND(((i.embedding <#> me.embedding) * -1)::numeric, 4) AS inner_product
  FROM issues i, me
 WHERE i.status = 'open'
 ORDER BY i.embedding <=> me.embedding LIMIT 4`,
  },
  {
    title: 'Issues that have no good contributor yet',
    concept: 'nearest-neighbour inside a correlated subquery',
    sql: `SELECT i.title,
       ROUND((1 - (SELECT MIN(ue.embedding <=> i.embedding) FROM user_embeddings ue))::numeric, 3) AS best_similarity
  FROM issues i
 WHERE i.status = 'open'
 ORDER BY best_similarity ASC LIMIT 4`,
  },
];

export interface SqlResult extends SqlInsight {
  cols: string[];
  rows: Record<string, unknown>[];
}

export async function run(list: SqlInsight[]): Promise<SqlResult[]> {
  const out: SqlResult[] = [];
  for (const item of list) {
    const rows = await q(item.sql);
    out.push({ ...item, cols: rows[0] ? Object.keys(rows[0]) : [], rows });
  }
  return out;
}
