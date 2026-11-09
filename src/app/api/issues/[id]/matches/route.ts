import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { issueDetail, suggestedContributors } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/issues/:id/matches — best-fit contributors for an issue (owner only). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const issue = await issueDetail(id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (issue.maintainer_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const matches = await suggestedContributors(id, 10, 0);
  return NextResponse.json({ issueId: id, matches });
}
