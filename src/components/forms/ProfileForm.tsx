'use client';

import { saveProfileAction } from '@/app/actions/profile';
import { SkillEditor } from '@/components/SkillEditor';
import { useActionForm } from '@/components/useActionForm';
import type { SkillRow } from '@/lib/types';

export function ProfileForm({
  name,
  bio,
  skills,
  suggestions,
  isContributor,
}: {
  name: string;
  bio: string;
  skills: SkillRow[];
  suggestions: string[];
  isContributor: boolean;
}) {
  const { state, onSubmit, pending } = useActionForm(saveProfileAction);
  return (
    <>
      {state?.error && (
        <div className="flash error" role="alert">
          {state.error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" type="text" name="name" defaultValue={name} maxLength={100} required />
        </div>
        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea id="bio" name="bio" defaultValue={bio} />
          {isContributor && (
            <div className="hint">Saving re-embeds your bio and skills, which re-ranks your feed immediately.</div>
          )}
        </div>
        <div className="field">
          <label>Skills</label>
          <SkillEditor initial={skills} suggestions={suggestions} />
        </div>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </>
  );
}
