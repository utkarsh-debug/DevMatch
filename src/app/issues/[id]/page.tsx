import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { acceptAction, applyAction, rejectAction, withdrawAction } from '@/app/actions/applications';
import { deleteIssueAction, setIssueStatusAction } from '@/app/actions/issues';
import { ConfirmForm } from '@/components/ConfirmForm';
import { SubmitButton } from '@/components/SubmitButton';
import { Thread } from '@/components/Thread';
import { Meter, Pill, Tags } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { threadFor } from '@/lib/discussion';
import { ago, label } from '@/lib/format';
import { numId } from '@/lib/params';
import {
  applicantsFor,
  issueDetail,
  myApplication,
  similarIssues,
  suggestedContributors,
  userIssueSimilarity,
} from '@/lib/queries';
import { STATUSES } from '@/lib/types';

export const metadata: Metadata = { title: 'Issue' };

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = numId((await params).id);
  if (!id) notFound();
  const issue = await issueDetail(id);
  if (!issue) notFound();

  const isOwner = user.role === 'maintainer' && issue.maintainer_id === user.id;
  const isContributor = user.role === 'contributor';

  const [myApp, similarity, applicants, suggested, similar, thread] = await Promise.all([
    isContributor ? myApplication(id, user.id) : null,
    isContributor ? userIssueSimilarity(user.id, id) : null,
    isOwner ? applicantsFor(id) : null,
    isOwner && issue.status !== 'closed' ? suggestedContributors(id) : null,
    similarIssues(id), // pgvector: issue <-> issue
    threadFor(id).catch(() => null), // MongoDB; the page still works if it is down
  ]);

  return (
    <>
      <p className="small muted">
        <Link href={isOwner ? `/projects/${issue.project_id}` : isContributor ? '/feed' : '/issues'}>&larr; Back</Link>
      </p>

      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ fontSize: '1.7rem' }}>{issue.title}</h1>
            <div className="row small muted" style={{ gap: 10 }}>
              <span>{issue.project_title}</span>
              <span>· maintained by {issue.maintainer}</span>
              <Pill value={issue.difficulty} /> <Pill value={issue.status} />
              <span>· posted {ago(issue.created_at)}</span>
            </div>
          </div>
          {isContributor && (
            <div>
              <Meter sim={similarity} />
            </div>
          )}
        </div>
        <p style={{ marginTop: 18, whiteSpace: 'pre-line' }}>{issue.description}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Repository:{' '}
          <a href={issue.repo_url} rel="noopener noreferrer" target="_blank">
            {issue.repo_url}
          </a>
          {issue.tech_stack && (
            <>
              {' '}
              · Stack: <span className="mono">{issue.tech_stack}</span>
            </>
          )}
        </p>
      </div>

      {/* ---------------- contributor actions ---------------- */}
      {isContributor && (
        <div className="card">
          {myApp ? (
            <div className="row between">
              <div>
                Your application: <Pill value={myApp.status} />{' '}
                <span className="muted small">sent {ago(myApp.applied_at)}</span>
              </div>
              {myApp.status === 'pending' && (
                <ConfirmForm action={withdrawAction.bind(null, myApp.id)} message="Withdraw your application?">
                  <button className="btn small danger">Withdraw</button>
                </ConfirmForm>
              )}
            </div>
          ) : issue.status === 'open' ? (
            <div className="row between">
              <div>
                <b>Interested?</b> <span className="muted">The maintainer is notified immediately.</span>
              </div>
              <form action={applyAction.bind(null, id)}>
                <SubmitButton>Apply to this issue</SubmitButton>
              </form>
            </div>
          ) : (
            <div className="muted">This issue is {label(issue.status)} and no longer accepts applications.</div>
          )}
        </div>
      )}

      {/* ---------------- maintainer (owner) tools ---------------- */}
      {isOwner && (
        <>
          <div className="card">
            <div className="row between">
              <div className="row">
                <Link className="btn small" href={`/issues/${id}/edit`}>
                  Edit issue
                </Link>
                <form action={setIssueStatusAction.bind(null, id)} className="row">
                  <select name="status" defaultValue={issue.status} style={{ width: 'auto' }} aria-label="Status">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                  <button className="btn small">Set status</button>
                </form>
              </div>
              <ConfirmForm action={deleteIssueAction.bind(null, id)} message="Delete this issue and all its applications?">
                <button className="btn small danger">Delete issue</button>
              </ConfirmForm>
            </div>
          </div>

          <div className="section-title">
            <h2>Applicants ({applicants?.length ?? 0})</h2>
            <span className="muted small">best semantic fit first</span>
          </div>
          {applicants?.length ? (
            applicants.map((a) => (
              <div className="card applicant" key={a.id}>
                <div>
                  <h3 style={{ marginBottom: 4 }}>
                    {a.name} <Pill value={a.status} />
                  </h3>
                  <div>
                    <Tags csv={a.skills} />
                  </div>
                  {a.bio && (
                    <p className="muted small" style={{ margin: '6px 0 0' }}>
                      {a.bio}
                    </p>
                  )}
                </div>
                <div className="actions">
                  <Meter sim={a.similarity} />
                  {a.status === 'pending' && issue.status !== 'closed' && (
                    <>
                      <ConfirmForm
                        action={acceptAction.bind(null, a.id)}
                        message={`Accept ${a.name}? This closes the issue and notifies every other applicant.`}
                      >
                        <button className="btn small primary">Accept</button>
                      </ConfirmForm>
                      <form action={rejectAction.bind(null, a.id)} style={{ display: 'inline' }}>
                        <button className="btn small">Reject</button>
                      </form>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="card empty">No applications yet.</div>
          )}

          {suggested && suggested.length > 0 && (
            <>
              <div className="section-title">
                <h2>Suggested contributors</h2>
                <span className="muted small">closest profiles who haven&apos;t applied</span>
              </div>
              {suggested.map((s) => (
                <div className="card applicant" key={s.id}>
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{s.name}</h3>
                    <div>
                      <Tags csv={s.skills} />
                    </div>
                    {s.bio && (
                      <p className="muted small" style={{ margin: '6px 0 0' }}>
                        {s.bio}
                      </p>
                    )}
                  </div>
                  <div className="actions">
                    <Meter sim={s.similarity} />
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ---------------- similar issues (pgvector) ---------------- */}
      {similar.length > 0 && (
        <>
          <div className="section-title">
            <h2>Similar issues</h2>
            <span className="muted small">nearest neighbours in vector space</span>
          </div>
          <div className="card table-wrap">
            <table>
              <tbody>
                {similar.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/issues/${s.id}`}>{s.title}</Link>
                      <div className="muted small">{s.project_title}</div>
                    </td>
                    <td>
                      <Pill value={s.difficulty} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Meter sim={s.similarity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ---------------- discussion (MongoDB) ---------------- */}
      <div style={{ marginTop: 28 }}>
        <Thread issueId={id} thread={thread} user={user} isOwner={isOwner} />
      </div>
    </>
  );
}
