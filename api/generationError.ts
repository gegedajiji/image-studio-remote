export class UpstreamImageError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`上游返回 ${status}: ${responseBody}`);
    this.name = "UpstreamImageError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export type GenerationFailureKind =
  | "content_rejected"
  | "rate_limited"
  | "temporarily_unavailable"
  | "unknown";

export type GenerationFailure = {
  kind: GenerationFailureKind;
  code: string;
  httpStatus: 400 | 429 | 500 | 503;
  message: string;
};

const FAILURES: Record<GenerationFailureKind, GenerationFailure> = {
  content_rejected: {
    kind: "content_rejected",
    code: "content_policy_violation",
    httpStatus: 400,
    message: "内容未通过安全审核，请修改提示词或参考图片后重试",
  },
  rate_limited: {
    kind: "rate_limited",
    code: "generation_rate_limited",
    httpStatus: 429,
    message: "当前生图请求较多，请稍后重试",
  },
  temporarily_unavailable: {
    kind: "temporarily_unavailable",
    code: "generation_temporarily_unavailable",
    httpStatus: 503,
    message: "生图服务暂时繁忙，请稍后重试",
  },
  unknown: {
    kind: "unknown",
    code: "generation_failed",
    httpStatus: 500,
    message: "图片生成失败，请稍后重试",
  },
};

function rawErrorText(error: unknown) {
  if (error instanceof UpstreamImageError) {
    return `${error.status} ${error.responseBody}`.toLowerCase();
  }
  return (
    error instanceof Error ? `${error.name} ${error.message}` : String(error)
  ).toLowerCase();
}

export function getRawGenerationError(error: unknown) {
  return error instanceof Error ? error.message : "生图失败";
}

export function classifyGenerationFailure(error: unknown): GenerationFailure {
  const text = rawErrorText(error);
  const status = error instanceof UpstreamImageError ? error.status : undefined;

  if (
    /content[_\s-]*policy|safety[_\s-]*(?:system|policy|violation)|moderation[_\s-]*(?:blocked|failed|rejected)|\b(?:prompt|image)\b.*\b(?:unsafe|inappropriate|disallowed)\b/.test(
      text
    ) ||
    /不合规|未通过.{0,8}审核|审核.{0,8}(?:不通过|拒绝)|内容.{0,8}(?:违规|敏感)|敏感词/.test(text)
  ) {
    return FAILURES.content_rejected;
  }

  if (
    status === 429 ||
    /rate[_\s-]*limit|too many requests|请求过于频繁|请求人数较多/.test(text)
  ) {
    return FAILURES.rate_limited;
  }

  if (
    status === 401 ||
    status === 403 ||
    (status !== undefined && status >= 500) ||
    /abort|timeout|timed out|fetch failed|network|service temporarily unavailable|no available compatible accounts|access forbidden|服务暂时不可用|上游未返回图片/.test(
      text
    )
  ) {
    return FAILURES.temporarily_unavailable;
  }

  return FAILURES.unknown;
}

export function refundedGenerationMessage(error: unknown) {
  return `${classifyGenerationFailure(error).message}，本次积分已退回`;
}
