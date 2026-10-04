import { useEffect, useRef, useState } from "react";

import type { Task } from "@app/api/types";
import { rank } from "@app/islands/app/TaskRow";

type Hold = {
  /** The list it was taken on: another filter or view is another list, and lets go at once. */
  key: string;
  /** The rows in the order they were on screen, each as it was last known. */
  rows: Task[];
  /** Each row's run as it was when the hold began, for where the gaps between runs go. */
  ranks: Map<string, string>;
};

/** A row that was pressed while the list was held, and where it stood when it let go. */
export type Moved = { id: string; from: number };

/**
 * The list's order held still for a moment after a pin or an unpin.
 *
 * A pinned row moves to the top, and moving it on the press put a different row under the
 * finger for the next press — pinning three in a row meant hunting for each. So the rows stay
 * where they are, each showing what it now is, and the list settles into its real order a few
 * seconds after the last press; another press starts the wait again.
 *
 * The rows are the fresh ones wherever the list still has them, and the held copy where it does
 * not — an unpinned row leaves the pinned view on the refetch, and stays until the hold lets go.
 */
export function useHeldOrder(
  key: string,
  fresh: Task[],
  onRelease: (moved: Moved[]) => void,
  wait = 3000,
) {
  const [held, setHeld] = useState<Hold | null>(null);
  const holding = held !== null && held.key === key ? held : null;
  const latest = useRef(holding);
  latest.current = holding;
  const pressed = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const byId = new Map(fresh.map((task) => [task.id, task]));
  const tasks = holding
    ? [
        ...holding.rows.map((row) => byId.get(row.id) ?? row),
        ...fresh.filter((task) => !holding.ranks.has(task.id)),
      ]
    : fresh;

  /** The run a row is drawn in: as it was when the hold began, while it holds. */
  const rankOf = (task: Task) => holding?.ranks.get(task.id) ?? rank(task);

  const press = (id: string) => {
    setHeld((current) => {
      const base =
        current && current.key === key
          ? current
          : {
              key,
              rows: tasks,
              ranks: new Map(tasks.map((task) => [task.id, rank(task)])),
            };
      return {
        ...base,
        rows: base.rows.map((task) =>
          task.id === id ? { ...task, pinned: !task.pinned } : task,
        ),
      };
    });
    pressed.current.add(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const order = latest.current?.rows.map((task) => task.id) ?? [];
      const moved = [...pressed.current].map((which) => ({
        id: which,
        from: order.indexOf(which),
      }));
      pressed.current = new Set();
      setHeld(null);
      onRelease(moved);
    }, wait);
  };

  return { tasks, rankOf, press };
}
