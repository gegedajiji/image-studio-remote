import { describe, expect, it } from "vitest";
import { hash as hashBcrypt } from "bcryptjs";
import {
  getLocalRegistrationDefaults,
  getLocalUserInsertValues,
  hashPassword,
  verifyPassword,
} from "./localAuth";

describe("local registration defaults", () => {
  it.each([
    [0, "admin"],
    [1, "user"],
    [25, "user"],
  ] as const)(
    "creates a zero-credit %s-user account with the expected role",
    (userCount, role) => {
      expect(getLocalRegistrationDefaults(userCount)).toEqual({
        role,
        quota: 0,
      });
    }
  );

  it("normalizes verified registration values", () => {
    const values = getLocalUserInsertValues(
      { name: "  Creator  ", email: " Creator@Example.COM " },
      "password-hash",
      1
    );

    expect(values.name).toBe("Creator");
    expect(values.email).toBe("creator@example.com");
    expect(values.role).toBe("user");
    expect(values.quota).toBe(0);
    expect(values.unionId).toMatch(/^local:/);
  });
});

describe("local password authentication", () => {
  it("stores a salted hash and verifies the original password", async () => {
    const hash = await hashPassword("a-strong-password");

    expect(hash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    await expect(verifyPassword("a-strong-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("uses a unique salt for each password", async () => {
    const first = await hashPassword("same-password");
    const second = await hashPassword("same-password");

    expect(first).not.toBe(second);
  });

  it("accepts legacy bcrypt password hashes", async () => {
    const hash = await hashBcrypt("legacy-password", 4);

    await expect(verifyPassword("legacy-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
