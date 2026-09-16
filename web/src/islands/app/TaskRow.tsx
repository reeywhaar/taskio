import { CheckIcon, PinIcon, UndoIcon } from "@app/components/icons/Icon";
import type { Task } from "@app/api/types";
import { excerpt } from "@app/markdown";
import { TaskId } from "@app/islands/app/TaskId";

/**
 * The card is the way in. The title stays a real button so the keyboard and a screen reader
 * have something to land on and announce, but it carries no hover of its own: underlining one
 * line of a card that is entirely clickable says the rest of it is not.
 *
 * Everything else in the card is a control in its own right — the mark, the id, a link in the
 * description — and each stops the click from reaching the card behind it.
 *
 * Finishing a task lives at the right as a mark. The left column carries what the task is —
 * its id, whether it is pinned, what it is worth — and the selection's box when there is one.
 * See docs/interface.md.
 *
 * The mark, the id and the title's first line share one band the height of that line, and each
 * centres inside it. They are three different font sizes, so aligning their tops puts them on
 * three different baselines; centring the row instead fails on a wrapped title, which pushes
 * its first line above the marks and its second below.
 */
export function TaskRow({
  task,
  selectable,
  selected,
  onSelect,
  onOpen,
  onToggleDone,
  onTogglePinned,
}: {
  task: Task;
  selectable: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleDone: (task: Task) => void;
  onTogglePinned: (task: Task) => void;
}) {
  const done = task.status === "done";
  const pieces = excerpt(task.description);

  return (
    <li
      onClick={() => {
        // A click that ends a selection is somebody reading, not somebody opening.
        if (window.getSelection()?.toString()) return;
        onOpen(task.id);
      }}
      className="group flex cursor-pointer items-start gap-3 rounded-lg bg-surface px-3 py-2.5 hover:bg-fill"
    >
      {selectable ? (
        <span className="flex h-6 shrink-0 items-center">
          <input
            type="checkbox"
            aria-label={`Select ${task.title}`}
            checked={selected}
            onChange={() => onSelect(task.id)}
            className="size-4"
          />
        </span>
      ) : null}

      <span
        className="flex shrink-0 flex-col items-start gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex h-6 items-center">
          <TaskId id={task.id} />
        </span>

        {/* Under the id, where the column is already as wide as eight characters and nothing
            else is using the room. */}
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={
              task.pinned ? `Unpin ${task.title}` : `Pin ${task.title}`
            }
            aria-pressed={task.pinned}
            onClick={() => onTogglePinned(task)}
            className={`flex items-center rounded-md p-0.5 text-base hover:bg-line ${
              task.pinned
                ? "text-brand"
                : "text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <PinIcon />
          </button>

          {/* Only when it has one. A zero on every row is a column of noughts that says
              nothing, and the number is here to be noticed. */}
          {task.priority !== 0 ? (
            <span
              className="rounded-full bg-brand px-1.5 py-0.5 text-xs font-medium tabular-nums text-brand-ink"
              title={`Priority ${task.priority}`}
            >
              {task.priority}
            </span>
          ) : null}
        </span>
      </span>

      <div className="min-w-0 flex-1">
        {/* A button, so the keyboard and a screen reader have something to land on and
            announce. Its click reaches the card like any other, which is what opens the
            task — one way in, by mouse and by keyboard. */}
        <button
          type="button"
          className={`block w-full cursor-pointer text-left text-base leading-6 ${
            done ? "text-muted line-through" : ""
          }`}
        >
          {task.title}
        </button>

        {pieces.length > 0 ? (
          // Two lines at most, and the clamp draws its own ellipsis: how many lines fit is a
          // question about a width no other layer can see. A link stays a link because a
          // description is often mostly one, and the click is the link's, not the row's.
          <p className="line-clamp-2 text-sm text-muted">
            {pieces.map((piece, i) =>
              piece.br ? (
                <br key={i} />
              ) : piece.href ? (
                <a
                  key={i}
                  href={piece.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {piece.text}
                </a>
              ) : (
                <span key={i}>{piece.text}</span>
              ),
            )}
          </p>
        ) : null}

        {task.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {/* The page's own ground, not a fill: the card hovers to the fill colour, and a
                chip painted in it would disappear exactly when somebody points at the card. */}
            {task.tags.map((slug) => (
              <span
                key={slug}
                className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted"
              >
                {slug}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        aria-label={done ? `Reopen ${task.title}` : `Finish ${task.title}`}
        aria-pressed={done}
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone(task);
        }}
        className={`flex h-6 shrink-0 items-center rounded-md px-1.5 text-lg hover:bg-line ${
          done ? "text-brand" : "text-muted hover:text-fg"
        }`}
      >
        {done ? <UndoIcon /> : <CheckIcon />}
      </button>
    </li>
  );
}
