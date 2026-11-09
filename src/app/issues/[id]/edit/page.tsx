import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { updateIssueAction } from '@/app/actions/issues';
import { IssueForm } from '@/components/forms/ProjectIssueForms';
import { requireUser } from '@/lib/auth';
import { numId } from '@/lib/params';
import { issueForEdit } from '@/lib/queries';

export const metadata: Metadata = { title: 'Edit issue' };

export default async function EditIssuePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('maintainer');
  const id = numId((await params).id);
  if (!id) notFound();
  const issue = await issueForEdit(id);
  if (!issue || issue.maintainer_id !== user.id) notFound();
  return (
    <IssueForm
      action={updateIssueAction.bind(null, id)}
      initial={issue}
      editing
      projectTitle={issue.project_title}
      cancelHref={`/issues/${id}`}
    />
  );
}
