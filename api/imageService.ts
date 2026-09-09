import type { Upstream } from "@db/schema";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  classifyGenerationFailure,
  UpstreamImageError,
} from "./generationError";

export type GenerateInput = {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImage?: ReferenceImage;
};

export type GenerateResult = {
  imageUrl: string;
  width?: number;
  height?: number;
};

export function resolveGeneratedImageDimensions(
  result: GenerateResult,
  requestedWidth: number,
  requestedHeight: number
) {
  if (
    typeof result.width === "number" &&
    Number.isSafeInteger(result.width) &&
    result.width > 0 &&
    typeof result.height === "number" &&
    Number.isSafeInteger(result.height) &&
    result.height > 0
  ) {
    return { width: result.width, height: result.height };
  }

  return {
    width: requestedWidth,
    height: requestedHeight,
  };
}

const IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REFERENCE_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const GENERATED_IMAGE_FETCH_TIMEOUT_MS = 30_000;

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

/**
 * Decode standard or URL-safe base64 while keeping a strict alphabet and an
 * upper bound on the decoded payload. A few OpenAI-compatible gateways omit
 * trailing padding, so normalising it here avoids rejecting otherwise valid
 * images.
 */
function decodeBase64(
  value: string,
  maxBytes: number,
  invalidMessage: string,
  oversizeMessage = invalidMessage
) {
  const compact = value.replace(/\s+/g, "");
  if (!compact.length) throw new Error(invalidMessage);

  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  const firstPadding = normalized.indexOf("=");
  const content =
    firstPadding === -1 ? normalized : normalized.slice(0, firstPadding);
  const padding = firstPadding === -1 ? "" : normalized.slice(firstPadding);
  if (!/^[A-Za-z0-9+/]*$/.test(content) || !/^={0,2}$/.test(padding)) {
    throw new Error(invalidMessage);
  }
  if (content.length % 4 === 1 || padding.length > 2) {
    throw new Error(invalidMessage);
  }

  const requiredPadding = (4 - (content.length % 4)) % 4;
  if (padding.length && padding.length !== requiredPadding) {
    throw new Error(invalidMessage);
  }
  const encoded = content + "=".repeat(requiredPadding);
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) {
    throw new Error(invalidMessage);
  }
  if (buffer.length > maxBytes) throw new Error(oversizeMessage);

  // Buffer silently ignores malformed trailing bits; compare the canonical
  // representation to ensure those bits were not smuggled in.
  const canonical = buffer.toString("base64").replace(/=+$/, "");
  if (canonical !== content) throw new Error(invalidMessage);
  return buffer;
}

export function decodeReferenceImageDataUrl(dataUrl: string): ReferenceImage {
  if (dataUrl.length > MAX_REFERENCE_IMAGE_DATA_URL_LENGTH) {
    throw new Error("参考图数据不能超过 14 MB");
  }

  const match = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(dataUrl);
  if (!match) throw new Error("请选择 PNG、JPG 或 WebP 图片");

  const mimeType = match[1].toLowerCase() as keyof typeof IMAGE_TYPES;
  const encoded = dataUrl.slice(match[0].length);
  const buffer = decodeBase64(
    encoded,
    MAX_REFERENCE_IMAGE_BYTES,
    "请选择 PNG、JPG 或 WebP 图片",
    "参考图不能超过 10 MB"
  );
  if (!hasExpectedSignature(buffer, mimeType)) {
    throw new Error("参考图内容无效");
  }

  return { buffer, mimeType, extension: IMAGE_TYPES[mimeType] };
}

async function persistGeneratedImageWithMetadata(
  dataUrl: string
): Promise<GenerateResult> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i.exec(
    dataUrl
  );
  if (!match) throw new Error("上游返回了不支持的图片数据格式");

  const encoded = match[2];
  const maxEncodedLength = Math.ceil((MAX_GENERATED_IMAGE_BYTES * 4) / 3) + 4;
  if (encoded.replace(/\s+/g, "").length > maxEncodedLength) {
    throw new Error("上游返回的图片超过 20 MB");
  }
  const image = decodeBase64(
    encoded,
    MAX_GENERATED_IMAGE_BYTES,
    "上游返回了无效的图片数据"
  );
  return persistImageBuffer(image);
}

