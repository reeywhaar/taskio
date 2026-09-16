import { query, request } from "@app/api/transport";
import type { Task, TaskDetail, TaskPage } from "@app/api/types";

export type ListParams = {
  tags?: string;
  q?: string;
  status?: string;
  limit?: number;
  cursor?: string;
};

export const getTasks = (params: ListParams) =>
  request<TaskPage>(`/api/tasks${query(params)}`);

export const getTasksById = (id: string) =>
  request<TaskDetail>(`/api/tasks/${id}`);

export const postTasks = (body: {
  title: string;
  description?: string;
  tags?: string[];
}) => request<Task>("/api/tasks", { method: "POST", body });

export const patchTasksById = (
  id: string,
  body: { title?: string; description?: string; tags?: string[] },
) => request<Task>(`/api/tasks/${id}`, { method: "PATCH", body });

export const postTasksByIdDone = (id: string) =>
  request<Task>(`/api/tasks/${id}/done`, { method: "POST" });

export const postTasksByIdTodo = (id: string) =>
  request<Task>(`/api/tasks/${id}/todo`, { method: "POST" });

export const deleteTasksById = (id: string) =>
  request<void>(`/api/tasks/${id}`, { method: "DELETE" });

export const postTasksBulkDone = (ids: string[]) =>
  request<void>("/api/tasks/bulk/done", { method: "POST", body: { ids } });

export const postTasksBulkTodo = (ids: string[]) =>
  request<void>("/api/tasks/bulk/todo", { method: "POST", body: { ids } });

export const postTasksBulkTags = (
  ids: string[],
  add: string[],
  remove: string[],
) =>
  request<void>("/api/tasks/bulk/tags", {
    method: "POST",
    body: { ids, add, remove },
  });

export const postTasksBulkDelete = (ids: string[]) =>
  request<void>("/api/tasks/bulk/delete", { method: "POST", body: { ids } });
