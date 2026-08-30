import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function signingSecret() {
  const value = required("APP_SECRET");
  if (
    process.env.NODE_ENV === "production" &&
    (value.length < 32 || /replace|change.?me|example|your.?secret/i.test(value))
  ) {
    throw new Error(
      "APP_SECRET must be a random production secret with at least 32 characters"
    );
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function integer(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const env = {
  appId: required("APP_ID"),
  appSecret: signingSecret(),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  kimiAuthUrl: process.env.KIMI_AUTH_URL ?? "",
  kimiOpenUrl: process.env.KIMI_OPEN_URL ?? "",
  ownerUnionId: process.env.OWNER_UNION_ID ?? "",
  // SMTP is preferred whenever all required fields are present. Resend remains
  // available as a backwards-compatible provider for existing deployments.
  emailProvider: (process.env.EMAIL_PROVIDER?.trim().toLowerCase() ?? "auto") as
    | "auto"
    | "smtp"
    | "resend",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFrom: process.env.RESEND_FROM ?? "",
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: integer("SMTP_PORT", 465),
  smtpSecure: boolean("SMTP_SECURE", true),
  smtpUser: process.env.SMTP_USER ?? "",
  // Accept the historical SMTP_PASS spelling too. Treat an explicitly empty
  // SMTP_PASSWORD as unset so a compose file that still supplies SMTP_PASS
  // does not silently disable mail delivery.
  smtpPassword:
    process.env.SMTP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim() || "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  emailTimeoutMs: integer("EMAIL_TIMEOUT_MS", 12_000),
  requireEmailVerification: boolean("REQUIRE_EMAIL_VERIFICATION", true),
};
