import { query, request } from "@app/api/transport";
import type { Task, TaskDetail, TaskPage } from "@app/api/types";

export type ListParams = {
  /** The project's slug; empty is the default project. */
  project?: string;
  tags?: string;
  q?: string;
  status?: string;
  /** Sent as a string, because query() drops an empty value and false is not one. */
  pinned?: string;
  limit?: number;
  cursor?: string;
};

export const getTasks = (params: ListParams) =>
  request<TaskPage>(`/api/tasks${query(params)}`);

export const getTasksById = (id: string) =>
  request<TaskDetail>(`/api/tasks/${id}`);

export const postTasks = (
  project: string,
  body: {
    title: string;
    description?: string;
    tags?: string[];
    color?: string;
    priority?: number;
    pinned?: boolean;
  },
) => request<Task>(`/api/tasks${query({ project })}`, { method: "POST", body });

export const patchTasksById = (
  id: string,
  body: {
    title?: string;
    description?: string;
    tags?: string[];
    priority?: number;
    pinned?: boolean;
    color?: string;
    /** Moves it, with its tags, to the project with this slug. */
    project?: string;
  },
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

/** Moves every task in the set, each with its tags, to one project. */
export const postTasksBulkProject = (ids: string[], project: string) =>
  request<void>("/api/tasks/bulk/project", {
    method: "POST",
    body: { ids, project },
  });

export const postTasksBulkPriority = (ids: string[], priority: number) =>
  request<void>("/api/tasks/bulk/priority", {
    method: "POST",
    body: { ids, priority },
  });

export const postTasksBulkPinned = (ids: string[], pinned: boolean) =>
  request<void>("/api/tasks/bulk/pinned", {
    method: "POST",
    body: { ids, pinned },
  });

export const postTasksBulkDelete = (ids: string[]) =>
  request<void>("/api/tasks/bulk/delete", { method: "POST", body: { ids } });
