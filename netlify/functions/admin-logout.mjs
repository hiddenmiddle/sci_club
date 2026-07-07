/* POST /api/admin/logout — clear the session cookie. */
import { clearSessionCookie } from './_lib/auth.mjs';

export const config = { path: '/api/admin/logout' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('{"error":"method_not_allowed"}', { status: 405 });
  return new Response('{"ok":true}', {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': clearSessionCookie() },
  });
}
