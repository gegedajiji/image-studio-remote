import { beforeEach, describe, expect, it, vi } from "vitest";

const { envFixture, createTransportMock } = vi.hoisted(() => ({
  envFixture: {
    emailProvider: "resend" as "auto" | "smtp" | "resend",
    resendApiKey: "re_test_key",
    resendFrom: "Mirage AI <noreply@example.com>",
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: "",
    smtpPassword: "",
    smtpFrom: "",
    emailTimeoutMs: 12_000,
  },
  createTransportMock: vi.fn(),
}));

vi.mock("./lib/env", () => ({ env: envFixture }));
vi.mock("nodemailer", () => ({ createTransport: createTransportMock }));

import {
  emailServiceStatus,
  sendPasswordCodeEmail,
  sendRegistrationCodeEmail,
} from "./emailService";

describe("verification email delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envFixture.emailProvider = "resend";
    envFixture.resendApiKey = "re_test_key";
    envFixture.resendFrom = "Mirage AI <noreply@example.com>";
    envFixture.smtpHost = "";
    envFixture.smtpUser = "";
    envFixture.smtpPassword = "";
    envFixture.smtpFrom = "";
  });

  it("sends the verification code through Resend", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email_1" }), { status: 200 })
      );

    await sendPasswordCodeEmail({ to: "user@example.com", code: "123456" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.html).toContain("123456");
    expect(body.text).toContain("123456");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the registration subject and a plain-text fallback", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email_2" }), { status: 200 })
      );

    await sendRegistrationCodeEmail({
      to: "new@example.com",
      code: "654321",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.subject).toBe("幻镜 AI 注册验证码");
    expect(body.text).toContain("注册幻镜 AI 账号");
    expect(body.text).toContain("654321");
    expect(body.html).toContain("注册邮箱验证码");
  });

  it("sends through QQ SMTP with implicit TLS on port 465", async () => {
    envFixture.emailProvider = "smtp";
    envFixture.smtpHost = "smtp.qq.com";
    envFixture.smtpPort = 465;
    envFixture.smtpSecure = true;
    envFixture.smtpUser = "1468186089@qq.com";
    envFixture.smtpPassword = "qq-authorization-code";
    envFixture.smtpFrom = "幻镜 AI <1468186089@qq.com>";
    const sendMail = vi.fn().mockResolvedValue({ messageId: "smtp-1" });
    const close = vi.fn();
    createTransportMock.mockReturnValue({ sendMail, close });

    await sendRegistrationCodeEmail({ to: "new@example.com", code: "654321" });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.qq.com",
        port: 465,
        secure: true,
        requireTLS: false,
        auth: { user: "1468186089@qq.com", pass: "qq-authorization-code" },
      })
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "幻镜 AI <1468186089@qq.com>",
        to: "new@example.com",
        subject: "幻镜 AI 注册验证码",
      })
    );
    expect(close).toHaveBeenCalledOnce();
    expect(emailServiceStatus()).toEqual({ provider: "smtp", configured: true });
  });

  it("enforces the configured timeout and closes a stalled SMTP transport", async () => {
    envFixture.emailProvider = "smtp";
    envFixture.smtpHost = "smtp.qq.com";
    envFixture.smtpUser = "1468186089@qq.com";
    envFixture.smtpPassword = "qq-authorization-code";
    const close = vi.fn();
    createTransportMock.mockReturnValue({
      sendMail: vi.fn(() => new Promise(() => undefined)),
      close,
    });

    await expect(
      sendPasswordCodeEmail(
        { to: "user@example.com", code: "123456" },
        { timeoutMs: 5 }
      )
    ).rejects.toThrow("邮件服务请求超时");
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports an incomplete SMTP setup instead of silently sending nowhere", async () => {
    envFixture.emailProvider = "smtp";
    envFixture.smtpHost = "smtp.qq.com";
    envFixture.smtpUser = "1468186089@qq.com";
    await expect(
      sendPasswordCodeEmail({ to: "user@example.com", code: "123456" })
    ).rejects.toThrow("SMTP_PASSWORD");
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("wraps SMTP authentication failures without exposing credentials", async () => {
    envFixture.emailProvider = "smtp";
    envFixture.smtpHost = "smtp.qq.com";
    envFixture.smtpUser = "1468186089@qq.com";
    envFixture.smtpPassword = "qq-authorization-code";
    createTransportMock.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error("Invalid login: 535 authentication failed")),
      close: vi.fn(),
    });

    await expect(
      sendRegistrationCodeEmail({ to: "new@example.com", code: "654321" })
    ).rejects.toThrow("SMTP 邮件发送失败");
  });

  it("aborts a stalled Resend request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    await expect(
      sendPasswordCodeEmail(
        { to: "user@example.com", code: "123456" },
        { timeoutMs: 5 }
      )
    ).rejects.toThrow("邮件服务请求超时");
  });

  it("includes a bounded Resend error payload for server logs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("sender domain is not verified", { status: 422 })
    );

    await expect(
      sendPasswordCodeEmail({ to: "user@example.com", code: "123456" })
    ).rejects.toThrow("邮件发送失败 (422): sender domain is not verified");
  });
});
