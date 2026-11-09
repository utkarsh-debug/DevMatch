/**
 * Shared write helpers that keep PostgreSQL rows and their vector embeddings in sync.
 * Every function takes the transaction's client so callers decide the transaction boundary.
 */
import type { PoolClient } from 'pg';
import { embed, toPgVector } from '@/lib/embedder';
import { LEVELS, type Level, type SkillRow } from '@/lib/types';

export function normaliseSkill(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 50);
}

/** Read the repeated skill_name / skill_level fields from a submitted form. */
export function parseSkills(fd: FormData): SkillRow[] {
  const names = fd.getAll('skill_name').map(String);
  const levels = fd.getAll('skill_level').map(String);
  const seen = new Set<string>();
  const out: SkillRow[] = [];
  names.forEach((raw, i) => {
    const name = normaliseSkill(raw);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const lv = levels[i] as Level;
    out.push({ name, level: LEVELS.includes(lv) ? lv : 'intermediate' });
  });
  return out;
}

export async function saveUserSkills(c: PoolClient, userId: number, skills: SkillRow[]): Promise<void> {
  await c.query('DELETE FROM user_skills WHERE user_id = $1', [userId]);
  for (const s of skills) {
    await c.query('INSERT INTO skills (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [s.name]);
    await c.query(
      `INSERT INTO user_skills (user_id, skill_id, proficiency)
       SELECT $1, id, $2 FROM skills WHERE name = $3`,
      [userId, s.level, s.name],
    );
  }
}

/** Embed bio + skills of a contributor and upsert the vector into user_embeddings. */
export async function refreshUserEmbedding(c: PoolClient, userId: number): Promise<void> {
  const bio = (await c.query('SELECT bio FROM users WHERE id = $1', [userId])).rows[0]?.bio ?? '';
  const skills = (
    await c.query(
      `SELECT s.name, COALESCE(us.proficiency,'intermediate') AS lvl
         FROM user_skills us JOIN skills s ON s.id = us.skill_id
        WHERE us.user_id = $1 ORDER BY s.name`,
      [userId],
    )
  ).rows;
  if (!bio && skills.length === 0) {
    await c.query('DELETE FROM user_embeddings WHERE user_id = $1', [userId]);
    return;
  }
  const skillText = skills.map((r) => `${r.name} (${r.lvl})`).join(', ');
  const vec = toPgVector(await embed(`${bio}\nSkills: ${skillText}`.trim()));
  await c.query(
    `INSERT INTO user_embeddings (user_id, embedding, updated_at)
     VALUES ($1, $2::vector, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE
        SET embedding = EXCLUDED.embedding, updated_at = CURRENT_TIMESTAMP`,
    [userId, vec],
  );
}

export function issueText(title: string, description: string, projectTitle: string, techStack: string | null): string {
  return `${title}. ${description}\nProject: ${projectTitle}. Tech stack: ${techStack ?? ''}`;
}

/** Re-embed an existing issue (after its text — or its project's tech stack — changed). */
export async function refreshIssueEmbedding(c: PoolClient, issueId: number): Promise<void> {
  const r = (
    await c.query(
      `SELECT i.title, i.description, p.title AS ptitle, p.tech_stack
         FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = $1`,
      [issueId],
    )
  ).rows[0];
  if (!r) return;
  const vec = toPgVector(await embed(issueText(r.title, r.description, r.ptitle, r.tech_stack)));
  await c.query('UPDATE issues SET embedding = $1::vector WHERE id = $2', [vec, issueId]);
}
