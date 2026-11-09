'use client';

import Link from 'next/link';
import { loginAction, registerAction } from '@/app/actions/auth';
import { SkillEditor } from '@/components/SkillEditor';
import { useActionForm } from '@/components/useActionForm';

export function LoginForm({ next }: { next?: string }) {
  const { state, onSubmit, pending } = useActionForm(loginAction);
  return (
    <div className="card narrow">
      <h2>Log in</h2>
      {state?.error && (
        <div className="flash error" role="alert">
          {state.error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <input type="hidden" name="next" value={next ?? ''} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" name="email" defaultValue={String(state?.values?.email ?? '')} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" name="password" required />
        </div>
        <button className="btn primary" style={{ width: '100%' }} disabled={pending}>
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="muted small" style={{ margin: '16px 0 0' }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </div>
  );
}

export function RegisterForm({ suggestions }: { suggestions: string[] }) {
  const { state, onSubmit, pending } = useActionForm(registerAction);
  return (
    <div className="card form" style={{ margin: '10px auto' }}>
      <h2>Create your account</h2>
      {state?.error && (
        <div className="flash error" role="alert">
          {state.error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="name">Name</label>
            <input id="name" type="text" name="name" maxLength={100} required />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" name="email" maxLength={150} required />
          </div>
        </div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="password">Password</label>
            <input id="password" type="password" name="password" minLength={6} required />
            <div className="hint">At least 6 characters.</div>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor="role">I am a</label>
            <select id="role" name="role" defaultValue="contributor">
              <option value="contributor">Contributor — looking for issues</option>
              <option value="maintainer">Maintainer — posting issues</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea
            id="bio"
            name="bio"
            placeholder="What do you enjoy building? What are you good at? The more specific, the better your matches."
          />
          <div className="hint">Contributors: this text and your skills are embedded to rank issues for you.</div>
        </div>
        <div className="field">
          <label>Skills</label>
          <SkillEditor initial={[]} suggestions={suggestions} />
        </div>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Creating account…' : 'Sign up'}
        </button>
        <Link className="btn link" href="/login" style={{ marginLeft: 12 }}>
          I already have an account
        </Link>
      </form>
    </div>
  );
}
