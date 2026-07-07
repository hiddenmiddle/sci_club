/* POST /api/stripe-webhook — keeps members/payments in sync with Stripe.
   Signature is verified over the RAW request body; events are deduplicated
   through the webhook_events ledger (Stripe retries for up to 3 days).
   Members are resolved by stripe_customer_id — stable across Stripe API
   versions (unlike invoice.subscription, which moved in 2025 versions). */
import Stripe from 'stripe';
import { sql } from './_lib/db.mjs';
import { sendWelcomeEmail } from './_lib/mail.mjs';

export const config = { path: '/api/stripe-webhook' };

async function memberByCustomer(customerId) {
  if (!customerId) return null;
  const rows = await sql`SELECT * FROM members WHERE stripe_customer_id = ${customerId}`;
  return rows[0] || null;
}

async function setStatus(memberId, status) {
  await sql`UPDATE members SET status = ${status}, updated_at = now() WHERE id = ${memberId}`;
}

async function recordPayment(event, invoice, status, memberId) {
  const paidAtUnix = invoice.status_transitions?.paid_at || event.created;
  await sql`
    INSERT INTO payments (member_id, stripe_event_id, stripe_invoice_id, stripe_customer_id,
                          amount_cents, currency, status, event_type, paid_at)
    VALUES (${memberId}, ${event.id}, ${invoice.id}, ${invoice.customer ?? null},
            ${status === 'paid' ? invoice.amount_paid : invoice.amount_due},
            ${invoice.currency}, ${status}, ${event.type},
            ${new Date(paidAtUnix * 1000).toISOString()})
    ON CONFLICT (stripe_event_id) DO NOTHING`;
}

const SUB_STATUS_MAP = {
  active: 'active', trialing: 'active',
  past_due: 'past_due', unpaid: 'past_due',
  canceled: 'canceled', incomplete_expired: 'canceled',
  incomplete: 'pending_payment', paused: 'past_due',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('webhook signature verification failed:', e.message);
    return new Response('invalid signature', { status: 400 });
  }

  try {
    // Idempotency: first delivery inserts a row; replays return no row → ack and stop.
    const fresh = await sql`
      INSERT INTO webhook_events (id) VALUES (${event.id})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (fresh.length === 0) return new Response('duplicate', { status: 200 });

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        let member = null;
        if (session.client_reference_id) {
          const rows = await sql`SELECT * FROM members WHERE id = ${Number(session.client_reference_id)}`;
          member = rows[0] || null;
        }
        if (!member) member = await memberByCustomer(session.customer);
        if (!member && session.customer_details?.email) {
          const rows = await sql`SELECT * FROM members WHERE email = ${session.customer_details.email.toLowerCase()}`;
          member = rows[0] || null;
        }
        if (!member) {
          console.error('checkout.session.completed: no matching member', session.id);
          break;
        }
        await sql`
          UPDATE members SET
            status = 'active',
            stripe_customer_id = COALESCE(stripe_customer_id, ${session.customer ?? null}),
            stripe_subscription_id = ${typeof session.subscription === 'string' ? session.subscription : member.stripe_subscription_id},
            updated_at = now()
          WHERE id = ${member.id}`;

        if (!member.welcome_email_sent_at) {
          try {
            await sendWelcomeEmail({ to: member.email, name: member.name });
            await sql`UPDATE members SET welcome_email_sent_at = now() WHERE id = ${member.id}`;
          } catch (e) {
            // Never fail the webhook over email; the dashboard shows the missing stamp.
            console.error('welcome email failed for member', member.id, e.message);
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const member = await memberByCustomer(invoice.customer);
        await recordPayment(event, invoice, 'paid', member?.id ?? null);
        if (member) await setStatus(member.id, 'active');
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const member = await memberByCustomer(invoice.customer);
        await recordPayment(event, invoice, 'failed', member?.id ?? null);
        if (member) await setStatus(member.id, 'past_due');
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const member = await memberByCustomer(sub.customer);
        const status = SUB_STATUS_MAP[sub.status];
        if (member && status) {
          await sql`
            UPDATE members SET status = ${status}, stripe_subscription_id = ${sub.id}, updated_at = now()
            WHERE id = ${member.id}`;
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const member = await memberByCustomer(sub.customer);
        if (member) await setStatus(member.id, 'canceled');
        break;
      }

      default:
        break; // unhandled event types are acknowledged
    }

    return new Response('ok', { status: 200 });
  } catch (e) {
    console.error('webhook handler error:', e);
    // Release the dedup row so Stripe's retry can reprocess this event; every
    // handler above is idempotent (payments guard on stripe_event_id, the rest
    // are absolute status updates).
    try { await sql`DELETE FROM webhook_events WHERE id = ${event.id}`; } catch {}
    return new Response('handler error', { status: 500 });
  }
}
