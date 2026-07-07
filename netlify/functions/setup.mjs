/* POST /api/setup — one-time admin seeding, guarded by SETUP_SECRET.
   Upserts the two admin accounts from environment variables; password hashes
   are generated locally with scripts/hash-password.mjs so plaintext passwords
   never reach Netlify. Delete SETUP_SECRET after seeding to disable this
   endpoint entirely (it 404s when the variable is unset). */
import { sql } from './_lib/db.mjs';
import { safeEqual } from './_lib/auth.mjs';

export const config = { path: '/api/setup' };

export default async function handler(req) {
  const secret = process.env.SETUP_SECRET;
  if (!secret) return new Response('not found', { status: 404 });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!safeEqual(req.headers.get('x-setup-secret') || '', secret)) {
    return new Response('forbidden', { status: 403 });
  }

  const admins = [
    { email: process.env.ADMIN1_EMAIL, name: process.env.ADMIN1_NAME || 'Alex', hash: process.env.ADMIN1_PASSWORD_HASH },
    { email: process.env.ADMIN2_EMAIL, name: process.env.ADMIN2_NAME || 'Vika', hash: process.env.ADMIN2_PASSWORD_HASH },
  ];

  const seeded = [];
  for (const a of admins) {
    if (!a.email || !a.hash) continue;
    const email = a.email.trim().toLowerCase();
    await sql`
      INSERT INTO admins (email, name, password_hash)
      VALUES (${email}, ${a.name}, ${a.hash})
      ON CONFLICT (email) DO UPDATE SET name = ${a.name}, password_hash = ${a.hash}`;
    seeded.push(email);
  }

  return new Response(JSON.stringify({ ok: true, seeded }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
