import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { browseOpenIssues } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/issues?q=react&difficulty=easy&limit=20 — open issues (reads the open_issues_view view). */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 50) || 50, 1), 100);
  const issues = await browseOpenIssues(sp.get('q') ?? '', sp.get('difficulty') ?? '', limit);
  return NextResponse.json({ count: issues.length, issues });
}
