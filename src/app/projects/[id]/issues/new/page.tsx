import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createIssueAction } from '@/app/actions/issues';
import { IssueForm } from '@/components/forms/ProjectIssueForms';
import { requireUser } from '@/lib/auth';
import { numId } from '@/lib/params';
import { projectById } from '@/lib/queries';

export const metadata: Metadata = { title: 'New issue' };

export default async function NewIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('maintainer');
  const id = numId((await params).id);
  if (!id) notFound();
  const project = await projectById(id);
  if (!project || project.maintainer_id !== user.id) notFound();
  return (
    <IssueForm
      action={createIssueAction.bind(null, id)}
      editing={false}
      projectTitle={project.title}
      cancelHref={`/projects/${id}`}
    />
  );
}
