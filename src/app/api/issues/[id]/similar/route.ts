import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { similarIssues } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/issues/:id/similar — nearest open issues in vector space (issue <-> issue). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  const similar = await similarIssues(id, 5, 0);
  return NextResponse.json({ issueId: id, similar });
}
