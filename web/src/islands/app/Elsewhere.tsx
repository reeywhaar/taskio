import type { Task } from "@app/api/types";
import { DummyRows } from "@app/components/Dummy";
import { TaskRow } from "@app/islands/app/TaskRow";
import type { View } from "@app/islands/app/route";

/**
 * What the same search found outside the filter.
 *
 * A filtered list that comes back empty, or nearly, leaves somebody asking whether the words
 * are wrong or the filter is — and the answer is a question the screen can already answer. So
 * it asks it: the same term against the whole account, minus what is already above.
 *
 * Two groups, because the two reasons a match is missing are different: it is on a task whose
 * tags are not lit, or it is on one that is finished. Each is drawn only if it has anything in
 * it, and the rule is the same as everywhere else — nothing half-drawn, no empty heading.
 *
 * The rows open but do nothing else: a tick or a pin here would act on a task the list above is
 * not showing, which is a change somebody cannot see the result of.
 */
export function Elsewhere({
  found,
  shown,
  view,
  waiting,
  onOpen,
}: {
  found: Task[];
  shown: Task[];
  view: View;
  waiting: boolean;
  onOpen: (id: string) => void;
}) {
  const already = new Set(shown.map((task) => task.id));
  const rest = found.filter((task) => !already.has(task.id));
  const open = rest.filter((task) => task.status !== "done");
  const done = rest.filter((task) => task.status === "done");

  if (waiting) {
    return (
      <div className="mt-8 border-t border-line pt-4">
        <DummyRows count={2} />
      </div>
    );
  }
  if (open.length === 0 && done.length === 0) return null;

  return (
    <div className="mt-8 border-t border-line pt-4">
      {/* "Across all tags" is what this is when a filter is what hid them. On the done list it
          is the unfinished ones, and calling those a matter of tags would be a sentence that
          happens to be true and does not say what somebody is looking at. */}
      <Found
        heading={view === "done" ? "Still to do" : "Across all tags"}
        tasks={open}
        onOpen={onOpen}
      />
      <Found heading="Done tasks" tasks={done} onOpen={onOpen} />
    </div>
  );
}

function Found({
  heading,
  tasks,
  onOpen,
}: {
  heading: string;
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">
        {heading}
      </h2>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}
