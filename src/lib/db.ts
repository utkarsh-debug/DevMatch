/**
 * PostgreSQL access layer (node-postgres connection pool).
 * Holds the relational data and the pgvector embeddings.
 */
import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// COUNT(*) returns bigint -> parse as JS number
types.setTypeParser(20, (v) => parseInt(v, 10));
// TIMESTAMP (without tz) -> we always store UTC (see SET TIME ZONE below)
types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z'));

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/devmatch',
    max: 10,
    // Session settings sent in the connection handshake:
    //  - timezone=UTC            : TIMESTAMP columns are always read/written as UTC
    //  - ivfflat.probes=100      : ivfflat is approximate; probing every list makes results exact on small demo data
    options: '-c timezone=UTC -c ivfflat.probes=100',
  });
  p.on('error', (err) => console.error('[pg] idle client error', err.message));
  return p;
}

// Re-use one pool across hot reloads in development
export const pool: Pool = globalThis.__pgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalThis.__pgPool = pool;

/** Run a query, return all rows. */
export async function q<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query<T>(text, params as any[]);
  return res.rows;
}

/** Run a query, return the first row or null. */
export async function q1<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

/** Transaction scope: COMMIT on success, ROLLBACK on any exception. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Postgres error helpers */
export const PG_UNIQUE = '23505';
export const PG_FK = '23503';
export const PG_RAISE = 'P0001'; // RAISE EXCEPTION from our triggers / functions

export function pgCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
}

/** User-facing message for a database error (our RAISE EXCEPTION text is already readable). */
export function pgMessage(e: unknown): string {
  if (pgCode(e) === PG_RAISE) return (e as Error).message;
  return 'Something went wrong while saving. Please try again.';
}
