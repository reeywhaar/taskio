import { request } from "@app/api/transport";
import type { Token } from "@app/api/types";

export const getTokens = () => request<{ tokens: Token[] }>("/api/tokens");

/** The secret is in this response and nowhere else, ever. */
export const postTokens = (body: {
  label: string;
  scope?: string;
  expires_at?: number;
  idle_seconds?: number;
}) =>
  request<{ token: Token; secret: string }>("/api/tokens", {
    method: "POST",
    body,
  });

/**
 * Changes everything about a token but its secret. A field left out is left alone, and an
 * expires_at of 0 takes the expiry away.
 */
export type TokenPatch = {
  label?: string;
  scope?: string;
  expires_at?: number;
  idle_seconds?: number;
};

export const patchTokensById = (id: string, body: TokenPatch) =>
  request<Token>(`/api/tokens/${id}`, { method: "PATCH", body });

export const deleteTokensById = (id: string) =>
  request<void>(`/api/tokens/${id}`, { method: "DELETE" });

/** Drops the revoked rows out of the listing, and says how many went. */
export const deleteTokensRevoked = () =>
  request<{ forgotten: number }>("/api/tokens/revoked", { method: "DELETE" });
