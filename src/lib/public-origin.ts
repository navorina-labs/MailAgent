export const LEGACY_API_ORIGIN = "https://api.webmailagent.com";
export const LEGACY_WORKSPACE_ORIGIN = "https://webmailagent.com";
export const NAVORINA_API_ORIGIN = "https://mail-api.navorina.ai";
export const NAVORINA_WORKSPACE_ORIGIN = "https://agents.navorina.ai";

function normalizedHttpOrigin(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Resolve the original request scheme behind Cloudflare or a local proxy. */
export function isInsecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  if (forwardedProto === "http") return true;
  if (forwardedProto === "https") return false;

  const visitor = request.headers.get("CF-Visitor");
  if (visitor) {
    try {
      const parsed = JSON.parse(visitor) as { scheme?: string };
      if (parsed.scheme === "http") return true;
      if (parsed.scheme === "https") return false;
    } catch {
      /* ignore malformed header */
    }
  }

  return new URL(request.url).protocol === "http:";
}

/** Public API origin (configured prod / custom domain / workers.dev / local). */
export function publicOriginFromUrl(url: string, configuredOrigin?: string): string {
  const u = new URL(url);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
    return u.origin;
  }
  if (u.hostname.includes("workers.dev")) {
    return u.origin;
  }
  return normalizedHttpOrigin(configuredOrigin) ?? u.origin;
}

export function workspaceOrigin(configuredOrigin?: string): string {
  return normalizedHttpOrigin(configuredOrigin) ?? LEGACY_WORKSPACE_ORIGIN;
}

export function publicApiOrigin(configuredOrigin?: string): string {
  return normalizedHttpOrigin(configuredOrigin) ?? LEGACY_API_ORIGIN;
}

export function workspaceUrl(path: string, configuredOrigin?: string): string {
  return new URL(path, `${workspaceOrigin(configuredOrigin)}/`).toString();
}

/** OAuth returnTo from workspace UI — relative paths resolve to the static site origin. */
export function resolveWorkspaceReturnTo(
  returnTo: string,
  requestUrl: string,
  configuredWorkspaceOrigin?: string,
  configuredApiOrigin?: string
): URL {
  try {
    return new URL(returnTo);
  } catch {
    const apiOrigin = publicOriginFromUrl(requestUrl, configuredApiOrigin);
    const base =
      apiOrigin.includes("127.0.0.1") || apiOrigin.includes("localhost")
        ? apiOrigin
        : workspaceOrigin(configuredWorkspaceOrigin);
    return new URL(returnTo, base);
  }
}
