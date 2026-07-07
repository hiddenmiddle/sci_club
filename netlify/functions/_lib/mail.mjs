/* Welcome email with the Telegram invite link, sent via Gmail (app password). */
import nodemailer from 'nodemailer';

let transport;

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transport;
}

export async function sendWelcomeEmail({ to, name }) {
  const invite = process.env.TELEGRAM_INVITE_LINK;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !invite) {
    throw new Error('Email is not configured (GMAIL_USER / GMAIL_APP_PASSWORD / TELEGRAM_INVITE_LINK)');
  }
  const firstName = (name || '').trim().split(/\s+/)[0] || 'there';
  await getTransport().sendMail({
    from: `"Vika's Physics Club" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Welcome to Vika's Physics Club — your Telegram invite",
    text:
`Hi ${firstName},

Welcome to Vika's Physics Club! Your membership is active.

Join our Telegram group here: ${invite}

We meet weekly (~1.5h). Our current book is "Visual Complex Functions" by Elias Wegert — bring curiosity, everything else is provided.

See you inside,
Alex & Vika`,
    html:
`<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222">
  <h2 style="color:#7b6cf6">Welcome to Vika's Physics Club!</h2>
  <p>Hi ${firstName},</p>
  <p>Your membership is active. Join our Telegram group — that's where everything happens:</p>
  <p style="text-align:center;margin:28px 0">
    <a href="${invite}" style="background:#7b6cf6;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Join the Telegram group</a>
  </p>
  <p>We meet weekly (~1.5&nbsp;hours). Current book: <em>Visual Complex Functions</em> by Elias Wegert &mdash; bring curiosity, everything else is provided.</p>
  <p>See you inside,<br>Alex &amp; Vika</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
  <p style="font-size:12px;color:#888">Your payment receipt arrives separately from Stripe. You can cancel your membership anytime — just reply to this email.</p>
</div>`,
  });
}
