import { createTransport, type Transporter } from "nodemailer";
import { env } from "./lib/env";

type VerificationEmail = {
  to: string;
  code: string;
};

type EmailRequestOptions = {
  timeoutMs?: number;
};

type EmailCopy = VerificationEmail & {
  subject: string;
  heading: string;
  description: string;
  textAction: string;
};

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const DEFAULT_EMAIL_TIMEOUT_MS = 12_000;

class EmailTimeoutError extends Error {
  constructor() {
    super("邮件服务请求超时，请稍后重试");
    this.name = "EmailTimeoutError";
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  );
}

function timeoutFor(options: EmailRequestOptions) {
  return options.timeoutMs ?? env.emailTimeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS;
}

function hasSmtpConfiguration() {
  return Boolean(
    env.smtpHost?.trim() &&
      env.smtpUser?.trim() &&
      env.smtpPassword?.trim() &&
      (env.smtpFrom?.trim() || env.smtpUser?.trim())
  );
}

function hasResendConfiguration() {
  return Boolean(env.resendApiKey?.trim() && env.resendFrom?.trim());
}

function selectedProvider(): "smtp" | "resend" {
  if (env.emailProvider === "smtp") return "smtp";
  if (env.emailProvider === "resend") return "resend";
  return hasSmtpConfiguration() ? "smtp" : "resend";
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmailTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function smtpTransport(timeoutMs: number): Transporter {
  return createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    requireTLS: !env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword,
    },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });
}

async function sendWithSmtp(input: EmailCopy, options: EmailRequestOptions) {
  if (!hasSmtpConfiguration()) {
    throw new Error(
      "QQ SMTP 邮件服务尚未配置，请填写 SMTP_PASSWORD（QQ 邮箱授权码）"
    );
  }

  const timeoutMs = timeoutFor(options);
  const transporter = smtpTransport(timeoutMs);
  try {
    await withTimeout(
      transporter.sendMail({
        from: env.smtpFrom?.trim() || env.smtpUser,
        to: input.to,
        subject: input.subject,
        text: `${input.description}\n\n${input.code}\n\n验证码 10 分钟内有效。若非本人${input.textAction}操作，请忽略此邮件。`,
        html: renderHtml(input),
      }),
      timeoutMs
    );
  } catch (error) {
    if (error instanceof EmailTimeoutError) throw error;
    const detail = error instanceof Error ? error.message.slice(0, 160) : "";
    throw new Error(`SMTP 邮件发送失败${detail ? `: ${detail}` : ""}`);
  } finally {
    transporter.close();
  }
}

function renderHtml(input: EmailCopy) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#1e293b">
      <h1 style="font-size:22px;margin:0 0 18px">${escapeHtml(input.heading)}</h1>
      <p style="font-size:14px;line-height:1.8;color:#475569">${escapeHtml(input.description)}</p>
      <div style="margin:24px 0;padding:18px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;color:#0f172a">${escapeHtml(input.code)}</div>
      <p style="font-size:13px;line-height:1.7;color:#64748b">验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>
    </div>
  `;
}

async function sendWithResend(input: EmailCopy, options: EmailRequestOptions) {
  if (!hasResendConfiguration()) {
    throw new Error("邮件服务尚未配置，请联系管理员");
  }

  const controller = new AbortController();
  const timeoutMs = timeoutFor(options);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(RESEND_EMAIL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: env.resendFrom,
        to: [input.to],
        subject: input.subject,
        text: `${input.description}\n\n${input.code}\n\n验证码 10 分钟内有效。若非本人${input.textAction}操作，请忽略此邮件。`,
        html: renderHtml(input),
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new EmailTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(
      `邮件发送失败 (${response.status})${payload ? `: ${payload.slice(0, 160)}` : ""}`
    );
  }
}

async function sendVerificationCodeEmail(
  input: EmailCopy,
  options: EmailRequestOptions = {}
) {
  const provider = selectedProvider();
  if (provider === "smtp") return sendWithSmtp(input, options);
  return sendWithResend(input, options);
}

export function emailServiceStatus() {
  const provider = selectedProvider();
  return {
    provider,
    configured:
      provider === "smtp" ? hasSmtpConfiguration() : hasResendConfiguration(),
  } as const;
}

export async function sendPasswordCodeEmail(
  input: VerificationEmail,
  options?: EmailRequestOptions
) {
  return sendVerificationCodeEmail(
    {
      ...input,
      subject: "幻镜 AI 修改密码验证码",
      heading: "修改密码验证码",
      description: "你正在修改幻镜 AI 账号密码，本次验证码为：",
      textAction: "修改密码",
    },
    options
  );
}

export async function sendRegistrationCodeEmail(
  input: VerificationEmail,
  options?: EmailRequestOptions
) {
  return sendVerificationCodeEmail(
    {
      ...input,
      subject: "幻镜 AI 注册验证码",
      heading: "注册邮箱验证码",
      description: "你正在注册幻镜 AI 账号，本次验证码为：",
      textAction: "注册账号",
    },
    options
  );
}
