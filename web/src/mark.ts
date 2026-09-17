/**
 * The mark, drawn from its geometry rather than fetched.
 *
 * Two rectangles on a rounded tile, the same shape as public/favicon.svg — which stays a file
 * because the first paint of every page needs one before any of this has run. The test beside
 * this keeps the two the same shape.
 *
 * Here as well as there because the color changes: a group wears its own, and the tab it is
 * open in wears the group's, so two windows are two icons rather than two of the same one.
 */

/** What the mark wears with no group chosen. Matches --color-brand in the light theme. */
export const BRAND = "#ef6500";

/** The tile under the letter. Pale at either theme, because a favicon has no theme. */
const GROUND = "#fff7f0";

export function markSVG(color: string = BRAND): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="taskio">`,
    `<rect width="32" height="32" rx="7" fill="${GROUND}"/>`,
    `<g fill="${paint(color)}">`,
    `<rect x="6" y="7" width="20" height="6" rx="1"/>`,
    `<rect x="13" y="7" width="6" height="18" rx="1"/>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/** Ready for an href or a src. */
export function markURI(color?: string): string {
  return `data:image/svg+xml,${encodeURIComponent(markSVG(color))}`;
}

/**
 * Six hex digits after a hash, or the brand.
 *
 * The server refuses anything else, and this is the second place that has to be sure: the value
 * is written straight into an attribute, and a color that could be anything is a color that
 * could close the quote.
 */
function paint(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : BRAND;
}
