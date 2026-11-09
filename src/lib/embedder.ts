/**
 * Text -> 384-dimensional vector. Used for BOTH contributors and issues so that they live in
 * the same vector space (matches the vector(384) columns in PostgreSQL / pgvector).
 *
 * Backends
 *   minilm : all-MiniLM-L6-v2 through @huggingface/transformers (384-d neural sentence embeddings).
 *            Optional: `npm i @huggingface/transformers` — the model is downloaded on first use.
 *   hash   : dependency-free fallback. Signed feature hashing of words/bigrams into 384 dimensions
 *            plus "topic" dimensions so related technologies (react ~ frontend ~ typescript,
 *            docker ~ kubernetes ~ devops ...) land close together even without exact word overlap.
 *
 * EMBEDDER=auto (default) -> minilm if available, otherwise hash.   EMBEDDER=hash | minilm forces one.
 * Vectors from different backends are NOT comparable: after switching run `npm run db:reindex`.
 */
import { createHash } from 'node:crypto';

export const DIM = 384;

// ------------------------------------------------------------------ hash backend
const STOP = new Set(
  `a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that
these those i we you they he she them our your their my me us not no yes can could should would will may might do does
did done have has had having just also more most some any all each other such than too very so into over under about
up down out off new need needs needed want wants like use used using add adds added make makes made get gets got work
works working help helps please issue project code should currently currently currently support supports able
beginner intermediate advanced skills skill experience experienced`.split(/\s+/),
);

// topic -> related terms. A token found in a group also activates that group's own dimension.
const CONCEPTS: Record<string, string> = {
  backend:
    'backend server api rest restful graphql endpoint endpoints middleware python django flask fastapi node nodejs express java spring golang go ruby rails php laravel microservice grpc auth authentication jwt oauth session',
  frontend:
    'frontend javascript typescript js ts react vue angular svelte css html tailwind sass component components responsive accessibility a11y dom browser nextjs webpack vite ui ux dark theme layout',
  mobile: 'mobile android ios flutter dart kotlin swift reactnative app apps widget widgets',
  ml: 'ml ai machine learning deep pytorch tensorflow keras numpy pandas sklearn scikit model models training dataset datasets neural nlp transformer transformers data notebook jupyter embedding embeddings inference gpu cuda llm',
  devops:
    'devops docker dockerfile kubernetes k8s ci cd github actions terraform ansible deployment deploy helm pipeline pipelines linux bash shell infrastructure cloud aws gcp azure container containers compose nginx monitoring prometheus grafana',
  systems:
    'systems rust c cpp c++ memory performance compiler kernel embedded concurrency threads thread async unsafe lowlevel allocator parser benchmark optimisation optimization simd',
  database:
    'database databases db sql postgres postgresql mysql sqlite query queries index indexes migration migrations orm schema redis mongodb nosql transaction transactions pgvector',
  docs: 'docs documentation readme tutorial tutorials writing translation translations typo typos guide guides examples docstring docstrings wiki contributing changelog',
  testing: 'test tests testing pytest jest unittest integration coverage qa bug bugs fix flaky regression mock mocks ci',
  security:
    'security vulnerability vulnerabilities xss csrf injection encryption cryptography audit sanitize sanitization password hashing tls ssl cve',
  games: 'game games gamedev unity godot opengl vulkan graphics rendering shader shaders engine sprite physics',
  cli: 'cli terminal commandline tooling argparse click flags prompt tui',
};

const SYN: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  k8s: 'kubernetes',
  postgresql: 'postgres',
  pg: 'postgres',
  nodejs: 'node',
  golang: 'go',
  reactjs: 'react',
  vuejs: 'vue',
};

function stem(w: string): string {
  for (const suf of ['ing', 'ed', 'es', 's']) {
    if (w.length > suf.length + 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

const TOKEN_GROUPS = new Map<string, Set<string>>();
for (const [group, words] of Object.entries(CONCEPTS)) {
  for (const w of words.split(/\s+/)) {
    const s = stem(w);
    if (!TOKEN_GROUPS.has(s)) TOKEN_GROUPS.set(s, new Set());
    TOKEN_GROUPS.get(s)!.add(group);
  }
}

function h(s: string): [number, number] {
  const d = createHash('md5').update(s, 'utf8').digest();
  return [d.readUInt32LE(0) % DIM, d[4] & 1 ? 1 : -1];
}

function tokens(text: string): string[] {
  const t = text.toLowerCase().replaceAll('node.js', 'nodejs').replaceAll('c++', 'cpp').replaceAll('c#', 'csharp');
  const out: string[] = [];
  for (let tok of t.match(/[a-z][a-z0-9+#]*/g) ?? []) {
    tok = SYN[tok] ?? tok;
    if (STOP.has(tok) || tok.length < 2) continue;
    out.push(stem(tok));
  }
  return out;
}

function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}

export function embedHash(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const toks = tokens(text);
  const counts = new Map<string, number>();
  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [t, c] of counts) {
    const w = 1 + Math.log(c);
    let [i, s] = h('w:' + t);
    vec[i] += s * w;
    for (const g of TOKEN_GROUPS.get(t) ?? []) {
      [i, s] = h('topic:' + g);
      vec[i] += s * 1.6 * w;
    }
  }
  for (let k = 0; k + 1 < toks.length; k++) {
    const [i, s] = h('b:' + toks[k] + '_' + toks[k + 1]);
    vec[i] += s * 0.4;
  }
  return normalise(vec);
}

// ---------------------------------------------------------------- minilm backend
type Backend = 'minilm' | 'hash';
let backend: Backend | undefined;
let extractor: any;
let picking: Promise<void> | undefined;

async function pickBackend(): Promise<void> {
  const want = (process.env.EMBEDDER ?? 'auto').toLowerCase();
  if (want === 'auto' || want === 'minilm') {
    try {
      const mod = '@huggingface/transformers'; // optional dependency, resolved at runtime only
      const { pipeline } = await import(/* webpackIgnore: true */ mod);
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      backend = 'minilm';
      return;
    } catch (e) {
      if (want === 'minilm') throw e;
    }
  }
  backend = 'hash';
}

export async function backendName(): Promise<Backend> {
  if (!backend) {
    picking ??= pickBackend();
    await picking;
  }
  return backend!;
}

/** Returns an L2-normalised 384-d vector. */
export async function embed(text: string): Promise<number[]> {
  const clean = (text ?? '').trim() || 'empty';
  if ((await backendName()) === 'minilm') {
    const out = await extractor(clean, { pooling: 'mean', normalize: true });
    return Array.from(out.data as Float32Array, (x) => Number(x));
  }
  return embedHash(clean);
}

/** Format for a Postgres  $1::vector  parameter. */
export function toPgVector(vec: number[]): string {
  return '[' + vec.map((x) => x.toFixed(6)).join(',') + ']';
}
