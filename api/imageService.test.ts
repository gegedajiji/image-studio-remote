import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Upstream } from "@db/schema";
import {
  callUpstream,
  callUpstreamWithFallback,
  decodeReferenceImageDataUrl,
  MAX_REFERENCE_IMAGE_DATA_URL_LENGTH,
  persistGeneratedImage,
  persistGeneratedImageUrl,
  resolveGeneratedImageDimensions,
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

const image25Models = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;

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

function pngWithDimensions(width: number, height: number) {
  const image = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
  image.writeUInt32BE(13, 8);
  image.write("IHDR", 12, "ascii");
  image.writeUInt32BE(width, 16);
  image.writeUInt32BE(height, 20);
  image[24] = 8;
  image[25] = 6;
  return image;
}

function dataUrl(mimeType: string, buffer: Buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function imageResponse() {
  // Keep request-format tests independent of a second CDN fetch. The remote
  // URL persistence path is covered by its dedicated test above.
  return new Response(
    JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("generated image persistence", () => {
  it("writes a data URL to the generated image directory", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;

    const publicUrl = await persistGeneratedImage(dataUrl("image/png", png));
    const stored = await readFile(path.join(testDir, path.basename(publicUrl)));

    expect(publicUrl).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    expect(stored).toEqual(png);
  });

  it("rejects image data with an invalid signature", async () => {
    await expect(
      persistGeneratedImage(
        `data:image/png;base64,${Buffer.from("not-a-png").toString("base64")}`
      )
    ).rejects.toThrow("无效的图片数据");
  });

  it("downloads and stores a remote image instead of retaining its expiring URL", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(png, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );

    const publicUrl = await persistGeneratedImageUrl(
      "https://cdn.example.test/temporary.png"
    );
    expect(publicUrl).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    await expect(
      readFile(path.join(testDir, path.basename(publicUrl)))
    ).resolves.toEqual(png);
  });

  it("rejects unsupported data URLs", async () => {
    await expect(
      persistGeneratedImage("data:text/plain;base64,SGVsbG8=")
    ).rejects.toThrow("不支持的图片数据格式");
  });

  it("accepts unpadded and URL-safe base64 returned by gateways", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    const encoded = png
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const publicUrl = await persistGeneratedImage(
      `DATA:IMAGE/PNG;BASE64,${encoded}`
    );
    await expect(
      readFile(path.join(testDir, path.basename(publicUrl)))
    ).resolves.toEqual(png);
  });

  it("blocks private hosts when caching a remote image", async () => {
    await expect(
      persistGeneratedImageUrl("http://127.0.0.1/secret.png")
    ).rejects.toThrow("不安全");
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
      quality: "high",
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

  it.each(image25Models)(
    "passes %s unchanged to JSON generations requests",
    async model => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(imageResponse());

      await callUpstream(
        { ...upstream, model },
        {
          prompt: "a quiet lake",
          width: 1536,
          height: 1024,
        }
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://images.example.test/v1/images/generations");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model,
        size: "1536x1024",
        quality: "high",
      });
    }
  );

  it.each(image25Models)(
    "passes %s unchanged to multipart edits requests",
    async model => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(imageResponse());
      const referenceImage = decodeReferenceImageDataUrl(
        dataUrl("image/png", png)
      );

      await callUpstream(
        { ...upstream, model },
        {
          prompt: "turn this into watercolor",
          width: 1536,
          height: 1024,
          referenceImage,
        }
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://images.example.test/v1/images/edits");
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("model")).toBe(model);
      expect(form.get("size")).toBe("1536x1024");
      expect(form.get("quality")).toBe("high");
    }
  );

  it("stores a Flare data URL response and returns its generated path", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    const renderedPng = pngWithDimensions(1370, 1148);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: dataUrl("image/png", renderedPng) }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const result = await callUpstream(
      { ...upstream, model: "gpt-image-2.5-flare" },
      {
        prompt: "a quiet lake",
        width: 1536,
        height: 1024,
      }
    );

    expect(result.imageUrl).toMatch(/^\/generated\/[a-f0-9-]+\.png$/);
    expect(result).toMatchObject({ width: 1370, height: 1148 });
    await expect(
      readFile(path.join(testDir, path.basename(result.imageUrl)))
    ).resolves.toEqual(renderedPng);
  });

  it("returns PNG dimensions from a b64_json response", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    const renderedPng = pngWithDimensions(1024, 1536);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ b64_json: renderedPng.toString("base64") }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const result = await callUpstream(
      { ...upstream, model: "gpt-image-2.5-sunburst" },
      { prompt: "a portrait", width: 1536, height: 1024 }
    );

    expect(result).toMatchObject({ width: 1024, height: 1536 });
  });

  it("returns PNG dimensions after caching a remote response", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    const renderedPng = pngWithDimensions(1536, 1024);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ url: "https://cdn.example.test/adaptive.png" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(renderedPng, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      );

    const result = await callUpstream(
      { ...upstream, model: "gpt-image-2.5-flare" },
      { prompt: "a landscape", width: 1536, height: 1024 }
    );

    expect(result).toMatchObject({ width: 1536, height: 1024 });
  });

  it("leaves dimensions unset for non-PNG output", async () => {
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: dataUrl("image/jpeg", jpeg) }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const result = await callUpstream(upstream, {
      prompt: "a photo",
      width: 1024,
      height: 1024,
    });

    expect(result.imageUrl).toMatch(/\.jpg$/);
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(resolveGeneratedImageDimensions(result, 1024, 1024)).toEqual({
      width: 1024,
      height: 1024,
    });
    expect(
      resolveGeneratedImageDimensions(
        { imageUrl: result.imageUrl, width: 512 },
        1024,
        1024
      )
    ).toEqual({ width: 1024, height: 1024 });
  });

  it("falls back to the next upstream after a transient failure", async () => {
    const first: Upstream = {
      ...upstream,
      id: 1,
      name: "primary",
      priority: 100,
    };
    const second: Upstream = {
      ...upstream,
      id: 2,
      name: "backup",
      priority: 90,
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    testDir = await mkdtemp(path.join(tmpdir(), "mirage-image-"));
    process.env.GENERATED_IMAGE_DIR = testDir;

    const result = await callUpstreamWithFallback([first, second], {
      prompt: "a quiet lake",
      width: 1024,
      height: 1024,
    });

    expect(result.upstream.id).toBe(2);
    expect(result.result.imageUrl).toMatch(/^\/generated\//);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
