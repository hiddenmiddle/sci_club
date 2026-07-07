/* Admin session auth: HMAC-SHA256-signed cookie + bcrypt password checks.
   Token format: base64url(JSON payload) + "." + hex hmac.
   Payload: { email, exp } — exp in ms since epoch. */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const COOKIE_NAME = 'vpc_admin';
const SESSION_DAYS = 7;

// Compared against when the email is unknown, so both paths cost one bcrypt compare.
const DUMMY_HASH = '$2b$12$pahRNNWEAxcSeTI1scaFSOs63HPnfsjKmrNoa8ubvdMt5RdmN5NBe';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not configured');
  return s;
}

function hmac(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

export function createSessionToken(email) {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 864e5 })
  ).toString('base64url');
  return payload + '.' + hmac(payload);
}

/** Returns the payload { email, exp } or null. */
export function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof data.email !== 'string' || typeof data.exp !== 'number') return null;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Extracts and verifies the session from a Request; returns payload or null. */
export function sessionFromRequest(req) {
  const header = req.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? verifySessionToken(match[1]) : null;
}

/** Constant-cost password check: unknown email still burns one bcrypt compare. */
export async function checkPassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH).then(ok => ok && !!hash);
}

/** Constant-time string equality (for setup secret). */
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
