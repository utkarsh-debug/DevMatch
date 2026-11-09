import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/forms/AuthForms';
import { getSessionUser } from '@/lib/auth';
import { allSkillNames } from '@/lib/queries';

export const metadata: Metadata = { title: 'Sign up' };

export default async function RegisterPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === 'maintainer' ? '/dashboard' : '/feed');
  return <RegisterForm suggestions={await allSkillNames()} />;
}
