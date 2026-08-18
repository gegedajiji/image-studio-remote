import { describe, expect, it } from "vitest";
import { adminRouter } from "./adminRouter";

describe("admin privacy", () => {
  it("does not expose a cross-user generation history procedure", () => {
    expect(Object.keys(adminRouter._def.procedures)).not.toContain(
      "generations"
    );
  });
});
