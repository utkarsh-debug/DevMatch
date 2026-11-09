import type { Metadata } from 'next';
import Link from 'next/link';
import { withdrawAction } from '@/app/actions/applications';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Meter, Pill } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { ago } from '@/lib/format';
import { applicationsOf } from '@/lib/queries';

export const metadata: Metadata = { title: 'My applications' };

export default async function ApplicationsPage() {
  const user = await requireUser('contributor');
  const apps = await applicationsOf(user.id);
  return (
    <>
      <h1>My applications</h1>
      {apps.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Project</th>
                <th>Match</th>
                <th>Status</th>
                <th>Applied</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/issues/${a.issue_id}`}>{a.title}</Link>
                  </td>
                  <td>{a.project_title}</td>
                  <td>
                    <Meter sim={a.similarity} />
                  </td>
                  <td>
                    <Pill value={a.status} />
                  </td>
                  <td className="muted">{ago(a.applied_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {a.status === 'pending' && (
                      <ConfirmForm action={withdrawAction.bind(null, a.id)} message="Withdraw this application?">
                        <button className="btn small danger">Withdraw</button>
                      </ConfirmForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">
          You haven&apos;t applied to anything yet. <Link href="/feed">See your matches</Link>.
        </div>
      )}
    </>
  );
}
