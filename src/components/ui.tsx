import Link from 'next/link';
import { ago, label, pct } from '@/lib/format';
import type { IssueCardRow } from '@/lib/queries';

export function Meter({ sim }: { sim: number | null | undefined }) {
  const p = pct(sim);
  if (p === null) return <span className="meter none">no match score yet</span>;
  return (
    <span className={`meter ${p < 40 ? 'low' : ''}`} title={`Cosine similarity ${Number(sim).toFixed(3)}`}>
      <span className="bar">
        <i style={{ width: `${p}%` }} />
      </span>
      {p}% match
    </span>
  );
}

export function Pill({ value }: { value: string }) {
  return <span className={`pill ${value}`}>{label(value)}</span>;
}

export function Tags({ csv }: { csv: string | null | undefined }) {
  if (!csv) return null;
  return (
    <>
      {csv.split(', ').map((t) => (
        <span className="tag" key={t}>
          {t}
        </span>
      ))}
    </>
  );
}

export function IssueCard({ issue, showMatch = true }: { issue: IssueCardRow; showMatch?: boolean }) {
  return (
    <article className="card issue">
      <div>
        <h3>
          <Link href={`/issues/${issue.id}`}>{issue.title}</Link>
        </h3>
        <div className="meta">
          <span>{issue.project_title}</span>
          <span>· by {issue.maintainer}</span>
          <Pill value={issue.difficulty} />
          {issue.tech_stack && <span className="mono small">{issue.tech_stack}</span>}
          <span>{ago(issue.created_at)}</span>
        </div>
        <p className="desc">{issue.description}</p>
      </div>
      <div className="side">
        {showMatch && <Meter sim={issue.similarity} />}
        {issue.my_status && <Pill value={issue.my_status} />}
      </div>
    </article>
  );
}
