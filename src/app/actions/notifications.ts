'use server';

import { redirect } from 'next/navigation';
import { q } from '@/lib/db';
import { requireUser } from '@/lib/auth';

export async function markReadAction(id: number): Promise<void> {
  const user = await requireUser();
  await q('UPDATE notifications SET read_status = TRUE WHERE id = $1 AND user_id = $2', [id, user.id]);
  redirect('/notifications');
}

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await q('UPDATE notifications SET read_status = TRUE WHERE user_id = $1', [user.id]);
  redirect('/notifications');
}

export async function deleteNotificationAction(id: number): Promise<void> {
  const user = await requireUser();
  await q('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, user.id]);
  redirect('/notifications');
}
