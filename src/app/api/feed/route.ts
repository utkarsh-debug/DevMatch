import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { feedFor } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/feed — the logged-in contributor's issues ranked by pgvector cosine similarity. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'contributor') return NextResponse.json({ error: 'Contributors only' }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const issues = await feedFor(user.id, sp.get('q') ?? '', sp.get('difficulty') ?? '');
  return NextResponse.json({
    count: issues.length,
    issues: issues.map((i) => ({
      id: i.id,
      title: i.title,
      project: i.project_title,
      difficulty: i.difficulty,
      similarity: i.similarity === null ? null : Number(i.similarity.toFixed(4)),
      applicationStatus: i.my_status,
    })),
  });
}
