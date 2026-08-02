import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "./lib/env";

export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000;
export const VERIFICATION_CODE_COOLDOWN_MS = 60 * 1000;
export const VERIFICATION_CODE_HOURLY_LIMIT = 5;
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
export const VERIFICATION_CODE_RETENTION_MS = 24 * 60 * 60 * 1000;

export function generateVerificationCode() {
  return randomInt(100000, 1000000).toString();
}

export function hashVerificationCode(userId: number, code: string) {
  return hashScopedVerificationCode(`password_change:${userId}`, code);
}

export function verifyVerificationCode(
  userId: number,
  code: string,
  storedHash: string
) {
  const actual = Buffer.from(hashVerificationCode(userId, code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeVerificationEmail(email: string) {
  return email.trim().toLowerCase();
}

export function hashRegistrationVerificationCode(email: string, code: string) {
  return hashScopedVerificationCode(
    `registration:${normalizeVerificationEmail(email)}`,
    code
  );
}

export function verifyRegistrationVerificationCode(
  email: string,
  code: string,
  storedHash: string
) {
  const actual = Buffer.from(
    hashRegistrationVerificationCode(email, code),
    "hex"
  );
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function getVerificationSendLimit(
  latestCreatedAt: Date | undefined,
  recentCount: number,
  now: Date
): "cooldown" | "hourly" | null {
  if (
    latestCreatedAt &&
    now.getTime() - latestCreatedAt.getTime() < VERIFICATION_CODE_COOLDOWN_MS
  ) {
    return "cooldown";
  }
  if (recentCount >= VERIFICATION_CODE_HOURLY_LIMIT) return "hourly";
  return null;
}

function hashScopedVerificationCode(scope: string, code: string) {
  return createHmac("sha256", env.appSecret)
    .update(`${scope}:${code}`)
    .digest("hex");
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}
