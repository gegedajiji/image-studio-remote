import { describe, expect, it } from "vitest";
import {
  registrationInputSchema,
  sendRegistrationCodeInputSchema,
} from "./auth-router";

describe("registration email contract", () => {
  it("normalizes the email used to request a code", () => {
    expect(
      sendRegistrationCodeInputSchema.parse({ email: " Creator@Example.COM " })
    ).toEqual({ email: "creator@example.com" });
  });

  it("accepts the existing name field with a six-digit code", () => {
    expect(
      registrationInputSchema.parse({
        name: " Creator ",
        email: "Creator@Example.COM",
        password: "password-123",
        code: "123456",
      })
    ).toMatchObject({
      name: "Creator",
      email: "creator@example.com",
      code: "123456",
    });
  });

  it("rejects registration without a valid email code", () => {
    expect(
      registrationInputSchema.safeParse({
        name: "Creator",
        email: "creator@example.com",
        password: "password-123",
      }).success
    ).toBe(false);
    expect(
      registrationInputSchema.safeParse({
        name: "Creator",
        email: "creator@example.com",
        password: "password-123",
        code: "12345a",
      }).success
    ).toBe(false);
  });
});
