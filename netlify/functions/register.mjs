/* POST /api/register — store/refresh the member row, then create a Stripe
   Checkout Session ($15/month subscription) and return its URL. */
import Stripe from 'stripe';
import { sql } from './_lib/db.mjs';

export const config = { path: '/api/register' };

const MAX = { name: 200, email: 320, telegram_handle: 100, country: 120, city: 120,
              background: 2000, referral_source: 500, motivation: 2000 };

function clean(body, field, required) {
  const v = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!v && required) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  return v.slice(0, MAX[field]);
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // Honeypot: bots that fill the hidden field get a fake success and no side effects.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ url: '/success.html' });
  }

  let fields;
  try {
    fields = {
      name: clean(body, 'name', true),
      email: clean(body, 'email', true).toLowerCase(),
      telegram_handle: clean(body, 'telegram_handle', true),
      country: clean(body, 'country', true),
      city: clean(body, 'city', false),
      background: clean(body, 'background', false),
      referral_source: clean(body, 'referral_source', false),
      motivation: clean(body, 'motivation', false),
    };
  } catch (e) {
    return json({ error: 'validation', message: e.message }, e.status || 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    return json({ error: 'validation', message: 'Please enter a valid email address.' }, 400);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const existing = await sql`SELECT * FROM members WHERE email = ${fields.email}`;
    let member = existing[0];

    if (member && (member.status === 'active' || member.status === 'past_due')) {
      return json({ error: 'already_member' }, 409);
    }

    if (member) {
      // Re-registration after an abandoned checkout or a canceled membership:
      // refresh the details, keep the Stripe customer.
      const rows = await sql`
        UPDATE members SET
          name = ${fields.name}, telegram_handle = ${fields.telegram_handle},
          country = ${fields.country}, city = ${fields.city},
          background = ${fields.background}, referral_source = ${fields.referral_source},
          motivation = ${fields.motivation}, status = 'pending_payment', updated_at = now()
        WHERE id = ${member.id} RETURNING *`;
      member = rows[0];
    } else {
      const rows = await sql`
        INSERT INTO members (email, name, telegram_handle, country, city,
                             background, referral_source, motivation)
        VALUES (${fields.email}, ${fields.name}, ${fields.telegram_handle},
                ${fields.country}, ${fields.city}, ${fields.background},
                ${fields.referral_source}, ${fields.motivation})
        ON CONFLICT (email) DO UPDATE SET updated_at = now()
        RETURNING *`;
      member = rows[0];
    }

    let customerId = member.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: fields.email,
        name: fields.name,
        metadata: { member_id: String(member.id) },
      });
      customerId = customer.id;
      await sql`UPDATE members SET stripe_customer_id = ${customerId}, updated_at = now()
                WHERE id = ${member.id}`;
    }

    const origin = new URL(req.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: String(member.id),
      subscription_data: { metadata: { member_id: String(member.id) } },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/join.html?canceled=1`,
      allow_promotion_codes: true,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('register failed:', e);
    return json({ error: 'server_error', message: 'Something went wrong — please try again.' }, 500);
  }
}
