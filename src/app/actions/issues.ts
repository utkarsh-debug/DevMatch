'use server';

import { redirect } from 'next/navigation';
import { q, q1, tx } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { deleteThreads } from '@/lib/discussion';
import { embed, toPgVector } from '@/lib/embedder';
import { flashUrl, redirectFlash } from '@/lib/flash';
import { issueForEdit, projectById } from '@/lib/queries';
import { issueText, refreshIssueEmbedding } from '@/lib/writes';
import { DIFFICULTIES, STATUSES, type Difficulty, type FormState, type IssueStatus } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function readIssue(fd: FormData) {
  const v = { title: str(fd, 'title'), description: str(fd, 'description'), difficulty: str(fd, 'difficulty') };
  const errs: string[] = [];
  if (!v.title) errs.push('Title is required.');
  if (v.title.length > 200) errs.push('Title must be 200 characters or fewer.');
  if (v.description.length < 20)
    errs.push('Describe the issue in at least 20 characters — the description is what gets matched.');
  if (!DIFFICULTIES.includes(v.difficulty as Difficulty)) errs.push('Choose a difficulty.');
  return { v, error: errs.length ? errs.join(' ') : undefined };
}

export async function createIssueAction(projectId: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser('maintainer');
  const project = await projectById(projectId);
  if (!project || project.maintainer_id !== user.id) redirectFlash('/dashboard', 'Project not found.', 'error');
  const { v, error } = readIssue(fd);
  if (error) return { error, values: v };

  const vec = toPgVector(await embed(issueText(v.title, v.description, project.title, project.tech_stack)));
  const row = await q1<{ id: number }>(
    `INSERT INTO issues (project_id, title, description, difficulty, embedding)
     VALUES ($1,$2,$3,$4,$5::vector) RETURNING id`,
    [projectId, v.title, v.description, v.difficulty, vec],
  );
  await logActivity(user, 'issue_created', { issueId: row!.id, projectId, meta: { difficulty: v.difficulty } });
  redirect(flashUrl(`/issues/${row!.id}`, 'Issue posted. Matching contributors will see it in their feeds.'));
}

export async function updateIssueAction(issueId: number, _prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser('maintainer');
  const issue = await issueForEdit(issueId);
  if (!issue || issue.maintainer_id !== user.id) redirectFlash('/dashboard', 'Issue not found.', 'error');
  const { v, error } = readIssue(fd);
  if (error) return { error, values: v };
  await tx(async (c) => {
    await c.query('UPDATE issues SET title=$1, description=$2, difficulty=$3 WHERE id=$4', [
      v.title,
      v.description,
      v.difficulty,
      issueId,
    ]);
    await refreshIssueEmbedding(c, issueId); // new text -> new vector -> new matches
  });
  await logActivity(user, 'issue_updated', { issueId, projectId: issue.project_id });
  redirect(flashUrl(`/issues/${issueId}`, 'Issue updated and re-matched.'));
}

export async function setIssueStatusAction(issueId: number, fd: FormData): Promise<void> {
  const user = await requireUser('maintainer');
  const issue = await issueForEdit(issueId);
  if (!issue || issue.maintainer_id !== user.id) redirectFlash('/dashboard', 'Issue not found.', 'error');
  const status = str(fd, 'status') as IssueStatus;
  if (!STATUSES.includes(status)) redirectFlash(`/issues/${issueId}`, 'Unknown status.', 'error');
  await q('UPDATE issues SET status = $1 WHERE id = $2', [status, issueId]);
  await logActivity(user, 'issue_status', { issueId, projectId: issue.project_id, meta: { status } });
  redirectFlash(`/issues/${issueId}`, `Issue marked ${status.replace('_', ' ')}.`);
}

export async function deleteIssueAction(issueId: number): Promise<void> {
  const user = await requireUser('maintainer');
  const issue = await issueForEdit(issueId);
  if (!issue || issue.maintainer_id !== user.id) redirectFlash('/dashboard', 'Issue not found.', 'error');
  await q('DELETE FROM issues WHERE id = $1', [issueId]);
  await deleteThreads([issueId]);
  await logActivity(user, 'issue_deleted', { projectId: issue.project_id, meta: { title: issue.title } });
  redirectFlash(`/projects/${issue.project_id}`, 'Issue deleted.');
}
