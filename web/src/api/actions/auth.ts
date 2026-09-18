import { request } from "@app/api/transport";
import type { Me } from "@app/api/types";

/** Named mechanically from the route, so a call site and a handler find each other by grep. */

export const postAuthLogin = (body: { username: string; password: string }) =>
  request<void>("/api/auth/login", { method: "POST", body });

export const postAuthLogout = () =>
  request<void>("/api/auth/logout", { method: "POST" });

export const getAuthMe = () => request<Me>("/api/auth/me");

export const getAuthInvitesByToken = (token: string) =>
  request<{ role: string; expires_at: number }>(
    `/api/auth/invites/${encodeURIComponent(token)}`,
  );

/** What the login form may know before anybody has proved anything. */
export const getAuthInstance = () =>
  request<{ recovery: boolean }>("/api/auth/instance");

/** Answers the same whether or not the address is one of ours, which is the point of it. */
export const postAuthRecoveries = (body: { email: string }) =>
  request<void>("/api/auth/recoveries", { method: "POST", body });

export type Recovery = {
  username: string;
  expires_at: number;
  usable: boolean;
  used: boolean;
  voided: boolean;
  expired: boolean;
};

export const getAuthRecoveriesByToken = (token: string) =>
  request<Recovery>(`/api/auth/recoveries/${encodeURIComponent(token)}`);

export const postAuthRecoveriesByTokenAccept = (
  token: string,
  body: { password: string },
) =>
  request<void>(`/api/auth/recoveries/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body,
  });

export const postAuthInvitesByTokenAccept = (
  token: string,
  body: { username: string; password: string },
) =>
  request<void>(`/api/auth/invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    body,
  });
