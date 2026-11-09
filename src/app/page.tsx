import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { flashUrl, type FlashKind } from '@/lib/flash';
import { one, type SP } from '@/lib/params';
import { landingStats } from '@/lib/queries';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const user = await getSessionUser();
  if (user) {
    const dest = user.role === 'maintainer' ? '/dashboard' : '/feed';
    const msg = one(sp.flash);
    redirect(msg ? flashUrl(dest, msg, (one(sp.kind) || 'info') as FlashKind) : dest);
  }
  const stats = await landingStats();
  return (
    <>
      <section className="hero">
        <h1>Open-source issues that fit the way you code.</h1>
        <p className="lead">
          Keyword tags are inconsistent and applicants rarely fit. DevMatch embeds contributor profiles and issue
          descriptions into the same vector space, so you see work ranked by what you actually know, and maintainers see
          the best-fit candidates first.
        </p>
        <div className="row">
          <Link className="btn primary" href="/register">
            Create an account
          </Link>
          <Link className="btn" href="/login">
            Log in
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>
          {stats?.open_issues} open issues · {stats?.contributors} contributors · {stats?.projects} projects
        </p>
      </section>

      <section className="explain">
        <div className="card">
          <b>1. Describe yourself</b>Write a short bio and list your skills. They are embedded as a 384-dimension vector
          with pgvector.
        </div>
        <div className="card">
          <b>2. Get a ranked feed</b>Every open issue is scored by cosine similarity to your vector, not by exact tag
          overlap.
        </div>
        <div className="card">
          <b>3. Apply, discuss, get chosen</b>Ask questions in a MongoDB-backed thread. Accepting a candidate closes the
          issue and notifies everyone else in a single PostgreSQL transaction.
        </div>
      </section>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Demo accounts</b>{' '}
        <span className="muted small">
          (password <span className="mono">password123</span>, if you loaded the seed data)
        </span>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Maintainer: <span className="mono">asha@devmatch.dev</span> · Contributors: <span className="mono">vijay@devmatch.dev</span>,{' '}
          <span className="mono">neha@devmatch.dev</span>, <span className="mono">ishaan@devmatch.dev</span>
        </p>
      </div>
    </>
  );
}
