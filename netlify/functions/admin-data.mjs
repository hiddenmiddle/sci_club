/* GET /api/admin/data — members + payment history for the dashboard.
   Requires a valid session cookie belonging to an existing admin. */
import { sql } from './_lib/db.mjs';
import { sessionFromRequest } from './_lib/auth.mjs';

export const config = { path: '/api/admin/data' };

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('{"error":"method_not_allowed"}', { status: 405 });

  const session = sessionFromRequest(req);
  if (!session) return new Response('{"error":"unauthorized"}', { status: 401 });

  const admins = await sql`SELECT id, email, name FROM admins WHERE email = ${session.email}`;
  if (admins.length === 0) return new Response('{"error":"unauthorized"}', { status: 401 });

  const members = await sql`
    SELECT id, email, name, telegram_handle, background, referral_source, motivation,
           country, city, stripe_customer_id, stripe_subscription_id, status,
           welcome_email_sent_at, created_at, updated_at
    FROM members ORDER BY created_at DESC`;
  const payments = await sql`
    SELECT id, member_id, stripe_invoice_id, stripe_customer_id, amount_cents,
           currency, status, event_type, paid_at, created_at
    FROM payments ORDER BY paid_at DESC NULLS LAST, created_at DESC`;

  return new Response(JSON.stringify({ admin: admins[0].name, members, payments }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
