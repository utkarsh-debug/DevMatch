'use server';

import { q, tx } from '@/lib/db';
import { destroySession, requireUser } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { anonymiseAuthor, deleteThreads } from '@/lib/discussion';
import { redirectFlash } from '@/lib/flash';
import { parseSkills, refreshUserEmbedding, saveUserSkills } from '@/lib/writes';
import type { FormState } from '@/lib/types';
import { redirect } from 'next/navigation';

export async function saveProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const name = String(fd.get('name') ?? '').trim();
  const bio = String(fd.get('bio') ?? '').trim();
  const skills = parseSkills(fd);
  if (!name) return { error: 'Name is required.', values: { name, bio, skills } };

  await tx(async (c) => {
    await c.query('UPDATE users SET name = $1, bio = $2 WHERE id = $3', [name, bio || null, user.id]);
    await saveUserSkills(c, user.id, skills);
    if (user.role === 'contributor') await refreshUserEmbedding(c, user.id); // new vector -> new feed ranking
  });
  await logActivity({ ...user, name }, 'profile_updated', { meta: { skills: skills.length } });
  redirect('/profile?flash=' + encodeURIComponent('Profile saved. Your feed has been re-ranked.') + '&kind=success');
}

export async function deleteAccountAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  if (String(fd.get('confirm') ?? '').trim().toLowerCase() !== 'delete') {
    redirectFlash('/profile', 'Type "delete" to confirm account deletion.', 'error');
  }
  // maintainers own projects -> their issues disappear through ON DELETE CASCADE, so clear those threads too
  const issueIds = (
    await q<{ id: number }>(
      'SELECT i.id FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.maintainer_id = $1',
      [user.id],
    )
  ).map((r) => r.id);
  await q('DELETE FROM users WHERE id = $1', [user.id]);
  await deleteThreads(issueIds);
  await anonymiseAuthor(user.id);
  await logActivity(user, 'account_deleted');
  await destroySession();
  redirectFlash('/', 'Your account and all related data were deleted.', 'info');
}
