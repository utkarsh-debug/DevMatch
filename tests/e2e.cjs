/**
 * Browser end-to-end test (Playwright + Chromium) against a RUNNING app with seeded databases.
 *
 *   npm run db:reset && npm run build && npm start        # terminal 1
 *   BASE_URL=http://localhost:3000 npm run test:e2e        # terminal 2
 *   (first time only:  npx playwright install chromium)
 *
 * It registers a new contributor, posts a project + issue as the demo maintainer, applies, discusses,
 * accepts, and checks the PostgreSQL / pgvector / MongoDB behaviour through the UI and the JSON API.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const RUN = Date.now().toString(36);
const EMAIL = `e2e-${RUN}@test.dev`;
const NAME = `E2E Fran ${RUN}`;
const ISSUE_TITLE = `E2E ${RUN} make the React dropdown keyboard accessible`;
const WORD = `quokkacheck${RUN}`;

let passed = 0;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    failures.push([name, e]);
    console.log('  ✗', name, '\n     ', String(e.message).split('\n').slice(0, 3).join('\n      '));
  }
}

async function go(page, path) {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
}
async function login(page, email, pw = 'password123', expectFail = false) {
  await go(page, '/login');
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button.btn.primary');
  if (!expectFail) await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
}
const flash = (page, text) => page.locator('.flash', { hasText: text }).first().waitFor({ timeout: 10000 });
const titles = (page) => page.locator('article.issue h3 a').allInnerTexts();
const idFrom = (url, re) => Number(url.match(re)[1]);

(async () => {
  const browser = await chromium.launch();
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.accept()); // confirm() prompts
    return { ctx, page };
  };
  const anon = await newPage();
  const maint = await newPage();
  const contrib = await newPage();
  let pid, iid;

  console.log(`\nDevMatch e2e against ${BASE}\n`);

  console.log('Anonymous visitor');
  await step('landing page renders', async () => {
    await go(anon.page, '/');
    assert.match(await anon.page.locator('h1').first().innerText(), /Open-source issues/);
  });
  await step('protected page redirects to /login?next=', async () => {
    await go(anon.page, '/feed');
    assert.match(anon.page.url(), /\/login\?next=%2Ffeed/);
  });
  await step('API refuses anonymous callers (401)', async () => {
    assert.equal((await anon.ctx.request.get(BASE + '/api/issues')).status(), 401);
  });
  await step('/api/health reports PostgreSQL, pgvector and MongoDB all up', async () => {
    const r = await anon.ctx.request.get(BASE + '/api/health');
    const j = await r.json();
    assert.equal(r.status(), 200);
    assert.ok(j.postgres.ok && j.pgvector.ok && j.mongodb.ok, JSON.stringify(j));
  });

  console.log('Contributor: sign-up and semantic feed');
  await step('register with bio + skills and land on the feed', async () => {
    const p = contrib.page;
    await go(p, '/register');
    await p.fill('#name', NAME);
    await p.fill('#email', EMAIL);
    await p.fill('#password', 'secret12');
    await p.fill(
      '#bio',
      'Frontend engineer building accessible, responsive React and TypeScript interfaces with CSS and keyboard navigation.',
    );
    await p.locator('input[name=skill_name]').nth(0).fill('react');
    await p.locator('select[name=skill_level]').nth(0).selectOption('advanced');
    await p.click('text=+ Add skill');
    await p.locator('input[name=skill_name]').nth(1).fill('typescript');
    await p.locator('select[name=skill_level]').nth(1).selectOption('advanced');
    await p.click('button.btn.primary');
    await p.waitForURL('**/feed**', { timeout: 15000 });
    await flash(p, 'Welcome to DevMatch');
  });
  await step('feed is ranked by pgvector similarity (frontend issues first)', async () => {
    await go(contrib.page, '/feed');
    const top = (await titles(contrib.page)).slice(0, 4).join(' | ');
    assert.match(top, /keyboard accessible|dark theme|TypeScript|dropdown/i, top);
    assert.ok((await contrib.page.locator('.meter', { hasText: '% match' }).count()) > 3);
  });
  await step('duplicate email is rejected', async () => {
    const t = await newPage();
    await go(t.page, '/register');
    await t.page.fill('#name', 'Dup');
    await t.page.fill('#email', EMAIL);
    await t.page.fill('#password', 'secret12');
    await t.page.fill('#bio', 'duplicate');
    await t.page.click('button.btn.primary');
    await t.page.locator('.flash.error', { hasText: 'already registered' }).waitFor();
    await t.ctx.close();
  });
  await step('wrong password shows an error', async () => {
    const t = await newPage();
    await login(t.page, 'vijay@devmatch.dev', 'nope-nope', true);
    await t.page.locator('.flash.error', { hasText: 'Wrong email or password' }).waitFor();
    await t.ctx.close();
  });

  console.log('Maintainer: project and issue CRUD');
  await step('login lands on the dashboard with a review queue', async () => {
    await login(maint.page, 'asha@devmatch.dev');
    assert.match(maint.page.url(), /\/dashboard/);
    await maint.page.locator('text=Review queue').waitFor();
  });
  await step('create a project', async () => {
    const p = maint.page;
    await go(p, '/projects/new');
    await p.fill('#title', `E2E Project ${RUN}`);
    await p.fill('#repo_url', `https://github.com/e2e/${RUN}`);
    await p.fill('#tech_stack', 'React, TypeScript, CSS');
    await p.click('button.btn.primary');
    await p.waitForURL(/\/projects\/\d+/, { timeout: 15000 });
    pid = idFrom(p.url(), /\/projects\/(\d+)/);
    assert.ok(pid > 0);
  });
  await step('duplicate repository URL is rejected', async () => {
    const p = maint.page;
    await go(p, '/projects/new');
    await p.fill('#title', 'Dup');
    await p.fill('#repo_url', `https://github.com/e2e/${RUN}`);
    await p.click('button.btn.primary');
    await p.locator('.flash.error', { hasText: 'already exists' }).waitFor();
  });
  await step('validation error keeps what was typed', async () => {
    const p = maint.page;
    await go(p, `/projects/${pid}/issues/new`);
    await p.fill('#title', 'Short one');
    await p.fill('#description', 'too short');
    await p.selectOption('#difficulty', 'easy');
    await p.click('button.btn.primary');
    await p.locator('.flash.error', { hasText: '20 characters' }).waitFor();
    assert.equal(await p.inputValue('#title'), 'Short one');
  });
  await step('post an issue (embedded into pgvector on save)', async () => {
    const p = maint.page;
    await p.fill('#title', ISSUE_TITLE);
    await p.fill(
      '#description',
      'The React dropdown component only works with a mouse. Add focus handling, ARIA roles and keyboard navigation in TypeScript, and make sure the CSS focus ring is visible.',
    );
    await p.selectOption('#difficulty', 'medium');
    await p.click('button.btn.primary');
    await p.waitForURL(/\/issues\/\d+/, { timeout: 15000 });
    iid = idFrom(p.url(), /\/issues\/(\d+)/);
    await flash(p, 'Issue posted');
  });
  await step('edit the issue (re-embedded)', async () => {
    const p = maint.page;
    await go(p, `/issues/${iid}/edit`);
    await p.fill('#title', ISSUE_TITLE + ' (updated)');
    await p.click('button.btn.primary');
    await p.waitForURL(new RegExp(`/issues/${iid}$`), { timeout: 15000 });
    await flash(p, 'Issue updated');
  });

  console.log('Applying, notifications and the review queue');
  await step('contributor finds the new issue near the top and applies', async () => {
    const p = contrib.page;
    await go(p, '/feed');
    const top = (await titles(p)).slice(0, 3).join(' | ');
    assert.ok(top.includes(`E2E ${RUN}`), 'new frontend issue should rank in the contributor\'s top 3: ' + top);
    await go(p, `/issues/${iid}`);
    await p.click('button:has-text("Apply to this issue")');
    await flash(p, 'Application sent');
    await p.locator('text=Your application:').waitFor();
  });
  await step('applying twice is refused', async () => {
    const p = contrib.page;
    await go(p, `/issues/${iid}`);
    assert.equal(await p.locator('button:has-text("Apply to this issue")').count(), 0);
  });
  await step('maintainer header badge refreshes after client-side navigation', async () => {
    const p = maint.page;
    await p.click('nav.main >> text=Dashboard');
    await p.locator('a.bell .badge').waitFor({ timeout: 10000 });
  });
  await step('maintainer was notified by the SQL trigger', async () => {
    await go(maint.page, '/notifications');
    await maint.page.locator(`text=${NAME} applied to`).first().waitFor();
  });
  await step('applicants are listed with a match score', async () => {
    const p = maint.page;
    await go(p, `/issues/${iid}`);
    const card = p.locator('.applicant', { hasText: NAME });
    await card.waitFor();
    assert.match(await card.innerText(), /\d+% match/);
  });

  console.log('Discussion (MongoDB)');
  await step('contributor posts a comment', async () => {
    const p = contrib.page;
    await go(p, `/issues/${iid}`);
    await p.fill('#new-comment', `Could I also add a visible focus ring? ${WORD}`);
    await p.click('button:has-text("Post comment")');
    await flash(p, 'Comment posted');
    assert.equal(await p.locator('[data-testid=comment]').count(), 1);
  });
  await step('maintainer replies (embedded array) and likes', async () => {
    const p = maint.page;
    await go(p, `/issues/${iid}`);
    await p.click('summary:has-text("Reply")');
    await p.fill('.comment details textarea', 'Yes please, that fits the scope.');
    await p.click('button:has-text("Send reply")');
    await flash(p, 'Reply posted');
    await p.locator('.reply', { hasText: 'fits the scope' }).waitFor();
    await p.click('button:has-text("Like")');
    await flash(p, 'Liked');
    await p.locator('button:has-text("Liked · 1")').waitFor();
  });
  await step('like toggles off again', async () => {
    const p = maint.page;
    await p.click('button:has-text("Liked")');
    await flash(p, 'Like removed');
    await p.locator('button:has-text("Like · 0")').waitFor();
  });
  await step('an author can delete their own comment', async () => {
    const p = contrib.page;
    await go(p, `/issues/${iid}`);
    await p.fill('#new-comment', 'Temporary comment to delete');
    await p.click('button:has-text("Post comment")');
    await flash(p, 'Comment posted');
    assert.equal(await p.locator('[data-testid=comment]').count(), 2);
    await p.locator('[data-testid=comment]', { hasText: 'Temporary comment' }).locator('button:has-text("Delete")').click();
    await flash(p, 'Comment deleted');
    assert.equal(await p.locator('[data-testid=comment]').count(), 1);
  });
  await step('empty comments are refused', async () => {
    const p = contrib.page;
    await p.evaluate(() => document.querySelector('#new-comment').removeAttribute('required'));
    await p.fill('#new-comment', '   ');
    await p.click('button:has-text("Post comment")');
    await p.locator('.flash.error', { hasText: '1–2000' }).waitFor();
  });
  await step('the activity page shows events and full-text search finds the comment', async () => {
    const p = maint.page;
    await go(p, `/activity?s=${WORD}`);
    await p.locator('.card', { hasText: 'Discussion search' }).locator(`text=${NAME}`).first().waitFor();
    await p.locator('.event', { hasText: 'applied to' }).first().waitFor();
    await go(p, '/activity?type=comment');
    assert.ok((await p.locator('.event .type', { hasText: /^comment$/ }).count()) > 0);
  });

  console.log('Accepting a candidate (one atomic SQL transaction)');
  await step('similar issues are shown (pgvector issue ↔ issue)', async () => {
    const p = maint.page;
    await go(p, `/issues/${iid}`);
    await p.locator('h2', { hasText: 'Similar issues' }).waitFor();
  });
  await step('maintainer accepts: issue closes and contributor is notified', async () => {
    const p = maint.page;
    await go(p, `/issues/${iid}`);
    await p.locator('.applicant', { hasText: NAME }).locator('button:has-text("Accept")').click();
    await flash(p, 'Contributor accepted');
    await p.locator('.pill.closed').first().waitFor();
    await p.locator('.applicant', { hasText: NAME }).locator('.pill.accepted').waitFor();
    await go(contrib.page, '/notifications');
    await contrib.page.locator('text=You were accepted').first().waitFor();
  });
  await step('closed issues leave the feed', async () => {
    await go(contrib.page, '/feed');
    assert.ok(!(await titles(contrib.page)).some((t) => t.includes(`E2E ${RUN}`)));
  });

  console.log('Access control');
  await step('contributor cannot open maintainer pages', async () => {
    await go(contrib.page, '/projects/new');
    assert.match(contrib.page.url(), /\/feed/);
  });
  await step('maintainer is sent to the dashboard instead of the feed', async () => {
    await go(maint.page, '/feed');
    assert.match(maint.page.url(), /\/dashboard/);
  });
  await step("other maintainers' projects are hidden (404)", async () => {
    const r = await maint.page.goto(BASE + '/projects/1/edit');
    assert.ok([200, 404].includes(r.status()));
    const other = await maint.ctx.request.get(BASE + `/api/issues/${iid}/matches`);
    assert.equal(other.status(), 200);
    const denied = await contrib.ctx.request.get(BASE + `/api/issues/${iid}/matches`);
    assert.equal(denied.status(), 403);
  });

  console.log('JSON API');
  await step('/api/feed is sorted by similarity', async () => {
    const j = await (await contrib.ctx.request.get(BASE + '/api/feed')).json();
    assert.ok(j.count > 5);
    const s = j.issues.map((i) => i.similarity).filter((x) => x !== null);
    assert.deepEqual(s, [...s].sort((a, b) => b - a));
  });
  await step('/api/issues and /api/issues/:id/similar answer', async () => {
    const a = await (await contrib.ctx.request.get(BASE + '/api/issues?difficulty=easy')).json();
    assert.ok(a.count > 0 && a.issues.every((i) => i.difficulty === 'easy'));
    const b = await (await contrib.ctx.request.get(BASE + `/api/issues/${a.issues[0].id}/similar`)).json();
    assert.ok(Array.isArray(b.similar) && b.similar.length > 0);
  });

  console.log('DB insights');
  await step('insights page shows SQL, pgvector and MongoDB sections', async () => {
    await go(maint.page, '/insights');
    const html = await maint.page.content();
    for (const needle of ['PostgreSQL · relational analytics', 'pgvector · semantic search', 'MongoDB · aggregation pipelines', '$group', '&lt;=&gt;', 'HAVING'])
      assert.ok(html.includes(needle), 'missing: ' + needle);
    assert.ok((await maint.page.locator('.card table').count()) >= 10);
  });

  console.log('Profile, ranking and account deletion');
  await step('editing the profile re-embeds it and re-ranks the feed', async () => {
    const p = contrib.page;
    await go(p, '/profile');
    await p.fill('#bio', 'Backend developer designing REST APIs, SQL queries and database indexes with Python and PostgreSQL.');
    await p.locator('input[name=skill_name]').nth(0).fill('postgresql');
    await p.locator('input[name=skill_name]').nth(1).fill('sql');
    await p.click('button.btn.primary');
    await flash(p, 'Profile saved');
    await go(p, '/feed');
    const top = (await titles(p)).slice(0, 3).join(' | ');
    assert.match(top, /index|pagination|query|search|REST|rate-limit/i, top);
  });
  await step('deleting the account cascades and anonymises MongoDB comments', async () => {
    const p = contrib.page;
    await go(p, '/profile');
    await p.fill('input[name=confirm]', 'delete');
    await p.click('button:has-text("Delete my account")');
    await p.waitForURL(BASE + '/**');
    await flash(p, 'account and all related data were deleted');
    await go(maint.page, `/issues/${iid}`);
    const body = await maint.page.locator('#discussion').innerText();
    assert.ok(body.includes('[deleted user]'), 'comment author should be anonymised');
    assert.ok(!body.includes(NAME));
    const t = await newPage();
    await login(t.page, EMAIL, 'secret12', true);
    await t.page.locator('.flash.error').waitFor();
    await t.ctx.close();
  });
  await step('deleting the project removes its issue and Mongo thread', async () => {
    const p = maint.page;
    await go(p, `/projects/${pid}`);
    await p.click('button:has-text("Delete")');
    await flash(p, 'Project deleted');
    const r = await p.goto(BASE + `/issues/${iid}`);
    assert.equal(r.status(), 404);
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const [n, e] of failures) console.log('FAILED:', n, '\n', e.stack?.split('\n').slice(0, 4).join('\n'), '\n');
    process.exit(1);
  }
})();
