/**
 * Demo data for both databases. All demo accounts use the password  password123
 *
 *   PostgreSQL : maintainers, contributors (+ skills + vectors), projects, issues, applications
 *   MongoDB    : discussion threads (comments with replies/likes) and an activity log
 */
import './env';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool, tx } from '@/lib/db';
import { activityLog, closeMongo, comments, getDb, ObjectId, type ActivityDoc, type CommentDoc } from '@/lib/mongo';
import { refreshIssueEmbedding, refreshUserEmbedding, saveUserSkills } from '@/lib/writes';
import { backendName } from '@/lib/embedder';
import type { Level } from '@/lib/types';
import data from './seed-data.json';

const PASSWORD = 'password123';
const DAY = 86_400_000;

type Maintainer = [name: string, email: string, bio: string];
type Contributor = [name: string, email: string, bio: string, skills: [string, Level][]];
type Project = [maintainer: string, title: string, repo: string, stack: string, issues: [string, string, string][]];

const MAINTAINERS = data.maintainers as unknown as Maintainer[];
const CONTRIBUTORS = data.contributors as unknown as Contributor[];
const PROJECTS = data.projects as unknown as Project[];

/** [issue title, [author email, body, likedBy emails, replies: [author email, body][]]] */
const THREADS: Record<string, [string, string, string[], [string, string][]][]> = {
  'Add pagination to the /items REST endpoint': [
    [
      'vijay@devmatch.dev',
      'Is cursor-based pagination required, or would limit/offset be acceptable for a first version?',
      ['asha@devmatch.dev'],
      [
        ['asha@devmatch.dev', 'Cursor-based please — offset gets slow on the large items table. Keep the old response shape behind a `legacy` flag.'],
        ['vijay@devmatch.dev', 'Makes sense. I will base the cursor on the (created_at, id) pair so ordering stays stable.'],
      ],
    ],
  ],
  'Speed up the slow search query with a database index': [
    [
      'liam@devmatch.dev',
      'Do we have an EXPLAIN ANALYZE from production? A trigram GIN index might beat a plain B-tree for this search.',
      ['vijay@devmatch.dev', 'asha@devmatch.dev'],
      [['asha@devmatch.dev', 'Good point. I will attach the query plan to the issue tomorrow.']],
    ],
  ],
  'Make the chart legend keyboard accessible': [
    [
      'neha@devmatch.dev',
      'I can also add a visible focus ring that works in dark mode. OK to include that in the same change?',
      [],
      [['marcus@devmatch.dev', 'Yes please, that fits nicely with the dark theme issue.']],
    ],
  ],
  'Reduce memory fragmentation in the slab allocator': [
    [
      'rohan@devmatch.dev',
      'Do you have a benchmark that reproduces the growth? I would like to start from a failing test.',
      ['marcus@devmatch.dev'],
      [],
    ],
  ],
  'Add a dark theme to the React components': [
    [
      'ishaan@devmatch.dev',
      'First-time contributor here. Is there a CSS variables file I should extend?',
      [],
      [['marcus@devmatch.dev', 'Yes, src/theme.css. Start there and ask if anything is unclear.']],
    ],
  ],
  'Fix typos and outdated steps in the quickstart guide': [
    ['meera@devmatch.dev', 'Finished a first pass over the quickstart. I will open a PR tonight.', ['asha@devmatch.dev'], []],
  ],
};

