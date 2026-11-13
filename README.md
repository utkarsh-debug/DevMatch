# DevMatch – Semantic Contributor-to-Issue Matching

Next.js 15 + PostgreSQL/pgvector (SQL + vector DB) + MongoDB (NoSQL). Full project report: `REPORT.md` / `DevMatch_Report.docx`.
Students: VIJAY SURIYA .P (PES1UG24AM320), UTKARSH KUMAR (PES1UG24AM310).

## Run
```bash
docker compose up -d            # PostgreSQL+pgvector on :5432, MongoDB on :27017
cp .env.example .env            # defaults already match docker-compose
npm install
npm run db:reset                # creates schema, indexes, validators and seed data in BOTH databases
npm run dev                     # http://localhost:3000
```
Demo logins (password `password123`): `asha@devmatch.dev` (maintainer), `vijay@`, `neha@`, `ishaan@` (contributors, `@devmatch.dev`).

## Database command references
```bash
psql "$DATABASE_URL" -f db/queries.sql          # SQL
psql "$DATABASE_URL" -f db/vector-commands.sql  # pgvector
mongosh "$MONGODB_URI/devmatch" --file db/mongo-init.js
mongosh "$MONGODB_URI/devmatch" --file db/mongo-commands.js
```
## Tests
`npm test` (needs `TEST_DATABASE_URL`, `TEST_MONGODB_URI`); end to end: `npm run build && npm start`, then `BASE_URL=http://localhost:3000 npm run test:e2e`.

## Embeddings
`EMBEDDER=auto` (default) uses MiniLM if `@huggingface/transformers` is installed and the model can be downloaded, otherwise falls back to a deterministic 384-d hash embedder (the tested path). Force it with `EMBEDDER=hash|minilm`; run `npm run db:reindex` after switching.
