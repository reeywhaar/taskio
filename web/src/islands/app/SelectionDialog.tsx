import { useQueries } from "@tanstack/react-query";

import { getTasksById } from "@app/api/actions/tasks";
import { qk } from "@app/api/keys";
import { Dialog } from "@app/components/Dialog";
import { TaskRow } from "@app/islands/app/TaskRow";

/**
 * What is selected, as rows with nothing to press.
 *
 * Each task is asked for by id rather than read off the list: a selection can span the todo and
 * done views and a search into another project, so most of it may be nowhere on screen.
 */
export function SelectionDialog({
  open,
  ids,
  onClose,
}: {
  open: boolean;
  ids: string[];
  onClose: () => void;
}) {
  const tasks = useQueries({
    queries: open
      ? ids.map((id) => ({
          queryKey: qk.task(id),
          queryFn: () => getTasksById(id),
        }))
      : [],
  });

  return (
    <Dialog open={open} onClose={onClose} title={`${ids.length} selected`}>
      <ul className="flex flex-col gap-2">
        {tasks.map((task, i) =>
          task.data ? (
            <TaskRow key={ids[i]} task={task.data} still />
          ) : (
            <li
              key={ids[i]}
              className="rounded-lg bg-fill px-3 py-2.5 font-mono text-xs text-faint"
            >
              {task.isError ? `${ids[i]} could not be read` : ids[i]}
            </li>
          ),
        )}
      </ul>
    </Dialog>
  );
}
