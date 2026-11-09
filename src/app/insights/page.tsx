import type { Metadata } from 'next';
import { eventsByType, eventsPerDay, mostActiveUsers, mostDiscussedIssues, shellJson, type PipelineResult } from '@/lib/analytics';
import { requireUser } from '@/lib/auth';
import { run, SQL_INSIGHTS, VECTOR_INSIGHTS, type SqlResult } from '@/lib/insights';
import { issueTitles } from '@/lib/queries';

export const metadata: Metadata = { title: 'DB insights' };

function Table({ cols, rows }: { cols: string[]; rows: Record<string, unknown>[] }) {
  if (rows.length === 0) return <p className="muted small">No rows yet.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c}>{c.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c}>{r[c] instanceof Date ? (r[c] as Date).toISOString().slice(0, 16).replace('T', ' ') : String(r[c] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SqlCard({ r }: { r: SqlResult }) {
  return (
    <div className="card">
      <div className="row between">
        <h3>{r.title}</h3>
        <span className="tech-note">{r.concept}</span>
      </div>
      <Table cols={r.cols} rows={r.rows} />
      <details>
        <summary>Show SQL</summary>
        <pre className="sql">{r.sql}</pre>
      </details>
    </div>
  );
}

function MongoCard({ r }: { r: PipelineResult }) {
  const cols = r.rows[0] ? Object.keys(r.rows[0]) : [];
  return (
    <div className="card">
      <div className="row between">
        <h3>{r.title}</h3>
        <span className="tech-note">db.{r.collection}.aggregate([…])</span>
      </div>
      <Table cols={cols} rows={r.rows} />
      <details>
        <summary>Show aggregation pipeline</summary>
        <pre className="sql">{`db.${r.collection}.aggregate(${shellJson(r.pipeline)})`}</pre>
      </details>
    </div>
  );
}

export default async function InsightsPage() {
  await requireUser();
  const sql = await run(SQL_INSIGHTS);
  const vec = await run(VECTOR_INSIGHTS);

  let mongo: PipelineResult[] | null = null;
  try {
    const [a, b, c, d] = await Promise.all([eventsByType(), eventsPerDay(14), mostActiveUsers(5), mostDiscussedIssues(5)]);
    // application-level "join": Mongo knows issue ids, PostgreSQL knows their titles
    const titles = await issueTitles(d.rows.map((r) => Number(r._id)));
    d.rows = d.rows.map((r) => ({ issue: titles.get(Number(r._id)) ?? `#${r._id}`, ...r }));
    mongo = [a, b, c, d];
  } catch {
    mongo = null;
  }

  return (
    <>
      <h1>Database insights</h1>
      <p className="muted">
        Live results from the three data stores behind DevMatch. Expand a card to see the exact query.
      </p>

      <div className="section-label">PostgreSQL · relational analytics</div>
      {sql.map((r) => (
        <SqlCard key={r.title} r={r} />
      ))}

      <div className="section-label">pgvector · semantic search inside PostgreSQL</div>
      {vec.map((r) => (
        <SqlCard key={r.title} r={r} />
      ))}

      <div className="section-label">MongoDB · aggregation pipelines</div>
      {mongo ? (
        mongo.map((r) => <MongoCard key={r.title} r={r} />)
      ) : (
        <div className="card empty">MongoDB is not reachable right now.</div>
      )}
    </>
  );
}
