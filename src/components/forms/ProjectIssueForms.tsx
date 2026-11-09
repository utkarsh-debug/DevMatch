'use client';

import Link from 'next/link';
import { useActionForm } from '@/components/useActionForm';
import { DIFFICULTIES, type FormState } from '@/lib/types';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function ProjectForm({
  action,
  initial,
  editing,
  cancelHref,
}: {
  action: Action;
  initial?: { title: string; repo_url: string; tech_stack: string | null };
  editing: boolean;
  cancelHref: string;
}) {
  const { state, onSubmit, pending } = useActionForm(action);
  return (
    <div className="card form" style={{ margin: '10px auto' }}>
      <h2>{editing ? 'Edit project' : 'New project'}</h2>
      {state?.error && (
        <div className="flash error" role="alert">
          {state.error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" type="text" name="title" defaultValue={initial?.title ?? ''} maxLength={150} required />
        </div>
        <div className="field">
          <label htmlFor="repo_url">Repository URL</label>
          <input
            id="repo_url"
            type="url"
            name="repo_url"
            defaultValue={initial?.repo_url ?? ''}
            maxLength={255}
            placeholder="https://github.com/you/project"
            required
          />
          <div className="hint">Must be unique across DevMatch.</div>
        </div>
        <div className="field">
          <label htmlFor="tech_stack">Tech stack</label>
          <input
            id="tech_stack"
            type="text"
            name="tech_stack"
            defaultValue={initial?.tech_stack ?? ''}
            maxLength={255}
            placeholder="Python, FastAPI, PostgreSQL"
          />
          <div className="hint">Included when each issue is embedded, so it improves matching.</div>
        </div>
        <button className="btn primary" disabled={pending}>
          {editing ? 'Save changes' : 'Create project'}
        </button>
        <Link className="btn link" style={{ marginLeft: 12 }} href={cancelHref}>
          Cancel
        </Link>
      </form>
    </div>
  );
}

export function IssueForm({
  action,
  initial,
  editing,
  projectTitle,
  cancelHref,
}: {
  action: Action;
  initial?: { title: string; description: string; difficulty: string };
  editing: boolean;
  projectTitle: string;
  cancelHref: string;
}) {
  const { state, onSubmit, pending } = useActionForm(action);
  return (
    <div className="card form" style={{ margin: '10px auto' }}>
      <h2>
        {editing ? 'Edit issue' : 'New issue'}{' '}
        <span className="muted small" style={{ fontFamily: 'var(--sans)', fontWeight: 400 }}>
          in {projectTitle}
        </span>
      </h2>
      {state?.error && (
        <div className="flash error" role="alert">
          {state.error}
        </div>
      )}
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" type="text" name="title" defaultValue={initial?.title ?? ''} maxLength={200} required />
        </div>
        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            name="description"
            style={{ minHeight: 200 }}
            defaultValue={initial?.description ?? ''}
            required
            placeholder="What needs doing, which technologies and skills it involves, and what 'done' looks like."
          />
          <div className="hint">
            This text is embedded and compared with contributor profiles. Mention the skills involved in plain words — no
            tags needed.
          </div>
        </div>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="difficulty">Difficulty</label>
          <select id="difficulty" name="difficulty" defaultValue={initial?.difficulty ?? ''} required>
            <option value="">Choose…</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" disabled={pending}>
          {editing ? 'Save and re-match' : 'Post issue'}
        </button>
        <Link className="btn link" style={{ marginLeft: 12 }} href={cancelHref}>
          Cancel
        </Link>
      </form>
    </div>
  );
}
