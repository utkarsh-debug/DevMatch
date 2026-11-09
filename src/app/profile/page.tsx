import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { deleteAccountAction } from '@/app/actions/profile';
import { ProfileForm } from '@/components/forms/ProfileForm';
import { requireUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { allSkillNames, profileOf } from '@/lib/queries';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const me = await requireUser();
  const [{ user, skills }, suggestions] = await Promise.all([profileOf(me.id), allSkillNames()]);
  if (!user) notFound();
  return (
    <>
      <div className="card form" style={{ margin: '10px auto' }}>
        <h2>Your profile</h2>
        <p className="muted small">
          {user.email} · {user.role} · member since {formatDate(user.created_at)}
        </p>
        <ProfileForm
          name={user.name}
          bio={user.bio ?? ''}
          skills={skills}
          suggestions={suggestions}
          isContributor={user.role === 'contributor'}
        />
      </div>

      <div className="card form danger-zone" style={{ margin: '18px auto' }}>
        <h3>Delete account</h3>
        <p className="muted small">
          Removes your account and, through <span className="mono">ON DELETE CASCADE</span>, your skills, embedding,
          applications, notifications{user.role === 'maintainer' ? ', projects and issues' : ''}. Your discussion
          comments stay in MongoDB but are anonymised.
        </p>
        <form action={deleteAccountAction} className="row">
          <input type="text" name="confirm" placeholder='Type "delete" to confirm' style={{ maxWidth: 260 }} autoComplete="off" />
          <button className="btn danger">Delete my account</button>
        </form>
      </div>
    </>
  );
}
