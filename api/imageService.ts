import type { Upstream } from "@db/schema";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { UpstreamImageError } from "./generationError";

export type GenerateInput = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImage?: ReferenceImage;
};

export type GenerateResult = {
  imageUrl: string;
};

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;

export type ReferenceImage = {
  buffer: Buffer;
  mimeType: keyof typeof IMAGE_TYPES;
  extension: (typeof IMAGE_TYPES)[keyof typeof IMAGE_TYPES];
};

function hasExpectedSignature(
  buffer: Buffer,
  mimeType: keyof typeof IMAGE_TYPES
) {
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

function isBase64Character(code: number) {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f
  );
}

function isStrictBase64(value: string) {
  if (!value.length || value.length % 4 !== 0) return false;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64Character(value.charCodeAt(index))) return false;
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) return false;
  }
  return true;
}

export function decodeReferenceImageDataUrl(dataUrl: string): ReferenceImage {
  if (dataUrl.length > MAX_REFERENCE_IMAGE_DATA_URL_LENGTH) {
    throw new Error("参考图数据不能超过 14 MB");
  }

  const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(dataUrl);
  if (!match) throw new Error("请选择 PNG、JPG 或 WebP 图片");

  const mimeType = match[1] as keyof typeof IMAGE_TYPES;
  const encoded = dataUrl.slice(match[0].length);
  if (!isStrictBase64(encoded)) {
    throw new Error("请选择 PNG、JPG 或 WebP 图片");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.toString("base64") !== encoded) {
    throw new Error("参考图内容无效");
  }
  if (!buffer.length || !hasExpectedSignature(buffer, mimeType)) {
    throw new Error("参考图内容无效");
  }
  if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("参考图不能超过 10 MB");
  }

  return { buffer, mimeType, extension: IMAGE_TYPES[mimeType] };
}

export async function persistGeneratedImage(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(
    dataUrl
  );
  if (!match) throw new Error("上游返回了不支持的图片数据格式");

  const mimeType = match[1] as keyof typeof IMAGE_TYPES;
  const image = Buffer.from(match[2], "base64");
  if (image.length === 0) throw new Error("上游返回了空图片");

  const outputDir = path.resolve(
    process.env.GENERATED_IMAGE_DIR ?? "data/generated"
  );
  await mkdir(outputDir, { recursive: true });
  const filename = `${randomUUID()}.${IMAGE_TYPES[mimeType]}`;
  await writeFile(path.join(outputDir, filename), image);
  return `/generated/${filename}`;
}

/**
 * 调用上游生图服务。
 * - demo: 内置演示上游，返回随机占位图（无需真实 API，便于开箱体验）
 * - openai: OpenAI 兼容的 /images/generations 接口
 */
export async function callUpstream(
  upstream: Upstream,
  input: GenerateInput
): Promise<GenerateResult> {
  if (upstream.provider === "demo") {
    // 演示上游：基于提示词生成稳定随机种子的占位图
    const seed =
      Math.abs(
        [...(input.prompt + Date.now().toString())].reduce(
          (acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0,
          7
        )
      ) % 100000;
    // 模拟生图耗时
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
    return {
      imageUrl: `https://picsum.photos/seed/mj${seed}/${input.width}/${input.height}`,
    };
  }

  if (!upstream.baseUrl) {
    throw new Error("上游未配置 Base URL");
  }

  const base = upstream.baseUrl.replace(/\/+$/, "");
  const url = `${base}/images/${input.referenceImage ? "edits" : "generations"}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const headers: Record<string, string> = {
      ...(upstream.apiKey
        ? { Authorization: `Bearer ${upstream.apiKey}` }
        : {}),
    };
    let body: string | FormData;

    if (input.referenceImage) {
      const form = new FormData();
      const prompt = input.negativePrompt
        ? `${input.prompt}\n\nAvoid these elements: ${input.negativePrompt}`
        : input.prompt;
      form.append("model", upstream.model);
      form.append("prompt", prompt);
      form.append("size", `${input.width}x${input.height}`);
      form.append("n", "1");
      form.append("response_format", "url");
      form.append(
        "image",
        new Blob([Uint8Array.from(input.referenceImage.buffer)], {
          type: input.referenceImage.mimeType,
        }),
        `reference.${input.referenceImage.extension}`
      );
      body = form;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        model: upstream.model,
        prompt: input.prompt,
        ...(input.negativePrompt
          ? { negative_prompt: input.negativePrompt }
          : {}),
        size: `${input.width}x${input.height}`,
        n: 1,
        response_format: "url",
      });
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new UpstreamImageError(resp.status, text.slice(0, 500));
    }

    const data = (await resp.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const first = data.data?.[0];
    if (first?.url) {
      return {
        imageUrl: first.url.startsWith("data:")
          ? await persistGeneratedImage(first.url)
          : first.url,
      };
    }
    if (first?.b64_json) {
      return {
        imageUrl: await persistGeneratedImage(
          `data:image/png;base64,${first.b64_json}`
        ),
      };
    }
    throw new Error("上游未返回图片");
  } finally {
    clearTimeout(timer);
  }
}
