-- =====================================================================
--  DevMatch — pgvector command reference (vector database features inside PostgreSQL)
--      psql "$DATABASE_URL" -f db/vector-commands.sql
-- =====================================================================
\set ON_ERROR_STOP on
\pset null '∅'

\echo '== 1. Extension and vector columns =='
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
SELECT table_name, column_name, udt_name
  FROM information_schema.columns WHERE udt_name = 'vector' ORDER BY table_name;
SELECT 'issues' AS "table", COUNT(*) AS vectors, MIN(vector_dims(embedding)) AS dims FROM issues WHERE embedding IS NOT NULL
UNION ALL
SELECT 'user_embeddings', COUNT(*), MIN(vector_dims(embedding)) FROM user_embeddings;

\echo '== 2. Literal vectors and the three distance operators =='
SELECT '[1,0,0]'::vector <=> '[1,1,0]'::vector  AS cosine_distance,
       '[1,0,0]'::vector <-> '[1,1,0]'::vector  AS l2_distance,
       '[1,2,3]'::vector <#> '[4,5,6]'::vector  AS negative_inner_product;

\echo '== 3. Vector arithmetic and norms =='
SELECT vector_norm('[3,4]'::vector) AS norm,
       '[1,2,3]'::vector + '[4,5,6]'::vector AS sum,
       vector_dims('[1,2,3]'::vector) AS dims;

\echo '== 4. k-nearest-neighbour: top issues for one contributor (cosine similarity) =='
SELECT u.name AS contributor, i.title AS issue,
       ROUND((1 - (i.embedding <=> ue.embedding))::numeric, 3) AS similarity
  FROM user_embeddings ue
  JOIN users u  ON u.id = ue.user_id
  JOIN issues i ON i.status = 'open'
 WHERE u.email = 'vijay@devmatch.dev'
 ORDER BY i.embedding <=> ue.embedding
 LIMIT 5;

\echo '== 5. Reverse search: best contributors for one issue =='
SELECT u.name AS contributor,
       ROUND((1 - (ue.embedding <=> i.embedding))::numeric, 3) AS similarity
  FROM issues i
  JOIN user_embeddings ue ON TRUE
  JOIN users u ON u.id = ue.user_id
 WHERE i.title = 'Speed up the slow search query with a database index'
 ORDER BY ue.embedding <=> i.embedding
 LIMIT 5;

\echo '== 6. Issue <-> issue: nearest neighbours (the "similar issues" panel) =='
SELECT j.title AS similar_issue,
       ROUND((1 - (j.embedding <=> i.embedding))::numeric, 3) AS similarity
  FROM issues i JOIN issues j ON j.id <> i.id
 WHERE i.title = 'Add pagination to the /items REST endpoint'
 ORDER BY j.embedding <=> i.embedding
 LIMIT 4;

\echo '== 7. Aggregates over vectors: the centroid of all contributor profiles =='
SELECT vector_dims(avg(embedding)) AS centroid_dims FROM user_embeddings;
SELECT i.title, ROUND((1 - (i.embedding <=> (SELECT avg(embedding) FROM user_embeddings)))::numeric, 3) AS closeness_to_community
  FROM issues i ORDER BY i.embedding <=> (SELECT avg(embedding) FROM user_embeddings) LIMIT 3;

\echo '== 8. Approximate-nearest-neighbour index (ivfflat) =='
SELECT indexname, indexdef FROM pg_indexes WHERE indexname IN ('idx_issues_embedding', 'idx_user_embeddings');
SHOW ivfflat.probes;
-- how the index would be created / tuned:
--   CREATE INDEX idx_issues_embedding ON issues USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--   SET ivfflat.probes = 10;      -- more probes = better recall, slower
--   (an HNSW index is the alternative:  USING hnsw (embedding vector_cosine_ops))

\echo '== 9. Query plan for a nearest-neighbour search (index forced on) =='
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM issues ORDER BY embedding <=> (SELECT embedding FROM issues WHERE id = 1) LIMIT 3;
RESET enable_seqscan;

\echo '== 10. Dimension safety: a wrong-sized vector is rejected =='
BEGIN;
SAVEPOINT s;
\set ON_ERROR_STOP off
INSERT INTO issues (project_id, title, description, difficulty, embedding) VALUES (1, 't', 'd', 'easy', '[1,2,3]');
ROLLBACK TO SAVEPOINT s;
\set ON_ERROR_STOP on
ROLLBACK;
