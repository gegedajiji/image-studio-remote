import { env } from "./lib/env";

type VerificationEmail = {
  to: string;
  code: string;
};

type EmailRequestOptions = {
  timeoutMs?: number;
};

const RESEND_EMAIL_URL = "https://api.resend.com/emails";
const DEFAULT_EMAIL_TIMEOUT_MS = 12_000;

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

async function sendVerificationCodeEmail(
  input: VerificationEmail & {
    subject: string;
    heading: string;
    description: string;
    textAction: string;
  },
  options: EmailRequestOptions = {}
) {
  if (!env.resendApiKey || !env.resendFrom) {
    throw new Error("邮件服务尚未配置，请联系管理员");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_EMAIL_TIMEOUT_MS
  );
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
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#1e293b">
            <h1 style="font-size:22px;margin:0 0 18px">${input.heading}</h1>
            <p style="font-size:14px;line-height:1.8;color:#475569">${input.description}</p>
            <div style="margin:24px 0;padding:18px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;color:#0f172a">${input.code}</div>
            <p style="font-size:13px;line-height:1.7;color:#64748b">验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>
          </div>
        `,
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("邮件服务请求超时，请稍后重试");
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
