/* POST /api/admin/login — verify credentials, set the signed session cookie. */
import { sql } from './_lib/db.mjs';
import { checkPassword, createSessionToken, sessionCookie } from './_lib/auth.mjs';

export const config = { path: '/api/admin/login' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('{"error":"method_not_allowed"}', { status: 405 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return new Response('{"error":"invalid_credentials"}', { status: 401 });
  }

  const rows = await sql`SELECT * FROM admins WHERE email = ${email}`;
  const admin = rows[0];
  const ok = await checkPassword(password, admin?.password_hash);

  if (!ok) {
    await new Promise(r => setTimeout(r, 400)); // blunt brute-force a little
    return new Response('{"error":"invalid_credentials"}', { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true, name: admin.name }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': sessionCookie(createSessionToken(admin.email)),
      'cache-control': 'no-store',
    },
  });
}
