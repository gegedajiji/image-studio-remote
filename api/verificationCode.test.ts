import { describe, expect, it } from "vitest";
import {
  generateVerificationCode,
  getVerificationSendLimit,
  hashRegistrationVerificationCode,
  hashVerificationCode,
  maskEmail,
  normalizeVerificationEmail,
  VERIFICATION_CODE_COOLDOWN_MS,
  verifyVerificationCode,
  verifyRegistrationVerificationCode,
} from "./verificationCode";

describe("email verification codes", () => {
  it("generates six numeric digits", () => {
    expect(generateVerificationCode()).toMatch(/^\d{6}$/);
  });

  it("binds a code hash to its user", () => {
    const hash = hashVerificationCode(7, "123456");

    expect(verifyVerificationCode(7, "123456", hash)).toBe(true);
    expect(verifyVerificationCode(8, "123456", hash)).toBe(false);
    expect(verifyVerificationCode(7, "654321", hash)).toBe(false);
  });

  it("binds registration codes to a normalized email and purpose", () => {
    const hash = hashRegistrationVerificationCode(
      " Creator@Example.COM ",
      "123456"
    );

    expect(
      verifyRegistrationVerificationCode("creator@example.com", "123456", hash)
    ).toBe(true);
    expect(
      verifyRegistrationVerificationCode("other@example.com", "123456", hash)
    ).toBe(false);
    expect(hash).not.toBe(hashVerificationCode(7, "123456"));
    expect(normalizeVerificationEmail(" Creator@Example.COM ")).toBe(
      "creator@example.com"
    );
  });

  it("enforces cooldown before the hourly limit", () => {
    const now = new Date("2026-08-03T00:00:00.000Z");
    expect(
      getVerificationSendLimit(
        new Date(now.getTime() - VERIFICATION_CODE_COOLDOWN_MS + 1),
        5,
        now
      )
    ).toBe("cooldown");
    expect(
      getVerificationSendLimit(
        new Date(now.getTime() - VERIFICATION_CODE_COOLDOWN_MS),
        5,
        now
      )
    ).toBe("hourly");
    expect(getVerificationSendLimit(undefined, 4, now)).toBeNull();
  });

  it("masks recipient addresses", () => {
    expect(maskEmail("creator@example.com")).toBe("cr*****@example.com");
  });
});
