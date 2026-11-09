import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.EMBEDDER = process.env.EMBEDDER ?? 'hash';

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe('embedder', async () => {
  const { embed, embedHash, toPgVector, DIM, backendName } = await import('@/lib/embedder');

  it('produces 384-dimensional unit vectors', async () => {
    const v = await embed('Backend developer building REST APIs with Python and PostgreSQL');
    assert.equal(v.length, DIM);
    assert.equal(DIM, 384);
    assert.ok(Math.abs(Math.sqrt(v.reduce((s, x) => s + x * x, 0)) - 1) < 1e-9);
  });

  it('is deterministic', () => {
    assert.deepEqual(embedHash('react typescript css'), embedHash('react typescript css'));
  });

  it('ranks related text above unrelated text', async () => {
    const dev = await embed('Backend developer designing REST APIs with Python, FastAPI and PostgreSQL. Skills: sql (advanced)');
    const sqlIssue = await embed('Speed up the slow search query with a database index. Add a PostgreSQL migration.');
    const reactIssue = await embed('Make the dropdown keyboard accessible in the React component with TypeScript and CSS.');
    const gameIssue = await embed('Implement shadow mapping in the OpenGL renderer with GLSL shaders.');
    assert.ok(cosine(dev, sqlIssue) > cosine(dev, reactIssue));
    assert.ok(cosine(dev, sqlIssue) > cosine(dev, gameIssue));
  });

  it('puts related technologies close together even without shared words', () => {
    const k8s = embedHash('kubernetes manifests');
    const docker = embedHash('docker containers');
    const flutter = embedHash('flutter widgets');
    assert.ok(cosine(k8s, docker) > cosine(k8s, flutter));
  });

  it('formats vectors for pgvector', () => {
    const s = toPgVector([0.5, -0.25, 0]);
    assert.equal(s, '[0.500000,-0.250000,0.000000]');
  });

  it('reports the active backend', async () => {
    assert.ok(['hash', 'minilm'].includes(await backendName()));
  });
});
