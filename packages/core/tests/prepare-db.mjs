import { Pool } from 'pg';

const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.pathname !== '/deskroute_test') {
  throw new Error('Test fixtures require the local deskroute_test database');
}
const pool = new Pool({ connectionString: target.toString(), max: 1 });
try {
  // Migration 0004 imports legacy accounts from Supabase Auth; plain Postgres needs this empty fixture.
  await pool.query('CREATE SCHEMA IF NOT EXISTS auth');
  await pool.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text)');
} finally { await pool.end(); }