export async function persistGeneratedImage(dataUrl: string) {
  return (await persistGeneratedImageWithMetadata(dataUrl)).imageUrl;
}

function imageMimeFromBuffer(buffer: Buffer) {
  for (const mimeType of Object.keys(IMAGE_TYPES) as Array<
    keyof typeof IMAGE_TYPES
  >) {
    if (hasExpectedSignature(buffer, mimeType)) return mimeType;
  }
  return undefined;
}

function pngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    !hasExpectedSignature(buffer, "image/png") ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return undefined;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
    return undefined;
  }
  return { width, height };
}

async function persistImageBuffer(image: Buffer): Promise<GenerateResult> {
  if (image.length === 0) throw new Error("上游返回了空图片");
  if (image.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("上游返回的图片超过 20 MB");
  }

  const detectedMimeType = imageMimeFromBuffer(image);
  if (!detectedMimeType) {
    throw new Error("上游返回了无效的图片数据");
  }

  const outputDir = path.resolve(
    process.env.GENERATED_IMAGE_DIR ?? "data/generated"
  );
  await mkdir(outputDir, { recursive: true });
  const filename = `${randomUUID()}.${IMAGE_TYPES[detectedMimeType]}`;
  await writeFile(path.join(outputDir, filename), image);
  return {
    imageUrl: `/generated/${filename}`,
    ...(detectedMimeType === "image/png" ? pngDimensions(image) : undefined),
  };
}

async function readResponseBody(response: Response, maxBytes: number) {
  if (!response.body) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new Error("上游返回的图片超过 20 MB");
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error("上游返回的图片超过 20 MB");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

/**
 * 将上游返回的远程图片下载到本地持久目录，避免签名 URL 过期后历史记录裂图。
 */
function isPrivateHostname(hostname: string) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "0.0.0.0" ||
    host === "::1"
  ) {
    return true;
  }

  const octets = host.split(".").map(part => Number(part));
  if (
    octets.length === 4 &&
    octets.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && b >= 18 && b <= 19)
    );
  }

  // Unique-local and link-local IPv6 ranges.
  return /^(?:fc|fd)[0-9a-f]{2}:|^fe[89ab][0-9a-f]{2}:/i.test(host);
}

async function persistGeneratedImageUrlWithMetadata(
  imageUrl: string,
  options: { authorization?: string; authorizationOrigin?: string } = {}
): Promise<GenerateResult> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("上游返回了无效的图片地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("上游返回了不支持的图片地址");
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("上游返回了不安全的图片地址");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    GENERATED_IMAGE_FETCH_TIMEOUT_MS
  );
  try {
    let current = parsed;
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      if (isPrivateHostname(current.hostname)) {
        throw new Error("图片地址重定向到不安全主机");
      }
      const headers: Record<string, string> = {};
      if (
        options.authorization &&
        (!options.authorizationOrigin ||
          current.origin === options.authorizationOrigin)
      ) {
        headers.Authorization = options.authorization;
      }
      response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers,
      });
      if (response.status < 300 || response.status >= 400) break;
      if (redirectCount === 3) throw new Error("图片地址重定向次数过多");
      const location = response.headers.get("location");
      if (!location) throw new Error("图片地址重定向缺少目标");
      current = new URL(location, current);
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new Error("图片地址重定向到不支持的协议");
      }
    }
    if (!response) throw new Error("图片下载失败");
    if (!response.ok) {
      throw new Error(`图片下载失败 (${response.status})`);
    }
    const contentLength = Number.parseInt(
      response.headers.get("content-length") ?? "",
      10
    );
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_GENERATED_IMAGE_BYTES
    ) {
      throw new Error("上游返回的图片超过 20 MB");
    }
    const image = await readResponseBody(response, MAX_GENERATED_IMAGE_BYTES);
    // Trust the actual magic bytes rather than a frequently mislabelled
    // Content-Type header returned by CDNs.
    return await persistImageBuffer(image);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("图片下载超时");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function persistGeneratedImageUrl(
  imageUrl: string,
  options: { authorization?: string; authorizationOrigin?: string } = {}
) {
  return (await persistGeneratedImageUrlWithMetadata(imageUrl, options))
    .imageUrl;
}

