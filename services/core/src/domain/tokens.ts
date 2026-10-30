import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** "BT-" + 4 Crockford base32 characters, e.g. BT-7K2Q */
export function newReference(): string {
  const b = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += CROCKFORD[b[i]! & 31];
  return `BT-${s}`;
}

/** 32 random bytes, base64url. Only its sha256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
