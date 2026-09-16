/**
 * Both ways of putting something on the clipboard, in the order they should be tried.
 *
 * navigator.clipboard is absent outside a secure context — any instance reached over plain http
 * at something other than localhost — and rejects where the permission is refused, neither of
 * which this screen can fix. execCommand is deprecated and every browser still runs it.
 *
 * Nothing here leaves a selection behind. A control that highlights its own text so a keyboard
 * copy can finish the job does that on every press, including the ones that worked, and eight
 * highlighted characters under the pointer read as a mis-click rather than as a copy.
 *
 * Returns whether it worked, because a confirmation for a copy that did not happen is worse
 * than no confirmation.
 */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacy(text);
  }
}

function legacy(text: string): boolean {
  // Off-screen rather than hidden: a control that is not displayed cannot hold a selection, and
  // the selection is what execCommand copies.
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText =
    "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(box);
  box.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    box.remove();
  }
}
