/**
 * Database-level tests against REAL PostgreSQL (+pgvector) and MongoDB.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/devmatch_test \
 *   TEST_MONGODB_URI=mongodb://localhost:27017  npm test
 *
 * WARNING: the target PostgreSQL schema and the MongoDB database `devmatch_test` are wiped.
 */
import '../scripts/env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('Set TEST_DATABASE_URL to a throw-away PostgreSQL database (it will be wiped).');
process.env.DATABASE_URL = PG;
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI ?? 'mongodb://localhost:27017';
process.env.MONGODB_DB = process.env.TEST_MONGODB_DB ?? 'devmatch_test';

type Db = typeof import('@/lib/db');
type Mongo = typeof import('@/lib/mongo');

let db: Db;
let mongo: Mongo;
let n = 0;

/** a 384-d vector as a pgvector literal with the given non-zero entries */
const vec = (entries: Record<number, number>) =>
  '[' + Array.from({ length: 384 }, (_, i) => (entries[i] ?? 0).toFixed(4)).join(',') + ']';

async function user(role: 'contributor' | 'maintainer', name = `User ${++n}`, status = 'active') {
  const r = await db.q1<{ id: number }>(
    `INSERT INTO users (name,email,password_hash,role,account_status) VALUES ($1,$2,'x',$3,$4) RETURNING id`,
    [name, `u${n}-${Date.now()}@t.dev`, role, status],
  );
  return r!.id;
}
async function project(maintainerId: number) {
  const r = await db.q1<{ id: number }>(
    'INSERT INTO projects (maintainer_id,title,repo_url) VALUES ($1,$2,$3) RETURNING id',
    [maintainerId, `P${++n}`, `https://example.com/${n}-${Date.now()}`],
  );
  return r!.id;
}
async function issue(projectId: number, embedding?: string) {
  const r = await db.q1<{ id: number }>(
    `INSERT INTO issues (project_id,title,description,difficulty,embedding) VALUES ($1,$2,'d','easy',$3::vector) RETURNING id`,
    [projectId, `I${++n}`, embedding ?? null],
  );
  return r!.id;
}
const apply = (issueId: number, userId: number) =>
  db.q1<{ id: number }>('INSERT INTO applications (issue_id,user_id) VALUES ($1,$2) RETURNING id', [issueId, userId]);

const rejects = async (p: Promise<unknown>, match: RegExp | string) => {
  await assert.rejects(p, (e: Error) => (typeof match === 'string' ? e.message.includes(match) : match.test(e.message)));
};

