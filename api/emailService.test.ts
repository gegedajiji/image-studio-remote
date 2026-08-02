import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/env", () => ({
  env: {
    resendApiKey: "re_test_key",
    resendFrom: "Mirage AI <noreply@example.com>",
  },
}));

import {
  sendPasswordCodeEmail,
  sendRegistrationCodeEmail,
} from "./emailService";

describe("Resend password email", () => {
  beforeEach(() => vi.restoreAllMocks());

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
