import { request } from "@app/api/transport";
import type { Group } from "@app/api/types";

export const getGroups = () => request<{ groups: Group[] }>("/api/groups");

export const postGroups = (body: { name: string; tags: string[] }) =>
  request<Group>("/api/groups", { method: "POST", body });

/** Name and tags together: the dialog that edits one edits both. */
export const patchGroupsById = (
  id: string,
  body: { name: string; tags: string[] },
) => request<Group>(`/api/groups/${id}`, { method: "PATCH", body });

export const deleteGroupsById = (id: string) =>
  request<void>(`/api/groups/${id}`, { method: "DELETE" });
