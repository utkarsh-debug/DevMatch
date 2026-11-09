/**
 * Create the DevMatch databases.
 *
 *   npm run db:init                 PostgreSQL schema (db/schema.sql) + MongoDB collections/indexes
 *   npm run db:reset                drop everything, recreate, then load demo data
 *   tsx scripts/init-db.ts --reset  drop and recreate only
 */
import './env';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '@/lib/db';
import { closeMongo, dbName, getDb, setupMongo } from '@/lib/mongo';

async function main() {
  const reset = process.argv.includes('--reset');
  const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');

  // ---------------------------------------------------------------- PostgreSQL
  const exists = (await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS e")).rows[0].e as boolean;
  if (exists && !reset) {
    console.log('[postgres] schema already exists (use --reset to drop and recreate it)');
  } else {
    if (exists) {
      console.log('[postgres] dropping existing schema ...');
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    console.log('[postgres] creating tables, indexes, view, triggers and functions from db/schema.sql ...');
    await pool.query(schema);
    console.log('[postgres] done');
  }

  // ------------------------------------------------------------------- MongoDB
  const db = await getDb(); // creates collections, validators and indexes on first use
  if (reset) {
    console.log(`[mongodb] dropping database "${dbName()}" ...`);
    await db.dropDatabase();
    await setupMongo(db);
  }
  const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(`[mongodb] collections ready in "${dbName()}": ${names.join(', ')}`);

  await closeMongo();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
