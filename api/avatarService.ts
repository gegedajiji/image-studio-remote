import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

function hasExpectedSignature(buffer: Buffer, mimeType: keyof typeof TYPES) {
  if (mimeType === "image/png") {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  return (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export async function persistAvatar(dataUrl: string, userId: number) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("请选择 PNG、JPG 或 WebP 图片");

  const mimeType = match[1] as keyof typeof TYPES;
  const image = Buffer.from(match[2], "base64");
  if (!image.length || !hasExpectedSignature(image, mimeType)) {
    throw new Error("头像图片内容无效");
  }
  if (image.length > MAX_AVATAR_BYTES) {
    throw new Error("头像图片不能超过 2 MB");
  }

  const outputDir = path.resolve(process.env.AVATAR_DIR ?? "data/avatars");
  await mkdir(outputDir, { recursive: true });
  const filename = `${userId}-${randomUUID()}.${TYPES[mimeType]}`;
  await writeFile(path.join(outputDir, filename), image);
  return `/avatars/${filename}`;
}

export async function removeStoredAvatar(avatar: string | null | undefined) {
  if (!avatar?.startsWith("/avatars/")) return;
  const outputDir = path.resolve(process.env.AVATAR_DIR ?? "data/avatars");
  await unlink(path.join(outputDir, path.basename(avatar))).catch(
    () => undefined
  );
}
