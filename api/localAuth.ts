import { promisify } from "node:util";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { compare as compareBcrypt } from "bcryptjs";
import * as cookie from "cookie";
import { nanoid } from "nanoid";
import { count, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { User } from "@db/schema";
import { users } from "@db/schema";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions } from "./lib/cookies";
import { getDb } from "./queries/connection";
import { findUserByEmail, findUserByUnionId } from "./queries/users";
import { signSessionToken, verifySessionToken } from "./kimi/session";

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  if (/^\$2[aby]\$/.test(storedHash)) {
    return compareBcrypt(password, storedHash);
  }

  const [algorithm, salt, hash] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;

  const storedKey = Buffer.from(hash, "hex");
  const derivedKey = (await scrypt(password, salt, storedKey.length)) as Buffer;
  return (
    storedKey.length === derivedKey.length &&
    timingSafeEqual(storedKey, derivedKey)
  );
}

export function publicUser(user: User) {
  return {
    id: user.id,
    unionId: user.unionId,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    quota: user.quota,
    status: user.status,
    apiKey: user.apiKey,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSignInAt: user.lastSignInAt,
  };
}

export function getLocalRegistrationDefaults(userCount: number) {
  return {
    role: userCount === 0 ? ("admin" as const) : ("user" as const),
    quota: 0,
  };
}

export function getLocalUserInsertValues(
  input: { name: string; email: string },
  passwordHash: string,
  userCount: number
) {
  return {
    unionId: `local:${nanoid(24)}`,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    passwordHash,
    ...getLocalRegistrationDefaults(userCount),
    lastSignInAt: new Date(),
  };
}

export async function createLocalUser(input: {
  name: string;
  email: string;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (await findUserByEmail(email)) {
    throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
  }

  const db = getDb();
  const [{ value: userCount }] = await db
    .select({ value: count() })
    .from(users);
  const passwordHash = await hashPassword(input.password);
  const [{ id }] = await db
    .insert(users)
    .values(
      getLocalUserInsertValues({ ...input, email }, passwordHash, userCount)
    )
    .$returningId();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function authenticateCredentials(email: string, password: string) {
  const user = await findUserByEmail(email.trim().toLowerCase());
  const valid = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : false;
  if (!user || !valid) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "邮箱或密码不正确" });
  }
  if (user.status === "banned") {
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
  }

  await getDb()
    .update(users)
    .set({ lastSignInAt: new Date() })
    .where(eq(users.id, user.id));
  return user;
}

export async function setSessionCookie(
  headers: Headers,
  responseHeaders: Headers,
  user: User
) {
  const token = await signSessionToken({
    unionId: user.unionId,
    clientId: "local",
  });
  const options = getSessionCookieOptions(headers);
  responseHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: options.httpOnly,
      path: options.path,
      sameSite: options.sameSite?.toLowerCase() as "lax",
      secure: options.secure,
      maxAge: Session.maxAgeMs / 1000,
    })
  );
}

export async function authenticateRequest(headers: Headers) {
  const cookies = cookie.parse(headers.get("cookie") || "");
  const token = cookies[Session.cookieName];
  if (!token) return undefined;

  const claim = await verifySessionToken(token);
  if (!claim) return undefined;
  const user = await findUserByUnionId(claim.unionId);
  if (!user || user.status === "banned") return undefined;
  return user;
}
