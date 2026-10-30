import {
  getTasksById,
  patchTasksById,
  patchTasksByIdCommentsById,
} from "@app/api/actions/tasks";

/**
 * Uploads that outlive the dialog they were started in.
 *
 * A file pasted, dropped or attached puts a placeholder in the text and swaps it for the file's
 * address when the upload finishes. Saved before then, the placeholder was what got saved, and
 * the swap had nothing left to happen in: the dialog was gone. So each upload is held here by its placeholder, and whatever
 * saves text that still holds one asks to have it finished in the saved copy instead.
 *
 * Kept for the page's life rather than dropped when done: a save can be sent before an upload
 * finishes and answered after, and the placeholder in it still needs its answer.
 */
const pending = new Map<string, Promise<string>>();

/** An upload on its way: what replaces the placeholder when it lands, "" when it fails. */
export function track(placeholder: string, markdown: Promise<string>) {
  pending.set(
    placeholder,
    markdown.catch(() => ""),
  );
}

/** Whether a text still holds an upload on its way. */
export const awaiting = (text: string) =>
  [...pending.keys()].some((placeholder) => text.includes(placeholder));

/**
 * Finishes, in the saved copy, the uploads a saved text was still waiting on. One at a time, each
 * reading the copy afresh, so two landing together do not write over each other.
 */
async function finish(
  saved: string,
  read: () => Promise<string>,
  write: (text: string) => Promise<unknown>,
) {
  for (const [placeholder, markdown] of pending) {
    if (!saved.includes(placeholder)) continue;
    const final = await markdown;
    const now = await read();
    if (now.includes(placeholder)) await write(now.replace(placeholder, final));
  }
}

/** A task's description, saved with uploads still on their way. */
export function finishInTask(id: string, saved: string) {
  if (!awaiting(saved)) return;
  void finish(
    saved,
    () => getTasksById(id).then((task) => task.description),
    (description) => patchTasksById(id, { description }),
  ).catch((err) => console.error("An upload could not be finished", err));
}

/** A comment, saved with uploads still on their way. */
export function finishInComment(task: string, comment: string, saved: string) {
  if (!awaiting(saved)) return;
  void finish(
    saved,
    () =>
      getTasksById(task).then(
        (t) => t.comments.find((c) => c.id === comment)?.body ?? "",
      ),
    (body) => patchTasksByIdCommentsById(task, comment, body),
  ).catch((err) => console.error("An upload could not be finished", err));
}
