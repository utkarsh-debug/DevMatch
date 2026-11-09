/**
 * Activity log (MongoDB). Best effort: a Mongo outage must never break the relational workflow,
 * so failures are logged and swallowed.
 */
import { activityLog, type ActivityDoc } from '@/lib/mongo';
import type { User } from '@/lib/types';

export async function logActivity(
  actor: Pick<User, 'id' | 'name' | 'role'>,
  type: string,
  extra: { issueId?: number; projectId?: number; meta?: Record<string, unknown>; ts?: Date } = {},
): Promise<void> {
  try {
    const doc: ActivityDoc = {
      ts: extra.ts ?? new Date(),
      type,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
    };
    if (extra.issueId !== undefined) doc.issueId = extra.issueId;
    if (extra.projectId !== undefined) doc.projectId = extra.projectId;
    if (extra.meta) doc.meta = extra.meta;
    await (await activityLog()).insertOne(doc);
  } catch (e) {
    console.error('[activity] could not write event', type, (e as Error).message);
  }
}
