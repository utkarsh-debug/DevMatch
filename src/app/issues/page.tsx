import type { Metadata } from 'next';
import Link from 'next/link';
import { Pill } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { ago } from '@/lib/format';
import { one, type SP } from '@/lib/params';
import { browseOpenIssues } from '@/lib/queries';
import { DIFFICULTIES } from '@/lib/types';

export const metadata: Metadata = { title: 'All open issues' };

export default async function IssuesPage({ searchParams }: { searchParams: SP }) {
  await requireUser();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const diff = one(sp.difficulty);
  const issues = await browseOpenIssues(q, diff);

  return (
    <>
      <h1>All open issues</h1>
      <p className="muted">
        Read straight from the <span className="mono">open_issues_view</span> database view. JSON version:{' '}
        <a className="mono" href="/api/issues">
          /api/issues
        </a>
      </p>

      <form className="filters" method="get" action="/issues">
        <input type="text" name="q" defaultValue={q} placeholder="Search title, description or project" aria-label="Search" />
        <select name="difficulty" defaultValue={diff} aria-label="Difficulty">
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button className="btn">Search</button>
      </form>

      {issues.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Project</th>
                <th>Maintainer</th>
                <th>Difficulty</th>
                <th>Posted</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/issues/${i.id}`}>{i.title}</Link>
                  </td>
                  <td>{i.project_title}</td>
                  <td>{i.maintainer}</td>
                  <td>
                    <Pill value={i.difficulty} />
                  </td>
                  <td className="muted">{ago(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">Nothing found.</div>
      )}
    </>
  );
}
