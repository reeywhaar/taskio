import { query, request } from "@app/api/transport";

/** A link that shows an agent a token, and when each stops. Times are unix seconds. */
export type AccessLink = {
  url: string;
  /** The token's id, to change what it reaches before the link is handed over. */
  token: string;
  /** When the link stops showing the token: five minutes. */
  expires_at: number;
  /** When the token stops working: thirty minutes. */
  token_expires_at: number;
};

/** For a project, by slug, and a group in it by id, or empty for the whole project. */
export const postAccess = (project: string, group: string) =>
  request<AccessLink>(`/api/access${query({ project })}`, {
    method: "POST",
    body: { group },
  });
