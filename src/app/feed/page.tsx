import type { Metadata } from 'next';
import Link from 'next/link';
import { IssueCard } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { one, type SP } from '@/lib/params';
import { feedFor, hasProfileVector } from '@/lib/queries';
import { DIFFICULTIES } from '@/lib/types';

export const metadata: Metadata = { title: 'My feed' };

export default async function FeedPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser('contributor');
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const diff = one(sp.difficulty);
  const [issues, hasProfile] = await Promise.all([feedFor(user.id, q, diff), hasProfileVector(user.id)]);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <h1>Your matches</h1>
        <Link className="btn small" href="/profile">
          Edit profile
        </Link>
      </div>
      <p className="muted">
        Open issues ranked by how closely they match your bio and skills (cosine similarity in pgvector).
      </p>

      {!hasProfile && (
        <div className="flash info">
          Add a bio or some skills in <Link href="/profile">your profile</Link> to get personalised rankings. Until then
          issues are shown newest first.
        </div>
      )}

      <form className="filters" method="get" action="/feed">
        <input type="text" name="q" defaultValue={q} placeholder="Filter by keyword (optional)" aria-label="Keyword filter" />
        <select name="difficulty" defaultValue={diff} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button className="btn">Apply filters</button>
      </form>

      {issues.length === 0 ? (
        <div className="card empty">No open issues match your filters.</div>
      ) : (
        issues.map((i) => <IssueCard key={i.id} issue={i} />)
      )}
    </>
  );
}
