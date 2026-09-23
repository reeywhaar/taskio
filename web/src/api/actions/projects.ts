import { request } from "@app/api/transport";
import type { Project } from "@app/api/types";

export const getProjects = () =>
  request<{ projects: Project[] }>("/api/projects");

/** A slug left out is derived from the name. */
export const postProjects = (body: { name: string; slug?: string }) =>
  request<Project>("/api/projects", { method: "POST", body });

/** The slug changes only when it is sent: a rename keeps every link working. */
export const patchProjectsById = (
  id: string,
  body: { name?: string; slug?: string },
) => request<Project>(`/api/projects/${id}`, { method: "PATCH", body });

/** Deletes it and every task, group and tag arrangement in it. */
export const deleteProjectsById = (id: string) =>
  request<void>(`/api/projects/${id}`, { method: "DELETE" });

/** Where the rail's projects have been dragged to. The whole arrangement. */
export const putProjectsOrder = (body: { ids: string[] }) =>
  request<void>("/api/projects/order", { method: "PUT", body });
