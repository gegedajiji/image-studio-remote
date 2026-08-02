import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistAvatar } from "./avatarService";

let testDir: string | undefined;

afterEach(async () => {
  delete process.env.AVATAR_DIR;
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("avatar persistence", () => {
  it("stores a valid PNG avatar", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-avatar-"));
    process.env.AVATAR_DIR = testDir;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("avatar-fixture"),
    ]);

    const publicUrl = await persistAvatar(
      `data:image/png;base64,${png.toString("base64")}`,
      12
    );
    const stored = await readFile(path.join(testDir, path.basename(publicUrl)));

    expect(publicUrl).toMatch(/^\/avatars\/12-[a-f0-9-]+\.png$/);
    expect(stored).toEqual(png);
  });

  it("rejects mismatched image content", async () => {
    await expect(
      persistAvatar(
        `data:image/png;base64,${Buffer.from("not-an-image").toString("base64")}`,
        12
      )
    ).rejects.toThrow("头像图片内容无效");
  });
});
