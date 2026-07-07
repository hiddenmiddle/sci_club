#!/usr/bin/env node
/* Generate a bcrypt hash for an admin password, locally:
     node scripts/hash-password.mjs 'the-password'
   Paste the output into the ADMIN{1,2}_PASSWORD_HASH Netlify env var. */
import bcrypt from 'bcryptjs';

const pwd = process.argv[2];
if (!pwd) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}
console.log(bcrypt.hashSync(pwd, 12));
