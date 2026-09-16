import { request } from "@app/api/transport";
import type { Token } from "@app/api/types";

export const getTokens = () => request<{ tokens: Token[] }>("/api/tokens");

/** The secret is in this response and nowhere else, ever. */
export const postTokens = (body: {
  label: string;
  scope?: string;
  expires_at?: number;
}) =>
  request<{ token: Token; secret: string }>("/api/tokens", {
    method: "POST",
    body,
  });

/** Changes what a token reaches. The token itself does not change. */
export const patchTokensById = (id: string, body: { scope: string }) =>
  request<Token>(`/api/tokens/${id}`, { method: "PATCH", body });

export const deleteTokensById = (id: string) =>
  request<void>(`/api/tokens/${id}`, { method: "DELETE" });
