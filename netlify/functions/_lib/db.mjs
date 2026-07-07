/* Netlify Database access. getDatabase() resolves the correct database branch
   for the current deploy context automatically (production → main DB,
   branch deploys / previews → isolated branches). Schema is managed by the
   raw-SQL migrations in netlify/database/migrations/, applied on deploy. */
import { getDatabase } from '@netlify/database';

let conn;

/** Tagged-template SQL client; `await sql\`SELECT ...\`` resolves to a rows array. */
export function sql(strings, ...values) {
  if (!conn) conn = getDatabase();
  return conn.sql(strings, ...values);
}