export async function removeStoredGeneratedImage(
  imageUrl: string | null | undefined
) {
  if (!imageUrl?.startsWith("/generated/")) return;
  const { unlink } = await import("node:fs/promises");
  const outputDir = path.resolve(
    process.env.GENERATED_IMAGE_DIR ?? "data/generated"
  );
  const filename = path.basename(imageUrl);
  if (!filename || filename === "." || filename === "..") return;
  await unlink(path.join(outputDir, filename)).catch(() => undefined);
}

function shouldTryAnotherUpstream(error: unknown) {
  if (classifyGenerationFailure(error).kind === "content_rejected")
    return false;
  if (error instanceof UpstreamImageError) {
    return (
      error.status === 401 ||
      error.status === 403 ||
      error.status === 408 ||
      error.status === 409 ||
      error.status === 429 ||
      error.status >= 500
    );
  }
  return (
    error instanceof Error &&
    /abort|timeout|timed out|fetch failed|network|socket|econn|上游未返回图片|图片下载失败|图片下载超时|图片地址/i.test(
      error.message
    )
  );
}

/**
 * 按优先级尝试上游。鉴权失效、限流、超时和 5xx 会自动切换到备用通道；
 * 内容审核拒绝不会重复提交同一提示词，避免无意义的上游调用。
 */
export async function callUpstreamWithFallback(
  upstreamList: Upstream[],
  input: GenerateInput
) {
  let lastError: unknown;
  for (const upstream of upstreamList) {
    try {
      return { upstream, result: await callUpstream(upstream, input) };
    } catch (error) {
      lastError = error;
      if (!shouldTryAnotherUpstream(error)) throw error;
      console.warn("[image] upstream attempt failed, trying next", {
        upstreamId: upstream.id,
        error:
          error instanceof Error ? error.message.slice(0, 240) : String(error),
      });
    }
  }
  throw lastError ?? new Error("暂无可用生图上游");
}

/**
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
    const demoImages = [
      "/bg/nebula.jpg",
      "/bg/neural.jpg",
      "/bg/photon.jpg",
      "/bg/hyperspace.jpg",
      "/bg/quantum.jpg",
      "/bg/crystal.jpg",
    ];
    return {
      // Keep the built-in demo independent of a third-party CDN so the first
      // generation and its history remain viewable even when outbound network
      // access is unavailable.
      imageUrl: demoImages[seed % demoImages.length],
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
      // The image2 gateway requires an explicit quality for non-square output.
      if (input.width !== input.height) form.append("quality", "high");
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
        ...(input.width !== input.height ? { quality: "high" } : {}),
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
      const returnedUrl = first.url.trim();
      if (/^data:/i.test(returnedUrl)) {
        return persistGeneratedImageWithMetadata(returnedUrl);
      }
      if (/^https?:\/\//i.test(returnedUrl)) {
        const upstreamOrigin = new URL(base).origin;
        return persistGeneratedImageUrlWithMetadata(returnedUrl, {
          authorization: upstream.apiKey
            ? `Bearer ${upstream.apiKey}`
            : undefined,
          authorizationOrigin: upstreamOrigin,
        });
      }
      throw new Error("上游返回了不支持的图片地址");
    }
    if (first?.b64_json) {
      return persistGeneratedImageWithMetadata(
        `data:image/png;base64,${first.b64_json}`
      );
    }
    throw new Error("上游未返回图片");
  } finally {
    clearTimeout(timer);
  }
}
