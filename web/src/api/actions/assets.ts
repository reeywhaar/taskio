import { request } from "@app/api/transport";
import type { Asset } from "@app/api/types";

/** The raw bytes as the body: there is one file and no fields. */
export const postAssets = (file: File) =>
  request<Asset>("/api/assets", {
    method: "POST",
    raw: { contentType: file.type, body: file },
  });
