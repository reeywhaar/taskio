import { query, request } from "@app/api/transport";
import type { Tag } from "@app/api/types";

/** A project's tags, by slug; empty is the default project. */
export const getTags = (project: string) =>
  request<{ tags: Tag[] }>(`/api/tags${query({ project })}`);

export const patchTagsBySlug = (slug: string, body: { slug: string }) =>
  request<{ slug: string; tasks: number }>(
    `/api/tags/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      body,
    },
  );

export const deleteTagsBySlug = (slug: string) =>
  request<{ tasks: number }>(`/api/tags/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });

/** Where the pills have been dragged to. The whole arrangement, not one move. */
export const putTagsOrder = (project: string, body: { slugs: string[] }) =>
  request<void>(`/api/tags/order${query({ project })}`, {
    method: "PUT",
    body,
  });
