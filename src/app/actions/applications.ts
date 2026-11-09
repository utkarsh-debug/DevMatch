'use server';

import { q, q1, tx, pgCode, pgMessage, PG_FK, PG_UNIQUE } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { redirectFlash, type FlashKind } from '@/lib/flash';

// ---------------------------------------------------------------- contributor
export async function applyAction(issueId: number): Promise<void> {
  const user = await requireUser('contributor');
  let message = 'Application sent. The maintainer has been notified.';
  let kind: FlashKind = 'success';
  try {
    // BEFORE INSERT trigger: only active contributors, only open issues.
    // AFTER INSERT trigger: notifies the maintainer.
    await q('INSERT INTO applications (issue_id, user_id) VALUES ($1, $2)', [issueId, user.id]);
  } catch (e) {
    kind = 'error';
    if (pgCode(e) === PG_UNIQUE) {
      message = 'You have already applied to this issue.';
      kind = 'info';
    } else if (pgCode(e) === PG_FK) redirectFlash('/issues', 'That issue no longer exists.', 'error');
    else message = pgMessage(e);
  }
  if (kind === 'success') await logActivity(user, 'applied', { issueId });
  redirectFlash(`/issues/${issueId}`, message, kind);
}

export async function withdrawAction(appId: number): Promise<void> {
  const user = await requireUser('contributor');
  const res = await q1<{ issue_id: number }>(
    `DELETE FROM applications WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING issue_id`,
    [appId, user.id],
  );
  if (res) await logActivity(user, 'withdrew', { issueId: res.issue_id });
  redirectFlash(
    '/applications',
    res ? 'Application withdrawn.' : 'Only pending applications can be withdrawn.',
    res ? 'success' : 'error',
  );
}

// ----------------------------------------------------------------- maintainer
async function applicationInfo(appId: number) {
  return q1<{ issue_id: number; user_id: number; applicant: string; title: string }>(
    `SELECT a.issue_id, a.user_id, u.name AS applicant, i.title
       FROM applications a JOIN users u ON u.id = a.user_id JOIN issues i ON i.id = a.issue_id
      WHERE a.id = $1`,
    [appId],
  );
}

export async function acceptAction(appId: number): Promise<void> {
  const user = await requireUser('maintainer');
  const info = await applicationInfo(appId);
  if (!info) redirectFlash('/dashboard', 'Application not found.', 'error');
  try {
    // One stored function = one atomic unit of work (row lock, 2 status updates, N notifications)
    await tx((c) => c.query('SELECT accept_application($1, $2)', [appId, user.id]));
  } catch (e) {
    redirectFlash(`/issues/${info.issue_id}`, pgMessage(e), 'error');
  }
  await logActivity(user, 'accepted', {
    issueId: info.issue_id,
    meta: { applicantId: info.user_id, applicant: info.applicant },
  });
  redirectFlash(
    `/issues/${info.issue_id}`,
    'Contributor accepted. The issue is closed and everyone else was notified.',
  );
}

export async function rejectAction(appId: number): Promise<void> {
  const user = await requireUser('maintainer');
  const info = await applicationInfo(appId);
  if (!info) redirectFlash('/dashboard', 'Application not found.', 'error');
  try {
    await tx((c) => c.query('SELECT reject_application($1, $2)', [appId, user.id]));
  } catch (e) {
    redirectFlash(`/issues/${info.issue_id}`, pgMessage(e), 'error');
  }
  await logActivity(user, 'rejected', {
    issueId: info.issue_id,
    meta: { applicantId: info.user_id, applicant: info.applicant },
  });
  redirectFlash(`/issues/${info.issue_id}`, 'Applicant rejected and notified.');
}
