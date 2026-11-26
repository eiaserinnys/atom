import { jwtVerify, type JWTPayload } from "jose";
import type { UserRole } from "../shared/types.js";
import { sessionBindingMatches } from "./admin-password.js";
import { isAllowedAccessJwtPayload } from "./routes/auth_helpers.js";

export interface ActiveUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
}

export type AccessTokenPayload = JWTPayload & { id: string };

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env["JWT_SECRET"]!));
    if (!isAllowedAccessJwtPayload(payload) || typeof payload["id"] !== "string") return null;
    if (!sessionBindingMatches(payload["pwf"])) return null;
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function toJwtUser(user: ActiveUserRow, payload: JWTPayload) {
  return {
    id: user.id,
    email: user.email,
    name: user.display_name ?? (typeof payload["name"] === "string" ? payload["name"] : ""),
    role: user.role,
  };
}
