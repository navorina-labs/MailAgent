export const LEGACY_API_ORIGIN = "https://api.webmailagent.com";
export const LEGACY_WORKSPACE_ORIGIN = "https://webmailagent.com";
export const NAVORINA_API_ORIGIN = "https://mail-api.navorina.ai";
export const NAVORINA_WORKSPACE_ORIGIN = "https://agents.navorina.ai";

function normalizedHttpOrigin(value) {
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

export function apiOrigin(env = process.env) {
  return (
    normalizedHttpOrigin(env.MAILAGENT_API_URL) ??
    normalizedHttpOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN) ??
    LEGACY_API_ORIGIN
  );
}

export function workspaceOrigin(env = process.env) {
  const configured = normalizedHttpOrigin(env.MAILAGENT_WORKSPACE_ORIGIN);
  if (configured) return configured;
  return apiOrigin(env) === NAVORINA_API_ORIGIN
    ? NAVORINA_WORKSPACE_ORIGIN
    : LEGACY_WORKSPACE_ORIGIN;
}

export function apiUrl(path, env = process.env) {
  return new URL(path, `${apiOrigin(env)}/`).toString();
}

export function workspaceUrl(path, env = process.env) {
  return new URL(path, `${workspaceOrigin(env)}/`).toString();
}
