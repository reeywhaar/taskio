import { request } from "@app/api/transport";
import type { Session } from "@app/api/types";

export const getSessions = () =>
  request<{ sessions: Session[] }>("/api/sessions");

export const deleteSessionsById = (id: string) =>
  request<void>(`/api/sessions/${id}`, { method: "DELETE" });

export const deleteSessions = () =>
  request<void>("/api/sessions", { method: "DELETE" });
