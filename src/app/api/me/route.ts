import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { unreadCount } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** Current user + unread notification count (used by the header after client-side navigation). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null, unread: 0 });
  return NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role },
    unread: await unreadCount(user.id),
  });
}
