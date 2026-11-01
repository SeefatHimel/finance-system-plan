import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

function secret() { return process.env.FINANCE_PROXY_AUTH_SECRET ?? ""; }
export function loginProxyHeaders(request?: Request): Record<string, string> {
  const key = secret();
  const header = process.env.FINANCE_TRUSTED_CLIENT_IP_HEADER || (process.env.VERCEL === "1" ? "x-vercel-forwarded-for" : "");
  const ip = header && request?.headers.get(header)?.split(",")[0]?.trim();
  if (!key || key.length < 32 || !ip || !isIP(ip)) {
    if (process.env.NODE_ENV === "production") throw new Error("Sign-in proxy identity is not configured. Configure the shared auth secret and trusted client IP header.");
    return {};
  }
  const identity = createHash("sha256").update(ip).digest("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { "X-Finance-Client": identity, "X-Finance-Client-Time": timestamp, "X-Finance-Client-Signature": createHmac("sha256", key).update(`login:${identity}:${timestamp}`).digest("hex") };
}
export function refreshProxyHeaders(token: string): Record<string, string> {
  const key = secret();
  if (!key || key.length < 32) return {};
  const digest = createHash("sha256").update(token).digest("hex");
  return { "X-Finance-Refresh-Signature": createHmac("sha256", key).update(`refresh:${digest}`).digest("hex") };
}
