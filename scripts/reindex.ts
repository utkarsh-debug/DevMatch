/**
 * Recompute every stored embedding (contributors + issues) with the current backend, then rebuild the
 * vector indexes. Run after switching EMBEDDER (hash <-> minilm).
 *
 *   npm run db:reindex
 */
import './env';
import { pool, tx } from '@/lib/db';
import { backendName } from '@/lib/embedder';
import { refreshIssueEmbedding, refreshUserEmbedding } from '@/lib/writes';

async function main() {
  console.log('Embedding backend:', await backendName());
  const { users, issues } = await tx(async (c) => {
    const u = (await c.query("SELECT id FROM users WHERE role = 'contributor'")).rows;
    for (const r of u) await refreshUserEmbedding(c, r.id);
    const i = (await c.query('SELECT id FROM issues')).rows;
    for (const r of i) await refreshIssueEmbedding(c, r.id);
    return { users: u.length, issues: i.length };
  });
  await pool.query('REINDEX INDEX idx_issues_embedding');
  await pool.query('REINDEX INDEX idx_user_embeddings');
  console.log(`Re-embedded ${users} contributors and ${issues} issues; vector indexes rebuilt.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
