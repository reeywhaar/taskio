/** The size a pasted picture is meant to be drawn at, in CSS pixels. */
export type ImageSize = { width: number; height: number };

/**
 * Each pasted picture's size, by asset id, as the server read it from the file.
 *
 * A browser draws an <img> a pixel for a pixel, whatever density the file says, so a Retina
 * screenshot came out twice the size it was taken at. The server reads the density when the file
 * arrives and says the size with the task and with the upload; this holds what it said, and the
 * markdown renderer writes it on the <img>. Filled before anything renders from it: the task's
 * fetch and the upload put their answers here before handing them on.
 */
const sizes = new Map<string, ImageSize>();

export function rememberSizes(images: Record<string, ImageSize> | undefined) {
  for (const [id, size] of Object.entries(images ?? {})) sizes.set(id, size);
}

export function sizeOf(id: string): ImageSize | undefined {
  return sizes.get(id);
}
