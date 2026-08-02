import type { CookieOptions } from "hono/utils/cookie";

function isSecureRequest(headers: Headers): boolean {
  const forwardedProto = headers.get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedProto) return forwardedProto === "https";

  const origin = headers.get("origin");
  return origin?.startsWith("https://") ?? false;
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const secure = isSecureRequest(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure,
  };
}