before(async () => {
  db = await import('@/lib/db');
  mongo = await import('@/lib/mongo');
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.pool.query(fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8'));
  const m = await mongo.getDb();
  await m.dropDatabase();
  await mongo.setupMongo(m);
});

after(async () => {
  await mongo.closeMongo();
  await db.pool.end();
});

// ===================================================================== PostgreSQL
describe('PostgreSQL schema', () => {
  it('has all tables, the view, the triggers and the stored functions', async () => {
    const tables = (await db.q<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname='public'")).map((r) => r.t);
    for (const t of ['users', 'skills', 'user_skills', 'projects', 'issues', 'user_embeddings', 'applications', 'notifications'])
      assert.ok(tables.includes(t), `missing table ${t}`);
    assert.equal((await db.q("SELECT 1 FROM pg_views WHERE viewname='open_issues_view'")).length, 1);
    const trig = (await db.q<{ t: string }>('SELECT tgname AS t FROM pg_trigger WHERE NOT tgisinternal')).map((r) => r.t);
    assert.ok(trig.includes('trg_check_application') && trig.includes('trg_notify_maintainer'));
    const fns = (await db.q<{ f: string }>("SELECT proname AS f FROM pg_proc WHERE proname IN ('accept_application','reject_application')")).map((r) => r.f);
    assert.equal(fns.length, 2);
    assert.equal((await db.q("SELECT 1 FROM pg_extension WHERE extname='vector'")).length, 1);
  });

  it('enforces CHECK, UNIQUE and NOT NULL constraints', async () => {
    const id = await user('contributor');
    await rejects(
      db.q("INSERT INTO users (name,email,password_hash,role) VALUES ('x','x@x.dev','h','admin')"),
      'users_role_check',
    );
    const email = (await db.q1<{ email: string }>('SELECT email FROM users WHERE id=$1', [id]))!.email;
    await rejects(db.q("INSERT INTO users (name,email,password_hash,role) VALUES ('x',$1,'h','contributor')", [email]), 'duplicate key');
    const p = await project(await user('maintainer'));
    await rejects(db.q("INSERT INTO issues (project_id,title,description,difficulty) VALUES ($1,'t','d','impossible')", [p]), 'check');
    await rejects(db.q("INSERT INTO issues (project_id,title,description,difficulty) VALUES ($1,'t','d',NULL)", [p]), 'null value');
  });

  it('stores 384-dimensional vectors and rejects other sizes', async () => {
    const i = await issue(await project(await user('maintainer')), vec({ 0: 1 }));
    assert.equal((await db.q1<{ d: number }>('SELECT vector_dims(embedding) AS d FROM issues WHERE id=$1', [i]))!.d, 384);
    await rejects(db.q("INSERT INTO issues (project_id,title,description,difficulty,embedding) VALUES (1,'t','d','easy','[1,2,3]')"), 'expected 384 dimensions');
  });

  it('open_issues_view only returns open issues', async () => {
    const p = await project(await user('maintainer'));
    const open = await issue(p);
    const closed = await issue(p);
    await db.q("UPDATE issues SET status='closed' WHERE id=$1", [closed]);
    const ids = (await db.q<{ id: number }>('SELECT id FROM open_issues_view')).map((r) => r.id);
    assert.ok(ids.includes(open));
    assert.ok(!ids.includes(closed));
  });
});

describe('PostgreSQL triggers', () => {
  it('lets an active contributor apply and notifies the maintainer', async () => {
    const m = await user('maintainer');
    const c = await user('contributor', 'Carla Contributor');
    const i = await issue(await project(m));
    await apply(i, c);
    const notes = await db.q<{ message: string }>('SELECT message FROM notifications WHERE user_id=$1', [m]);
    assert.ok(notes.some((x) => x.message.includes('Carla Contributor applied')));
  });

  it('rejects duplicate applications', async () => {
    const i = await issue(await project(await user('maintainer')));
    const c = await user('contributor');
    await apply(i, c);
    await rejects(apply(i, c), 'duplicate key');
  });

  it('blocks maintainers, suspended users and closed issues', async () => {
    const m = await user('maintainer');
    const i = await issue(await project(m));
    await rejects(apply(i, m), 'Only contributors can apply');
    await rejects(apply(i, await user('contributor', 'Sus', 'suspended')), 'suspended');
    const closed = await issue(await project(m));
    await db.q("UPDATE issues SET status='closed' WHERE id=$1", [closed]);
    await rejects(apply(closed, await user('contributor')), 'no longer open');
  });
});

describe('accept_application (atomic transaction)', () => {
  it('accepts one, rejects the rest, closes the issue and notifies everybody', async () => {
    const m = await user('maintainer');
    const i = await issue(await project(m));
    const [a, b, c] = [await user('contributor'), await user('contributor'), await user('contributor')];
    const [appA, appB, appC] = [await apply(i, a), await apply(i, b), await apply(i, c)];
    await db.tx((cl) => cl.query('SELECT accept_application($1,$2)', [appB!.id, m]));
    const st = Object.fromEntries((await db.q<{ id: number; status: string }>('SELECT id,status FROM applications WHERE issue_id=$1', [i])).map((r) => [r.id, r.status]));
    assert.equal(st[appB!.id], 'accepted');
    assert.equal(st[appA!.id], 'rejected');
    assert.equal(st[appC!.id], 'rejected');
    assert.equal((await db.q1<{ status: string }>('SELECT status FROM issues WHERE id=$1', [i]))!.status, 'closed');
    const msgs = async (u: number) => (await db.q<{ message: string }>('SELECT message FROM notifications WHERE user_id=$1', [u])).map((r) => r.message);
    assert.ok((await msgs(b)).some((x) => x.includes('You were accepted')));
    assert.ok((await msgs(a)).some((x) => x.includes('Another contributor was selected')));
  });

  it('rolls back completely when someone else tries to accept', async () => {
    const owner = await user('maintainer');
    const intruder = await user('maintainer');
    const i = await issue(await project(owner));
    const app = await apply(i, await user('contributor'));
    await rejects(db.tx((cl) => cl.query('SELECT accept_application($1,$2)', [app!.id, intruder])), 'only accept applicants for your own issues');
    assert.equal((await db.q1<{ status: string }>('SELECT status FROM applications WHERE id=$1', [app!.id]))!.status, 'pending');
    assert.equal((await db.q1<{ status: string }>('SELECT status FROM issues WHERE id=$1', [i]))!.status, 'open');
  });

  it('refuses to accept twice', async () => {
    const m = await user('maintainer');
    const i = await issue(await project(m));
    const app = await apply(i, await user('contributor'));
    await db.q('SELECT accept_application($1,$2)', [app!.id, m]);
    await rejects(db.q('SELECT accept_application($1,$2)', [app!.id, m]), 'already closed');
  });

  it('two simultaneous accepts: exactly one wins (row lock serialises them)', async () => {
    const m = await user('maintainer');
    const i = await issue(await project(m));
    const [x, y] = [await apply(i, await user('contributor')), await apply(i, await user('contributor'))];
    const results = await Promise.allSettled([x, y].map((a) => db.tx((cl) => cl.query('SELECT accept_application($1,$2)', [a!.id, m]))));
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    assert.equal((await db.q1<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE issue_id=$1 AND status='accepted'", [i]))!.n, 1);
  });

  it('reject_application rejects one applicant and keeps the issue open', async () => {
    const m = await user('maintainer');
    const i = await issue(await project(m));
    const app = await apply(i, await user('contributor'));
    await db.q('SELECT reject_application($1,$2)', [app!.id, m]);
    assert.equal((await db.q1<{ status: string }>('SELECT status FROM applications WHERE id=$1', [app!.id]))!.status, 'rejected');
    assert.equal((await db.q1<{ status: string }>('SELECT status FROM issues WHERE id=$1', [i]))!.status, 'open');
  });
});

describe('PostgreSQL cascades', () => {
  it('deleting a project removes its issues and applications', async () => {
    const p = await project(await user('maintainer'));
    const i = await issue(p);
    await apply(i, await user('contributor'));
    await db.q('DELETE FROM projects WHERE id=$1', [p]);
    assert.equal((await db.q('SELECT 1 FROM issues WHERE id=$1', [i])).length, 0);
    assert.equal((await db.q('SELECT 1 FROM applications WHERE issue_id=$1', [i])).length, 0);
  });

  it('deleting a user removes skills, embedding and applications', async () => {
    const c = await user('contributor');
    await db.q("INSERT INTO skills (name) VALUES ('cascade-skill') ON CONFLICT DO NOTHING");
    await db.q("INSERT INTO user_skills (user_id,skill_id,proficiency) SELECT $1,id,'advanced' FROM skills WHERE name='cascade-skill'", [c]);
    await db.q('INSERT INTO user_embeddings (user_id,embedding) VALUES ($1,$2::vector)', [c, vec({ 3: 1 })]);
    await apply(await issue(await project(await user('maintainer'))), c);
    await db.q('DELETE FROM users WHERE id=$1', [c]);
    for (const t of ['user_skills', 'user_embeddings', 'applications'])
      assert.equal((await db.q(`SELECT 1 FROM ${t} WHERE user_id=$1`, [c])).length, 0, t);
  });
});

describe('pgvector', () => {
  it('orders nearest neighbours by cosine distance', async () => {
    const m = await project(await user('maintainer'));
    const near = await issue(m, vec({ 10: 1 }));
    const mid = await issue(m, vec({ 10: 1, 11: 1 }));
    const far = await issue(m, vec({ 11: 1 }));
    const rows = await db.q<{ id: number; sim: number }>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM issues WHERE id = ANY($2::int[]) ORDER BY embedding <=> $1::vector`,
      [vec({ 10: 1 }), [near, mid, far]],
    );
    assert.deepEqual(rows.map((r) => r.id), [near, mid, far]);
    assert.ok(Math.abs(rows[0].sim - 1) < 1e-6);
    assert.ok(Math.abs(rows[1].sim - Math.SQRT1_2) < 1e-4);
    assert.ok(Math.abs(rows[2].sim) < 1e-6);
  });

  it('supports L2 and inner-product operators', async () => {
    const r = await db.q1<{ l2: number; ip: number }>(
      "SELECT ('[1,0,0]'::vector <-> '[0,1,0]'::vector) AS l2, ('[1,2,3]'::vector <#> '[4,5,6]'::vector) AS ip",
    );
    assert.ok(Math.abs(r!.l2 - Math.SQRT2) < 1e-6);
    assert.equal(r!.ip, -32);
  });

  it('has ivfflat indexes on both embedding columns', async () => {
    const idx = (await db.q<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE indexname IN ('idx_issues_embedding','idx_user_embeddings')")).map((r) => r.indexdef);
    assert.equal(idx.length, 2);
    assert.ok(idx.every((d) => d.includes('ivfflat') && d.includes('vector_cosine_ops')));
  });
});

// ======================================================================= MongoDB
describe('MongoDB', () => {
  const mkComment = (issueId: number, over: Record<string, unknown> = {}) => ({
    _id: new (require('mongodb').ObjectId)(),
    issueId,
    authorId: 1,
    authorName: 'Ann',
    authorRole: 'contributor' as const,
    body: 'Is a cursor-based approach acceptable?',
    createdAt: new Date(),
    likes: [] as number[],
    replies: [] as any[],
    ...over,
  });

  it('setupMongo is idempotent and creates the indexes (incl. TTL and text)', async () => {
    await mongo.setupMongo();
    await mongo.setupMongo();
    const d = await mongo.getDb();
    const c = await d.collection('comments').indexes();
    const a = await d.collection('activity_log').indexes();
    const names = (l: { name?: string }[]) => l.map((i) => i.name);
    assert.ok(names(c).includes('issue_thread') && names(c).includes('comment_text') && names(c).includes('by_reply_author'));
    const ttl = a.find((i) => i.name === 'ttl_90_days');
    assert.equal(ttl?.expireAfterSeconds, 60 * 60 * 24 * 90);
  });

  it('JSON-schema validators reject malformed documents', async () => {
    const col = await mongo.comments();
    await assert.rejects(col.insertOne({ issueId: 1 } as any), (e: any) => e.code === 121);
    await assert.rejects(col.insertOne(mkComment(1, { body: '' }) as any), (e: any) => e.code === 121);
    await assert.rejects(col.insertOne(mkComment(1, { authorRole: 'admin' }) as any), (e: any) => e.code === 121);
    const act = await mongo.activityLog();
    await assert.rejects(act.insertOne({ type: 'x' } as any), (e: any) => e.code === 121);
  });

  it('embeds replies with $push and keeps likes a set with $addToSet / $pull', async () => {
    const col = await mongo.comments();
    const doc = mkComment(101);
    await col.insertOne(doc);
    await col.updateOne({ _id: doc._id }, { $push: { replies: { _id: new mongo.ObjectId(), authorId: 2, authorName: 'Max', authorRole: 'maintainer', body: 'Yes', createdAt: new Date() } } });
    await col.updateOne({ _id: doc._id }, { $addToSet: { likes: 7 } });
    await col.updateOne({ _id: doc._id }, { $addToSet: { likes: 7 } }); // duplicate -> ignored
    let got = await col.findOne({ _id: doc._id });
    assert.equal(got!.replies.length, 1);
    assert.deepEqual(got!.likes, [7]);
    await col.updateOne({ _id: doc._id }, { $pull: { likes: 7 } });
    got = await col.findOne({ _id: doc._id });
    assert.deepEqual(got!.likes, []);
  });

  it('full-text search finds comments and replies', async () => {
    const col = await mongo.comments();
    await col.insertOne(mkComment(102, { body: 'Consider a trigram GIN index for the search endpoint' }));
    const hits = await col.find({ $text: { $search: 'trigram' } }).toArray();
    assert.ok(hits.some((h) => h.issueId === 102));
  });

  it('aggregation pipelines group embedded data', async () => {
    const col = await mongo.comments();
    await col.deleteMany({ issueId: 103 });
    await col.insertMany([
      mkComment(103, { replies: [{ _id: new mongo.ObjectId(), authorId: 2, authorName: 'M', authorRole: 'maintainer', body: 'a', createdAt: new Date() }] }),
      mkComment(103, { likes: [1, 2] }),
    ]);
    const [row] = await col
      .aggregate([
        { $match: { issueId: 103 } },
        { $project: { issueId: 1, replyCount: { $size: '$replies' }, likeCount: { $size: '$likes' } } },
        { $group: { _id: '$issueId', comments: { $sum: 1 }, replies: { $sum: '$replyCount' }, likes: { $sum: '$likeCount' } } },
      ])
      .toArray();
    assert.deepEqual({ c: row.comments, r: row.replies, l: row.likes }, { c: 2, r: 1, l: 2 });
  });

  it('anonymiseAuthor rewrites comments and embedded replies with arrayFilters', async () => {
    const col = await mongo.comments();
    const doc = mkComment(104, { authorId: 55, authorName: 'Leaver', likes: [55] });
    const other = mkComment(104, { authorId: 56, authorName: 'Stayer', replies: [
      { _id: new mongo.ObjectId(), authorId: 55, authorName: 'Leaver', authorRole: 'contributor', body: 'x', createdAt: new Date() },
      { _id: new mongo.ObjectId(), authorId: 56, authorName: 'Stayer', authorRole: 'contributor', body: 'y', createdAt: new Date() },
    ] });
    await col.insertMany([doc, other]);
    const { anonymiseAuthor } = await import('@/lib/discussion');
    await anonymiseAuthor(55);
    const a = await col.findOne({ _id: doc._id });
    const b = await col.findOne({ _id: other._id });
    assert.equal(a!.authorName, '[deleted user]');
    assert.deepEqual(a!.likes, []);
    assert.deepEqual(b!.replies.map((r) => r.authorName), ['[deleted user]', 'Stayer']);
  });
});
