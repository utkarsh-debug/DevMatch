import type { Metadata } from 'next';
import Link from 'next/link';
import { Pill } from '@/components/ui';
import { activityTypes, recentActivity } from '@/lib/analytics';
import { requireUser } from '@/lib/auth';
import { searchComments, type SearchHit } from '@/lib/discussion';
import { ago } from '@/lib/format';
import type { ActivityDoc } from '@/lib/mongo';
import { one, type SP } from '@/lib/params';
import { issueTitles } from '@/lib/queries';

export const metadata: Metadata = { title: 'Activity' };

function describe(e: ActivityDoc, titles: Map<number, string>) {
  const issue = e.issueId ? (
    titles.has(e.issueId) ? (
      <Link href={`/issues/${e.issueId}`}>{titles.get(e.issueId)}</Link>
    ) : (
      <span className="muted">issue #{e.issueId} (deleted)</span>
    )
  ) : null;
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'register':
      return <>joined as a {e.actorRole}</>;
    case 'login':
      return <>logged in</>;
    case 'project_created':
      return <>created project “{String(meta.title ?? '')}”</>;
    case 'project_updated':
      return <>updated a project</>;
    case 'project_deleted':
      return <>deleted project “{String(meta.title ?? '')}”</>;
    case 'issue_created':
      return <>posted {issue}</>;
    case 'issue_updated':
      return <>edited {issue}</>;
    case 'issue_status':
      return (
        <>
          marked {issue} as {String(meta.status ?? '').replace('_', ' ')}
        </>
      );
    case 'issue_deleted':
      return <>deleted issue “{String(meta.title ?? '')}”</>;
    case 'applied':
      return <>applied to {issue}</>;
    case 'withdrew':
      return <>withdrew from {issue}</>;
    case 'accepted':
      return (
        <>
          accepted <b>{String(meta.applicant ?? '')}</b> for {issue}
        </>
      );
    case 'rejected':
      return (
        <>
          rejected <b>{String(meta.applicant ?? '')}</b> on {issue}
        </>
      );
    case 'comment':
      return <>commented on {issue}</>;
    case 'reply':
      return <>replied in a thread on {issue}</>;
    case 'comment_deleted':
      return <>deleted a comment on {issue}</>;
    case 'profile_updated':
      return <>updated their profile</>;
    case 'account_deleted':
      return <>deleted their account</>;
    default:
      return <>{e.type}</>;
  }
}

export default async function ActivityPage({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const sp = await searchParams;
  const type = one(sp.type);
  const search = one(sp.s).trim();

  let events: ActivityDoc[] | null = null;
  let types: string[] = [];
  let hits: SearchHit[] = [];
  let mongoDown = false;
  try {
    [events, types, hits] = await Promise.all([recentActivity(40, type || undefined), activityTypes(), searchComments(search)]);
  } catch {
    mongoDown = true;
  }

  const ids = [...(events ?? []).map((e) => e.issueId), ...hits.map((h) => h.issueId)].filter((x): x is number => !!x);
  const titles = await issueTitles([...new Set(ids)]);

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <h1>Activity</h1>
        <span className="tech-note">MongoDB · activity_log (TTL 90 days)</span>
      </div>
      <p className="muted">
        Every action in the app is appended to a MongoDB collection as a free-form event document. Different event types
        carry different fields, which is why this lives in a document store.
      </p>

      {mongoDown ? (
        <div className="card empty">MongoDB is not reachable, so the activity feed is unavailable. Everything else keeps working.</div>
      ) : (
        <>
          <form className="filters" method="get" action="/activity">
            <input type="text" name="s" defaultValue={search} placeholder="Search discussions (MongoDB text index)…" aria-label="Search discussions" />
            <select name="type" defaultValue={type} aria-label="Event type">
              <option value="">All events</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button className="btn">Apply</button>
          </form>

          {search && (
            <div className="card">
              <h3>Discussion search: “{search}”</h3>
              {hits.length === 0 ? (
                <p className="muted small">No comments match.</p>
              ) : (
                hits.map((h) => (
                  <div className="comment" key={h.commentId}>
                    <div className="head">
                      <b>{h.authorName}</b>
                      <span className="muted small">
                        on{' '}
                        {titles.has(h.issueId) ? <Link href={`/issues/${h.issueId}#discussion`}>{titles.get(h.issueId)}</Link> : `issue #${h.issueId}`}
                      </span>
                      <span className="tech-note">text score {h.score.toFixed(2)}</span>
                    </div>
                    <div className="body">{h.body}</div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="card">
            {events!.length === 0 && <p className="muted">No events yet.</p>}
            {events!.map((e) => (
              <div className="event" key={String(e._id)}>
                <span className="type">{e.type}</span>
                <span>
                  <b>{e.actorName}</b> <Pill value={e.actorRole} /> {describe(e, titles)}
                </span>
                <span className="when">{ago(e.ts)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
