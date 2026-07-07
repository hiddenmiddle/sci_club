# Membership System — Implementation Plan

**Goal:** Join → registration form → Stripe **$15 USD/month** subscription → Telegram invite emailed on payment. All members + payment history in **Netlify Database** (native, GA since April 2026). Admin dashboard with two personal logins (Alex + Vika). Tested first on a password-protected `staging` branch deploy with Stripe **test mode**, then promoted to `main`.

## Architecture

- Static pages (no framework, same dark aesthetic) published from `site/`.
- **Netlify Functions v2** (ESM `Request`/`Response`) under `netlify/functions/`, routes declared via `export const config = { path: "/api/..." }`.
- **Netlify Database**: `@netlify/database` package (`getDatabase()` → `db.sql` tagged templates). Schema lives in raw-SQL migrations in `netlify/database/migrations/` — applied automatically on every deploy. **Deploy-context DB branching is automatic**: production deploys hit the main DB, the staging branch deploy gets an isolated branch with copied production data. No connection strings to manage.
- **Stripe Checkout** (mode=subscription) hosts all payment UI; a webhook keeps the DB in sync.
- **Gmail + app password** (nodemailer) sends the Telegram invite after successful payment.

## Files

```
netlify.toml                        publish="site", functions dir
package.json                        type:module; deps: @netlify/database, stripe, bcryptjs, nodemailer
.gitignore                          + .env*, node_modules/, .netlify/
scripts/hash-password.mjs           local bcrypt hash generator
netlify/database/migrations/
  20260707000000_membership_init.sql   members, payments, admins, webhook_events
netlify/functions/_lib/db.mjs       getDatabase() wrapper
netlify/functions/_lib/auth.mjs     HMAC cookie sign/verify, bcrypt
netlify/functions/_lib/mail.mjs     Gmail transport, welcome email
netlify/functions/register.mjs         POST /api/register
netlify/functions/stripe-webhook.mjs   POST /api/stripe-webhook
netlify/functions/admin-login.mjs      POST /api/admin/login
netlify/functions/admin-logout.mjs     POST /api/admin/logout
netlify/functions/admin-data.mjs       GET  /api/admin/data
netlify/functions/setup.mjs            POST /api/setup  (admin seeding, SETUP_SECRET-gated)
site/club.css                       shared tokens + form styles
site/join.html                      registration form
site/success.html                   post-checkout page
site/admin.html                     login + dashboard
site/index.html                     CTAs → join.html, price shown, WhatsApp → secondary link
```

## Database schema

- **members**: id, email UNIQUE (lowercased), name, telegram_handle, background, referral_source, motivation, country, city, stripe_customer_id UNIQUE, stripe_subscription_id, status (`pending_payment|active|past_due|canceled`), welcome_email_sent_at, created_at, updated_at
- **payments**: id, member_id FK (nullable), stripe_event_id UNIQUE, stripe_invoice_id, stripe_customer_id, amount_cents, currency, status (`paid|failed`), event_type, paid_at, created_at
- **admins**: id, email UNIQUE, name, password_hash (bcrypt)
- **webhook_events**: id (Stripe evt id) PK — idempotency ledger (Stripe retries for 3 days)

## Flow details

**register** — validate fields; email exists & active/past_due → 409 "already a member"; pending/canceled → refresh row, reuse Stripe customer; else insert `pending_payment`. Create Checkout Session ($15/mo price via `STRIPE_PRICE_ID`, `client_reference_id` = member id, success → `/success.html`, cancel → `/join.html?canceled=1`; origin taken from the request URL so staging works). Return `{url}`, page redirects to Stripe.

**stripe-webhook** — verify signature over the **raw body**; record event id (replay → 200 immediately). Events: `checkout.session.completed` → member active + **send Telegram-invite email once** (`welcome_email_sent_at` guard; email failure logged, never 500s); `invoice.paid` → payment row + active; `invoice.payment_failed` → failed row + past_due; `customer.subscription.updated/deleted` → status sync. Members resolved by `stripe_customer_id` (stable across Stripe API versions).

**admin** — login: bcrypt compare (dummy compare for unknown emails), HttpOnly/Secure/SameSite=Lax HMAC-signed cookie, 7 days; data: cookie check → `{members, payments}` JSON, no-store; logout clears cookie.

**setup** — 404 unless `SETUP_SECRET` env set; header must match; upserts the two admins from `ADMIN{1,2}_EMAIL/_PASSWORD_HASH` env vars. Delete `SETUP_SECRET` after seeding → endpoint dead.

## Environment variables (Netlify UI → per deploy context)

