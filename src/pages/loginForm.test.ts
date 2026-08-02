import { describe, expect, it } from "vitest";
import {
  normalizeRegistrationEmail,
  sanitizeVerificationCode,
  validateLoginSubmission,
  validateRegistrationSubmission,
} from "./loginForm";

describe("login form helpers", () => {
  it("normalizes email before sending or submitting", () => {
    expect(normalizeRegistrationEmail("  User@Example.COM ")).toBe(
      "user@example.com"
    );
  });

  it("keeps only the first six verification-code digits", () => {
    expect(sanitizeVerificationCode("12a 34-5678")).toBe("123456");
  });

  it("returns light-toast-ready messages for invalid login values", () => {
    expect(validateLoginSubmission("not-an-email", "12345678")).toBe(
      "请输入有效邮箱"
    );
    expect(validateLoginSubmission("user@example.com", "short")).toBe(
      "密码至少需要 8 位"
    );
  });

  it("requires a matching password and six-digit code to register", () => {
    const values = {
      name: "测试用户",
      email: "user@example.com",
      password: "password123",
      confirmPassword: "password456",
      code: "123456",
    };
    expect(validateRegistrationSubmission(values)).toBe("两次输入的密码不一致");
    expect(
      validateRegistrationSubmission({
        ...values,
        confirmPassword: values.password,
        code: "12345",
      })
    ).toBe("请输入 6 位邮箱验证码");
    expect(
      validateRegistrationSubmission({
        ...values,
        confirmPassword: values.password,
      })
    ).toBeNull();
  });
});
