import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Upstream } from "@db/schema";
import {
  callUpstream,
  decodeReferenceImageDataUrl,
  MAX_REFERENCE_IMAGE_DATA_URL_LENGTH,
  persistGeneratedImage,
} from "./imageService";

let testDir: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.GENERATED_IMAGE_DIR;
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = undefined;
});

const upstream: Upstream = {
  id: 1,
  legacyId: null,
  name: "OpenAI fixture",
  provider: "openai",
  baseUrl: "https://images.example.test/v1/",
  apiKey: "test-key",
  model: "gpt-image-2",
  enabled: true,
  priority: 100,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("reference-png"),
]);
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from("reference-jpeg"),
]);
const webp = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.alloc(4),
  Buffer.from("WEBP"),
  Buffer.from("reference-webp"),
]);

function dataUrl(mimeType: string, buffer: Buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function imageResponse(url = "https://cdn.example.test/result.png") {
  return new Response(JSON.stringify({ data: [{ url }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("generated image persistence", () => {
  it("writes a data URL to the generated image directory", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;

    const publicUrl = await persistGeneratedImage(
      `data:image/png;base64,${Buffer.from("png-fixture").toString("base64")}`
    );
    const stored = await readFile(path.join(testDir, path.basename(publicUrl)));

    expect(publicUrl).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    expect(stored.toString()).toBe("png-fixture");
  });

  it("rejects unsupported data URLs", async () => {
    await expect(
      persistGeneratedImage("data:text/plain;base64,SGVsbG8=")
    ).rejects.toThrow("不支持的图片数据格式");
  });
});

describe("reference image validation", () => {
  it.each([
    ["image/png", png, "png"],
    ["image/jpeg", jpeg, "jpg"],
    ["image/webp", webp, "webp"],
  ] as const)("accepts a valid %s image", (mimeType, image, extension) => {
    const decoded = decodeReferenceImageDataUrl(dataUrl(mimeType, image));

    expect(decoded.mimeType).toBe(mimeType);
    expect(decoded.extension).toBe(extension);
    expect(decoded.buffer).toEqual(image);
  });

  it("rejects a MIME type that does not match the image signature", () => {
    expect(() =>
      decodeReferenceImageDataUrl(dataUrl("image/jpeg", png))
    ).toThrow("参考图内容无效");
  });

  it("rejects malformed base64", () => {
    expect(() =>
      decodeReferenceImageDataUrl("data:image/png;base64,iVBORw0KGgo= =")
    ).toThrow("请选择 PNG、JPG 或 WebP 图片");
  });

  it("rejects decoded images larger than 10 MB", () => {
    const oversized = Buffer.concat([
      png.subarray(0, 8),
      Buffer.alloc(10 * 1024 * 1024),
    ]);

    expect(() =>
      decodeReferenceImageDataUrl(dataUrl("image/png", oversized))
    ).toThrow("参考图不能超过 10 MB");
  });

  it("rejects data URLs longer than 14 MiB before decoding", () => {
    const oversizedDataUrl = `data:image/png;base64,${"A".repeat(
      MAX_REFERENCE_IMAGE_DATA_URL_LENGTH
    )}`;

    expect(() => decodeReferenceImageDataUrl(oversizedDataUrl)).toThrow(
      "参考图数据不能超过 14 MB"
    );
  });
});

describe("upstream request format", () => {
  it("keeps text-to-image requests on the JSON generations endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(imageResponse());

    await callUpstream(upstream, {
      prompt: "a quiet lake",
      negativePrompt: "text",
      width: 1024,
      height: 1536,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://images.example.test/v1/images/generations");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-image-2",
      prompt: "a quiet lake",
      negative_prompt: "text",
      size: "1024x1536",
      n: 1,
      response_format: "url",
    });
  });

  it("sends image-to-image requests as multipart edits", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(imageResponse());
    const referenceImage = decodeReferenceImageDataUrl(
      dataUrl("image/png", png)
    );

    await callUpstream(upstream, {
      prompt: "turn this into watercolor",
      negativePrompt: "letters",
      width: 2400,
      height: 2080,
      referenceImage,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://images.example.test/v1/images/edits");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-key"
    );
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    expect(init?.body).toBeInstanceOf(FormData);

    const form = init?.body as FormData;
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.get("prompt")).toBe(
      "turn this into watercolor\n\nAvoid these elements: letters"
    );
    expect(form.get("size")).toBe("2400x2080");
    expect(form.get("n")).toBe("1");
    expect(form.get("response_format")).toBe("url");

    const image = form.get("image") as File;
    expect(image.name).toBe("reference.png");
    expect(image.type).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(png);
  });
});
