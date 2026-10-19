import { request } from "@app/api/transport";

export type Account = {
  recovery_email: string;
  relay_configured: boolean;
  assets: { used: number; quota: number; max: number };
  /** How long a pin holds, in hours; 0 is until it is taken off. */
  pin_hours: number;
};

export const getAccount = () => request<Account>("/api/account");

export const patchAccount = (body: { pin_hours: number }) =>
  request<Account>("/api/account", { method: "PATCH", body });

export const postAccountPassword = (body: { current: string; new: string }) =>
  request<void>("/api/account/password", { method: "POST", body });

export const postAccountRecovery = (body: { email: string }) =>
  request<void>("/api/account/recovery", { method: "POST", body });

export const postAccountRecoveryConfirm = (body: { code: string }) =>
  request<void>("/api/account/recovery/confirm", { method: "POST", body });

export const deleteAccountRecovery = () =>
  request<void>("/api/account/recovery", { method: "DELETE" });
