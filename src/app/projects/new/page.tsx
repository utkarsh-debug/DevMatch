import type { Metadata } from 'next';
import { createProjectAction } from '@/app/actions/projects';
import { ProjectForm } from '@/components/forms/ProjectIssueForms';
import { requireUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'New project' };

export default async function NewProjectPage() {
  await requireUser('maintainer');
  return <ProjectForm action={createProjectAction} editing={false} cancelHref="/dashboard" />;
}
