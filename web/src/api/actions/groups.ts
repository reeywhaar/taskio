import { query, request } from "@app/api/transport";
import type { Group } from "@app/api/types";

/** A project's groups, by slug; empty is the default project. */
export const getGroups = (project: string) =>
  request<{ groups: Group[] }>(`/api/groups${query({ project })}`);

export const postGroups = (
  project: string,
  body: { name: string; tags: string[]; color: string },
) =>
  request<Group>(`/api/groups${query({ project })}`, { method: "POST", body });

/** Name and tags together: the dialog that edits one edits both. */
export const patchGroupsById = (
  id: string,
  body: { name: string; tags: string[]; color: string },
) => request<Group>(`/api/groups/${id}`, { method: "PATCH", body });

export const deleteGroupsById = (id: string) =>
  request<void>(`/api/groups/${id}`, { method: "DELETE" });

/** Where the rail's groups have been dragged to. The whole arrangement, not one move. */
export const putGroupsOrder = (project: string, body: { ids: string[] }) =>
  request<void>(`/api/groups/order${query({ project })}`, {
    method: "PUT",
    body,
  });
