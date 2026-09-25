import type { QueryClient } from "@tanstack/react-query";

import { qk } from "@app/api/keys";
import type { Task, TaskPage } from "@app/api/types";

/** What a rollback needs: the pages as they were, keyed the way they were found. */
type Snapshot = [readonly unknown[], TaskPage | undefined][];

/**
 * The live list's order, as the server writes it: pinned, then priority, then the last poke.
 *
 * The server breaks a tie on all three with an internal sequence this side never sees — and
 * does not need to, because a page arrives in that order already and a stable sort leaves
 * equal rows where it found them. Sorting a server-ordered page therefore lands on exactly
 * the order the server would send back.
 */
function inOrder(tasks: Task[]): Task[] {
  // eslint-disable-next-line unicorn/no-array-sort -- a copy, so there is nothing to mutate
  return [...tasks].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.priority - a.priority ||
      b.poked_at - a.poked_at,
  );
}

/**
 * Shows the answer before the server gives it.
 *
 * A pin or a tick is one bit, and waiting a round trip to draw it makes a button that feels
 * broken — the press does nothing, and somebody presses it again. The row is changed in every
 * cached list at once, the request goes out behind it, and a refusal puts the old pages back.
 *
 * `resort` names the list on screen, which is also put in its new order rather than left to be
 * re-sorted by the answer. Two rearrangements for one press is one too many to watch.
 *
 * The answer still arrives and still renders — the server moves `updated_at`, so the rows are
 * not identical to these — but it arrives in the order already on screen, so that render moves
 * nothing. One press, one rearrangement.
 */
export async function optimisticTask(
  client: QueryClient,
  id: string,
  change: (task: Task) => Task,
  resort?: readonly unknown[],
): Promise<Snapshot> {
  // In flight already, a refetch would land after this and undo it.
  await client.cancelQueries({ queryKey: qk.tasks });

  const before = client.getQueriesData<TaskPage>({ queryKey: qk.tasks });
  const key = resort ? JSON.stringify(resort) : null;

  for (const [at, page] of before) {
    if (!page?.tasks) continue;
    const tasks = page.tasks.map((task) =>
      task.id === id ? change(task) : task,
    );
    client.setQueryData<TaskPage>(at, {
      ...page,
      tasks: key === JSON.stringify(at) ? inOrder(tasks) : tasks,
    });
  }
  return before;
}

export function restoreTasks(client: QueryClient, before: Snapshot) {
  for (const [key, page] of before) client.setQueryData(key, page);
}
