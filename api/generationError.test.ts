import { describe, expect, it } from "vitest";
import {
  classifyGenerationFailure,
  refundedGenerationMessage,
  UpstreamImageError,
} from "./generationError";

describe("generation failure messages", () => {
  it.each([
    new UpstreamImageError(
      400,
      JSON.stringify({
        error: {
          message: "Service temporarily unavailable",
          code: "content_policy_violation",
        },
      })
    ),
    new Error("moderation_blocked"),
    new Error("提示词未通过内容审核"),
  ])("maps content moderation errors to an actionable message", error => {
    expect(classifyGenerationFailure(error)).toMatchObject({
      kind: "content_rejected",
      code: "content_policy_violation",
      httpStatus: 400,
      message: "内容未通过安全审核，请修改提示词或参考图片后重试",
    });
    expect(refundedGenerationMessage(error)).toBe(
      "内容未通过安全审核，请修改提示词或参考图片后重试，本次积分已退回"
    );
  });

  it("maps rate limits without exposing upstream details", () => {
    expect(
      classifyGenerationFailure(
        new UpstreamImageError(429, "too many requests")
      )
    ).toMatchObject({
      kind: "rate_limited",
      httpStatus: 429,
    });
  });

  it.each([
    new UpstreamImageError(503, "No available compatible accounts"),
    new UpstreamImageError(502, "Upstream access forbidden"),
    Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
  ])("maps temporary upstream failures to a retryable message", error => {
    expect(classifyGenerationFailure(error)).toMatchObject({
      kind: "temporarily_unavailable",
      httpStatus: 503,
      message: "生图服务暂时繁忙，请稍后重试",
    });
  });

  it("uses a generic message for an unrecognized failure", () => {
    expect(classifyGenerationFailure(new Error("unexpected response"))).toMatchObject({
      kind: "unknown",
      httpStatus: 500,
      message: "图片生成失败，请稍后重试",
    });
  });
});
