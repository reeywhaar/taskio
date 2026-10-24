import { rememberSizes } from "@app/api/images";
import { request } from "@app/api/transport";
import type { Asset } from "@app/api/types";

/** The raw bytes as the body: there is one file and no fields. The size it is meant to be drawn
 *  at is remembered before the markdown naming it renders. */
export const postAssets = (file: File) =>
  request<Asset>("/api/assets", {
    method: "POST",
    raw: { contentType: file.type, body: file },
  }).then((asset) => {
    if (asset.width && asset.height)
      rememberSizes({
        [asset.id]: { width: asset.width, height: asset.height },
      });
    return asset;
  });