async function main() {
  const existing = (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n as number;
  if (existing > 0) {
    console.log('Database already has users; skipping seed (use `npm run db:reset` to start over).');
    await pool.end();
    await closeMongo();
    return;
  }
  console.log('Embedding backend:', await backendName());

  const hash = await bcrypt.hash(PASSWORD, 10);
  const uid: Record<string, number> = {};
  const uname: Record<string, string> = {};
  const urole: Record<string, 'maintainer' | 'contributor'> = {};
  const issueId: Record<string, number> = {};
  const projectId: Record<string, number> = {};
  const issueMaintainer: Record<string, string> = {};
  const events: ActivityDoc[] = [];

  // deterministic "history" so the charts on the insights page are not empty
  let tick = 0;
  const ev = (email: string, type: string, daysAgo: number, extra: Partial<ActivityDoc> = {}) => {
    tick += 1;
    events.push({
      ts: new Date(Date.now() - daysAgo * DAY - (tick % 17) * 41 * 60_000),
      type,
      actorId: uid[email],
      actorName: uname[email],
      actorRole: urole[email],
      ...extra,
    });
  };

  let acceptApp = 0;
  let acceptMaintainer = '';
  let acceptApplicant = '';

  await tx(async (c: PoolClient) => {
    for (const [name, email, bio] of MAINTAINERS) {
      const r = await c.query(
        "INSERT INTO users (name,email,password_hash,role,bio) VALUES ($1,$2,$3,'maintainer',$4) RETURNING id",
        [name, email, hash, bio],
      );
      uid[email] = r.rows[0].id;
      uname[email] = name;
      urole[email] = 'maintainer';
    }
    for (const [name, email, bio, skills] of CONTRIBUTORS) {
      const r = await c.query(
        "INSERT INTO users (name,email,password_hash,role,bio) VALUES ($1,$2,$3,'contributor',$4) RETURNING id",
        [name, email, hash, bio],
      );
      uid[email] = r.rows[0].id;
      uname[email] = name;
      urole[email] = 'contributor';
      await saveUserSkills(c, uid[email], skills.map(([n, level]) => ({ name: n, level })));
      await refreshUserEmbedding(c, uid[email]);
    }
    Object.keys(uid).forEach((email, i) => ev(email, 'register', 12 - (i % 5)));

    for (const [mEmail, title, repo, stack, issues] of PROJECTS) {
      const p = await c.query(
        'INSERT INTO projects (maintainer_id,title,repo_url,tech_stack) VALUES ($1,$2,$3,$4) RETURNING id',
        [uid[mEmail], title, repo, stack],
      );
      projectId[title] = p.rows[0].id;
      ev(mEmail, 'project_created', 10, { projectId: projectId[title], meta: { title } });
      for (const [it, desc, diff] of issues) {
        const r = await c.query(
          'INSERT INTO issues (project_id,title,description,difficulty) VALUES ($1,$2,$3,$4) RETURNING id',
          [projectId[title], it, desc, diff],
        );
        issueId[it] = r.rows[0].id;
        issueMaintainer[it] = mEmail;
        await refreshIssueEmbedding(c, issueId[it]);
        ev(mEmail, 'issue_created', 9, { issueId: issueId[it], projectId: projectId[title], meta: { difficulty: diff } });
      }
    }

    // a few applications (the AFTER INSERT trigger notifies the maintainers)
    const apply = async (email: string, issueTitle: string, daysAgo: number) => {
      const r = await c.query('INSERT INTO applications (issue_id,user_id) VALUES ($1,$2) RETURNING id', [
        issueId[issueTitle],
        uid[email],
      ]);
      ev(email, 'applied', daysAgo, { issueId: issueId[issueTitle] });
      return r.rows[0].id as number;
    };
    await apply('vijay@devmatch.dev', 'Add pagination to the /items REST endpoint', 6);
    await apply('zoe@devmatch.dev', 'Rate-limit login attempts to prevent brute force', 6);
    await apply('vijay@devmatch.dev', 'Speed up the slow search query with a database index', 5);
    await apply('liam@devmatch.dev', 'Speed up the slow search query with a database index', 5);
    await apply('rohan@devmatch.dev', 'Reduce memory fragmentation in the slab allocator', 4);
    await apply('neha@devmatch.dev', 'Make the chart legend keyboard accessible', 4);
    await apply('ishaan@devmatch.dev', 'Add a dark theme to the React components', 3);
    await apply('neha@devmatch.dev', 'Add a dark theme to the React components', 3);
    const typoTitle = 'Fix typos and outdated steps in the quickstart guide';
    acceptApp = await apply('meera@devmatch.dev', typoTitle, 3);
    await apply('ishaan@devmatch.dev', typoTitle, 3);

    // one finished story: Meera is accepted and Ishaan is told the issue closed — one atomic function call
    acceptMaintainer = issueMaintainer[typoTitle];
    acceptApplicant = 'meera@devmatch.dev';
    await c.query('SELECT accept_application($1, $2)', [acceptApp, uid[acceptMaintainer]]);
    ev(acceptMaintainer, 'accepted', 1, {
      issueId: issueId[typoTitle],
      meta: { applicantId: uid[acceptApplicant], applicant: uname[acceptApplicant] },
    });
  });

  // ---------------------------------------------------------------- MongoDB
  const db = await getDb();
  await db.collection('comments').deleteMany({});
  await db.collection('activity_log').deleteMany({});

  const docs: CommentDoc[] = [];
  let n = 0;
  for (const [title, thread] of Object.entries(THREADS)) {
    for (const [author, body, likedBy, replies] of thread) {
      n += 1;
      const created = Date.now() - (3 - (n % 3)) * DAY + n * 3_600_000;
      docs.push({
        _id: new ObjectId(),
        issueId: issueId[title],
        authorId: uid[author],
        authorName: uname[author],
        authorRole: urole[author],
        body,
        createdAt: new Date(created),
        likes: likedBy.map((e) => uid[e]),
        replies: replies.map(([rAuthor, rBody], i) => ({
          _id: new ObjectId(),
          authorId: uid[rAuthor],
          authorName: uname[rAuthor],
          authorRole: urole[rAuthor],
          body: rBody,
          createdAt: new Date(created + (i + 1) * 47 * 60_000),
        })),
      });
      ev(author, 'comment', 3 - (n % 3), { issueId: issueId[title] });
      replies.forEach(([rAuthor], i) => ev(rAuthor, 'reply', 2.5 - (n % 3) * 0.5 + i * 0.01, { issueId: issueId[title] }));
    }
  }
  await (await comments()).insertMany(docs);

  // a couple of logins so the log is not only writes
  ['vijay@devmatch.dev', 'asha@devmatch.dev', 'neha@devmatch.dev', 'marcus@devmatch.dev'].forEach((e, i) => ev(e, 'login', i * 0.7));
  events.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  await (await activityLog()).insertMany(events);

  console.log(
    `Seeded ${MAINTAINERS.length} maintainers, ${CONTRIBUTORS.length} contributors, ${PROJECTS.length} projects, ` +
      `${Object.keys(issueId).length} issues (PostgreSQL) and ${docs.length} comment threads, ${events.length} activity events (MongoDB).`,
  );
  console.log(`Demo logins (password: ${PASSWORD}):`);
  console.log('  maintainer  asha@devmatch.dev');
  console.log('  contributor vijay@devmatch.dev   (backend / SQL)');
  console.log('  contributor neha@devmatch.dev    (frontend)');
  console.log('  contributor ishaan@devmatch.dev  (beginner)');

  await closeMongo();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
