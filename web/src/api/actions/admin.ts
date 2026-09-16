import { request } from "@app/api/transport";

export type Relay = {
  configured: boolean;
  host: string;
  port: number;
  security: "starttls" | "implicit";
  username: string;
  password_set: boolean;
  from_address: string;
  from_name: string;
};

export type Limits = { asset_max_bytes: number; account_quota_bytes: number };

export type User = {
  id: string;
  username: string;
  role: string;
  created_at: number;
};

export const getAdminUsers = () =>
  request<{ users: User[] }>("/api/admin/users");

export const postAdminInvites = (body: { role: string }) =>
  request<{ link: string; role: string; expires_at: number }>(
    "/api/admin/invites",
    {
      method: "POST",
      body,
    },
  );

export const getAdminRelay = () => request<Relay>("/api/admin/relay");

/** An empty password keeps the stored one, which is what lets a port be corrected without
 *  retyping a credential the form was never given. */
export const putAdminRelay = (body: {
  host: string;
  port: number;
  security: string;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
}) => request<Relay>("/api/admin/relay", { method: "PUT", body });

export const deleteAdminRelay = () =>
  request<void>("/api/admin/relay", { method: "DELETE" });

export const postAdminRelayTest = (body: { to: string }) =>
  request<void>("/api/admin/relay/test", { method: "POST", body });

export const getAdminLimits = () => request<Limits>("/api/admin/limits");

export const putAdminLimits = (body: Limits) =>
  request<Limits>("/api/admin/limits", { method: "PUT", body });
