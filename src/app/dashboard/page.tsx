import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Meter, Tags } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { projectsOf, reviewQueue } from '@/lib/queries';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await requireUser();
  if (user.role === 'contributor') redirect('/feed');
  const [projects, queue] = await Promise.all([projectsOf(user.id), reviewQueue(user.id)]);
  const totals = {
    projects: projects.length,
    open: projects.reduce((n, p) => n + p.open_count, 0),
    pending: projects.reduce((n, p) => n + p.pending_count, 0),
  };

  return (
    <>
      <div className="row between" style={{ marginBottom: 14 }}>
        <h1>Maintainer dashboard</h1>
        <Link className="btn primary" href="/projects/new">
          + New project
        </Link>
      </div>

      <div className="grid cols-3">
        <div className="card stat">
          <div className="n">{totals.projects}</div>
          <div className="l">projects</div>
        </div>
        <div className="card stat">
          <div className="n">{totals.open}</div>
          <div className="l">open issues</div>
        </div>
        <div className="card stat">
          <div className="n">{totals.pending}</div>
          <div className="l">applications waiting</div>
        </div>
      </div>

      {queue.length > 0 && (
        <>
          <div className="section-title">
            <h2>Review queue</h2>
            <span className="muted small">pending applicants, best fit first</span>
          </div>
          {queue.map((r) => (
            <div className="card applicant" key={r.app_id}>
              <div>
                <h3 style={{ marginBottom: 4 }}>
                  {r.applicant}{' '}
                  <span className="muted small" style={{ fontFamily: 'var(--sans)', fontWeight: 400 }}>
                    applied to
                  </span>{' '}
                  <Link href={`/issues/${r.issue_id}`}>{r.issue_title}</Link>
                </h3>
                <div>
                  <Tags csv={r.skills} />
                </div>
              </div>
              <div className="actions">
                <Meter sim={r.similarity} />
                <Link className="btn small primary" href={`/issues/${r.issue_id}`}>
                  Review
                </Link>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="section-title">
        <h2>Your projects</h2>
      </div>
      {projects.length === 0 && (
        <div className="card empty">
          You haven&apos;t added a project yet. <Link href="/projects/new">Create your first one</Link>.
        </div>
      )}
      {projects.map((p) => (
        <div className="card" key={p.id}>
          <div className="row between">
            <div>
              <h3 style={{ marginBottom: 2 }}>
                <Link href={`/projects/${p.id}`}>{p.title}</Link>
              </h3>
              <div className="small muted">
                <span className="mono">{p.tech_stack || 'no stack listed'}</span> · {p.issue_count} issues · {p.open_count} open
                {p.pending_count > 0 && (
                  <>
                    {' '}
                    · <b style={{ color: 'var(--warn)' }}>{p.pending_count} pending</b>
                  </>
                )}
              </div>
            </div>
            <div className="row">
              <Link className="btn small" href={`/projects/${p.id}/issues/new`}>
                + Issue
              </Link>
              <Link className="btn small" href={`/projects/${p.id}`}>
                Manage
              </Link>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
