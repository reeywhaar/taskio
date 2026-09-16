import { request } from "@app/api/transport";

export type Account = {
  recovery_email: string;
  relay_configured: boolean;
  assets: { used: number; quota: number; max: number };
};

export const getAccount = () => request<Account>("/api/account");

export const postAccountPassword = (body: { current: string; new: string }) =>
  request<void>("/api/account/password", { method: "POST", body });

export const postAccountRecovery = (body: { email: string }) =>
  request<void>("/api/account/recovery", { method: "POST", body });

export const postAccountRecoveryConfirm = (body: { code: string }) =>
  request<void>("/api/account/recovery/confirm", { method: "POST", body });

export const deleteAccountRecovery = () =>
  request<void>("/api/account/recovery", { method: "DELETE" });
