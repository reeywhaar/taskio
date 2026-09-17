import { request } from "@app/api/transport";
import type { Tag } from "@app/api/types";

export const getTags = () => request<{ tags: Tag[] }>("/api/tags");

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
export const putTagsOrder = (body: { slugs: string[] }) =>
  request<void>("/api/tags/order", { method: "PUT", body });
