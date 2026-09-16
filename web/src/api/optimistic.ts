import type { QueryClient } from "@tanstack/react-query";

import { qk } from "@app/api/keys";
import type { Task, TaskPage } from "@app/api/types";

/** What a rollback needs: the pages as they were, keyed the way they were found. */
type Snapshot = [readonly unknown[], TaskPage | undefined][];

/**
 * Shows the answer before the server gives it.
 *
 * A pin or a tick is one bit, and waiting a round trip to draw it makes a button that feels
 * broken — the press does nothing, and somebody presses it again. The row is changed in every
 * cached list at once, the request goes out behind it, and a refusal puts the old pages back.
 *
 * Only what the row draws is changed here. Where the row then belongs is the server's answer,
 * because the ordering has a tiebreak this side does not know.
 */
export async function optimisticTask(
  client: QueryClient,
  id: string,
  change: (task: Task) => Task,
): Promise<Snapshot> {
  // In flight already, a refetch would land after this and undo it.
  await client.cancelQueries({ queryKey: qk.tasks });

  const before = client.getQueriesData<TaskPage>({ queryKey: qk.tasks });
  client.setQueriesData<TaskPage>({ queryKey: qk.tasks }, (page) =>
    page?.tasks
      ? {
          ...page,
          tasks: page.tasks.map((task) =>
            task.id === id ? change(task) : task,
          ),
        }
      : page,
  );
  return before;
}

export function restoreTasks(client: QueryClient, before: Snapshot) {
  for (const [key, page] of before) client.setQueryData(key, page);
}