| Var | Production | Branch deploy (staging) |
|---|---|---|
| STRIPE_SECRET_KEY | sk_live_… | sk_test_… |
| STRIPE_WEBHOOK_SECRET | live whsec_… | test whsec_… |
| STRIPE_PRICE_ID | live price_… | test price_… |
| SESSION_SECRET | random 32 bytes | different random |
| SETUP_SECRET | random — **delete after seeding** | same policy |
| ADMIN1_EMAIL / ADMIN1_PASSWORD_HASH | Alex | same |
| ADMIN2_EMAIL / ADMIN2_PASSWORD_HASH | Vika | same |
| GMAIL_USER / GMAIL_APP_PASSWORD | sending Gmail + app password | same |
| TELEGRAM_INVITE_LINK | real group invite | test link |

(Database needs **no** env var — `@netlify/database` resolves the right DB branch per deploy context automatically.)

## Setup checklist — Alex

**Netlify** (paid plan): ① `npx netlify database init` once (or Project → Database in the UI); ② enable branch deploys for `staging` (Build & deploy → Branches); ③ Site protection → password-protect branch deploys; ④ enter the env-var table above with per-context values.

**Stripe** (Vika's account — see her checklist below): enter the keys/IDs she provides; after staging deploys, add webhook endpoints (test mode → `https://staging--<site>.netlify.app/api/stripe-webhook`, live mode → production URL) selecting events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`; copy each endpoint's `whsec_…` into the env vars.

**Seeding**: generate hashes locally (`node scripts/hash-password.mjs '<password>'`), set env vars, then `curl -X POST <staging-url>/api/setup -H "x-setup-secret: <SETUP_SECRET>"`. Repeat on production after go-live, then delete SETUP_SECRET.

## Verification (staging, Stripe test mode)

1. Browser (behind staging password): join form → Checkout with card `4242 4242 4242 4242` → success page.
2. Webhooks: Netlify's password wall blocks Stripe's POSTs to staging — test webhook handling locally with `netlify dev` + `stripe listen --forward-to localhost:8888/api/stripe-webhook` (this is expected, not a bug; production has no password so live webhooks work normally).
3. Check DB (`netlify database connect --query "SELECT ..."`): member active, paid payment row, welcome email received.
4. Decline card `4000 0000 0000 0002` → member stays pending; duplicate active email → 409; replayed event → one payment row; cancel test subscription → member canceled.
5. Both admin logins work; wrong password → 401; `/api/admin/data` without cookie → 401.
6. Merge → main; add live webhook; production smoke test with a real card, then cancel + refund in Stripe.

---

## Что нужно от Вики (Stripe и Gmail — её аккаунты)

Вика, привет! Мы подключаем к сайту клуба регистрацию с оплатой ($15/мес через Stripe), базу участников и админ-панель. От тебя нужно вот что:

**Stripe (dashboard.stripe.com):**
1. Создай продукт: Product catalog → **Add product** → название «Vika's Physics Club Membership», цена **$15.00 USD, recurring / monthly**. Скопируй и пришли **Price ID** (начинается с `price_…`).
2. Переключись в **Test mode** (тумблер сверху справа) и создай там точно такой же продукт → пришли **тестовый Price ID** тоже.
3. Developers → API keys: пришли **Secret key** из live-режима (`sk_live_…`) и из test-режима (`sk_test_…`). ⚠️ Не по почте/чату в открытом виде желательно — лучше через менеджер паролей или самоудаляющееся сообщение.
4. (Рекомендую) Settings → Emails → включи чеки об успешных платежах (receipts).
5. Позже, когда тестовая версия сайта поднимется, понадобится добавить два webhook-эндпоинта — я пришлю точные URL и список событий, это 2 минуты. Либо просто добавь Алекса в команду Stripe (Settings → Team) с правами Developer — тогда он сделает всё сам.

**Gmail (почта, с которой клуб будет отправлять приглашения в Telegram):**
1. У аккаунта должна быть включена двухфакторная аутентификация (2-Step Verification).
2. Зайди на myaccount.google.com → Security → **App passwords** → создай пароль приложения (имя, например, «physics club site») → пришли **16-значный код** и сам **адрес почты**.

**Ещё два пункта:**
1. **Ссылка-приглашение в Telegram-группу** клуба (invite link) — её будем автоматически отправлять оплатившим.
2. Придумай **пароль для админ-панели** сайта (там будет список участников и платежи; вход у нас с Алексом раздельный) и передай его Алексу — в базу попадёт только хеш, сам пароль нигде храниться не будет.

Итого прислать: live Price ID, test Price ID, `sk_live_…`, `sk_test_…`, адрес Gmail + app password, Telegram invite link, свой пароль для админки.
