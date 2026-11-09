import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteProjectAction } from '@/app/actions/projects';
import { ConfirmForm } from '@/components/ConfirmForm';
import { Pill } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { numId } from '@/lib/params';
import { issuesOfProject, projectById } from '@/lib/queries';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('maintainer');
  const id = numId((await params).id);
  if (!id) notFound();
  const project = await projectById(id);
  if (!project) notFound();
  if (project.maintainer_id !== user.id) notFound();
  const issues = await issuesOfProject(id);

  return (
    <>
      <p className="small muted">
        <Link href="/dashboard">&larr; Dashboard</Link>
      </p>
      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '1.7rem' }}>{project.title}</h1>
            <div className="small muted">
              <a href={project.repo_url} target="_blank" rel="noopener noreferrer">
                {project.repo_url}
              </a>
              {project.tech_stack && (
                <>
                  {' '}
                  · <span className="mono">{project.tech_stack}</span>
                </>
              )}
            </div>
          </div>
          <div className="row">
            <Link className="btn small" href={`/projects/${id}/edit`}>
              Edit
            </Link>
            <ConfirmForm
              action={deleteProjectAction.bind(null, id)}
              message="Delete this project, all its issues and all applications?"
            >
              <button className="btn small danger">Delete</button>
            </ConfirmForm>
          </div>
        </div>
      </div>

      <div className="section-title">
        <h2>Issues</h2>
        <Link className="btn small primary" href={`/projects/${id}/issues/new`}>
          + New issue
        </Link>
      </div>
      {issues.length ? (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th>Difficulty</th>
                <th>Status</th>
                <th>Applicants</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/issues/${i.id}`}>{i.title}</Link>
                  </td>
                  <td>
                    <Pill value={i.difficulty} />
                  </td>
                  <td>
                    <Pill value={i.status} />
                  </td>
                  <td>
                    {i.applicants}
                    {i.pending > 0 && <span className="muted small"> ({i.pending} pending)</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link className="btn small" href={`/issues/${i.id}/edit`}>
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card empty">No issues yet. Post one and matching contributors will see it.</div>
      )}
    </>
  );
}
