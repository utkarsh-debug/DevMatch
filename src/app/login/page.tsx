import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/forms/AuthForms';
import { getSessionUser } from '@/lib/auth';
import { one, type SP } from '@/lib/params';

export const metadata: Metadata = { title: 'Log in' };

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const user = await getSessionUser();
  if (user) redirect(user.role === 'maintainer' ? '/dashboard' : '/feed');
  const sp = await searchParams;
  return <LoginForm next={one(sp.next)} />;
}
