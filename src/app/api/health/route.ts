import { NextResponse } from 'next/server';
import { q1 } from '@/lib/db';
import { getDb } from '@/lib/mongo';
import { backendName } from '@/lib/embedder';

export const dynamic = 'force-dynamic';

/** GET /api/health — is every database behind the app reachable? */
export async function GET() {
  const out: Record<string, unknown> = {};
  try {
    const r = await q1<{ pg: string; vec: string | null }>(
      "SELECT version() AS pg, (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS vec",
    );
    out.postgres = { ok: true, version: r?.pg.split(' ').slice(0, 2).join(' ') };
    out.pgvector = { ok: !!r?.vec, version: r?.vec };
  } catch (e) {
    out.postgres = { ok: false, error: (e as Error).message };
  }
  try {
    const db = await getDb();
    const info = await db.admin().serverInfo();
    out.mongodb = { ok: true, version: info.version, collections: (await db.listCollections().toArray()).map((c) => c.name) };
  } catch (e) {
    out.mongodb = { ok: false, error: (e as Error).message };
  }
  out.embedder = await backendName();
  const ok = Object.values(out).every((v) => typeof v !== 'object' || (v as { ok?: boolean }).ok !== false);
  return NextResponse.json({ ok, ...out }, { status: ok ? 200 : 503 });
}
