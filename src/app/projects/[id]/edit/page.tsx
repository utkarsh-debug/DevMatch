import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { updateProjectAction } from '@/app/actions/projects';
import { ProjectForm } from '@/components/forms/ProjectIssueForms';
import { requireUser } from '@/lib/auth';
import { numId } from '@/lib/params';
import { projectById } from '@/lib/queries';

export const metadata: Metadata = { title: 'Edit project' };

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser('maintainer');
  const id = numId((await params).id);
  if (!id) notFound();
  const project = await projectById(id);
  if (!project || project.maintainer_id !== user.id) notFound();
  return (
    <ProjectForm
      action={updateProjectAction.bind(null, id)}
      initial={project}
      editing
      cancelHref={`/projects/${id}`}
    />
  );
}
