-- Membership system: members, payment history, admins, webhook idempotency ledger.

CREATE TABLE IF NOT EXISTS members (
  id                     BIGSERIAL PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  telegram_handle        TEXT NOT NULL,
  background             TEXT,
  referral_source        TEXT,
  motivation             TEXT,
  country                TEXT,
  city                   TEXT,
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending_payment',
  welcome_email_sent_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                 BIGSERIAL PRIMARY KEY,
  member_id          BIGINT REFERENCES members(id) ON DELETE SET NULL,
  stripe_event_id    TEXT UNIQUE,
  stripe_invoice_id  TEXT,
  stripe_customer_id TEXT,
  amount_cents       INTEGER,
  currency           TEXT,
  status             TEXT NOT NULL,
  event_type         TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_member_idx ON payments(member_id);
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments(stripe_customer_id);

CREATE TABLE IF NOT EXISTS admins (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
