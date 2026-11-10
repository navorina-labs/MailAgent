/** 401 body that tells a person or an agent how to get in, not just "unauthorized". */

export const GET_KEY_URL = "https://webmailagent.com/get-key";
export const AGENT_DOCS_URL = "https://webmailagent.com/docs/agents.html";

export type UnauthorizedBody = {
  error: "unauthorized";
  reason: "missing_api_key" | "invalid_api_key";
  message: string;
  getKey: string;
  docs: string;
};

export function unauthorizedBody(hasToken: boolean): UnauthorizedBody {
  return hasToken
    ? {
        error: "unauthorized",
        reason: "invalid_api_key",
        message: "API key not recognized or revoked. Check the key, or get a new free one.",
        getKey: GET_KEY_URL,
        docs: AGENT_DOCS_URL,
      }
    : {
        error: "unauthorized",
        reason: "missing_api_key",
        message: "Send Authorization: Bearer ma_... A free key takes one email: " + GET_KEY_URL,
        getKey: GET_KEY_URL,
        docs: AGENT_DOCS_URL,
      };
}
