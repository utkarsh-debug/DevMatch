'use server';

import { redirect } from 'next/navigation';
import { q, q1, tx, pgCode, PG_UNIQUE } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { deleteThreads } from '@/lib/discussion';
import { flashUrl, redirectFlash } from '@/lib/flash';
import { projectById } from '@/lib/queries';
import { refreshIssueEmbedding } from '@/lib/writes';
import type { FormState } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function readProject(fd: FormData) {
  const v = { title: str(fd, 'title'), repo_url: str(fd, 'repo_url'), tech_stack: str(fd, 'tech_stack') };
  const error = !v.title || !v.repo_url ? 'Title and repository URL are required.' : undefined;
  return { v, error };
}

export async function createProjectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser('maintainer');
  const { v, error } = readProject(fd);
  if (error) return { error, values: v };
  let pid: number;
  try {
    const row = await q1<{ id: number }>(
      `INSERT INTO projects (maintainer_id, title, repo_url, tech_stack) VALUES ($1,$2,$3,$4) RETURNING id`,
      [user.id, v.title, v.repo_url, v.tech_stack || null],
    );
    pid = row!.id;
  } catch (e) {
    if (pgCode(e) === PG_UNIQUE) return { error: 'A project with that repository URL already exists.', values: v };
    throw e;
  }
  await logActivity(user, 'project_created', { projectId: pid, meta: { title: v.title } });
  redirect(flashUrl(`/projects/${pid}`, 'Project created. Now add the first issue.'));
}

export async function updateProjectAction(projectId: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser('maintainer');
  const project = await projectById(projectId);
  if (!project || project.maintainer_id !== user.id) redirectFlash('/dashboard', 'Project not found.', 'error');
  const { v, error } = readProject(fd);
  if (error) return { error, values: v };
  try {
    await tx(async (c) => {
      await c.query('UPDATE projects SET title=$1, repo_url=$2, tech_stack=$3 WHERE id=$4', [
        v.title,
        v.repo_url,
        v.tech_stack || null,
        projectId,
      ]);
      // the project's text is part of every issue's embedding -> keep the vectors in sync
      const issues = await c.query('SELECT id FROM issues WHERE project_id = $1', [projectId]);
      for (const r of issues.rows) await refreshIssueEmbedding(c, r.id);
    });
  } catch (e) {
    if (pgCode(e) === PG_UNIQUE) return { error: 'Another project already uses that repository URL.', values: v };
    throw e;
  }
  await logActivity(user, 'project_updated', { projectId });
  redirect(flashUrl(`/projects/${projectId}`, 'Project updated.'));
}

export async function deleteProjectAction(projectId: number): Promise<void> {
  const user = await requireUser('maintainer');
  const project = await projectById(projectId);
  if (!project || project.maintainer_id !== user.id) redirectFlash('/dashboard', 'Project not found.', 'error');
  const issueIds = (await q<{ id: number }>('SELECT id FROM issues WHERE project_id = $1', [projectId])).map((r) => r.id);
  await q('DELETE FROM projects WHERE id = $1', [projectId]); // ON DELETE CASCADE removes issues + applications
  await deleteThreads(issueIds); // ...and the Mongo threads that referenced those issues
  await logActivity(user, 'project_deleted', { meta: { title: project.title, issues: issueIds.length } });
  redirectFlash('/dashboard', 'Project deleted along with its issues and applications.');
}
