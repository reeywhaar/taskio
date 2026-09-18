import { ago, MONTH, WEEK } from "@app/ago";
import { CheckIcon, PinIcon, UndoIcon } from "@app/components/icons/Icon";
import type { Task } from "@app/api/types";
import { excerpt } from "@app/markdown";
import { TaskId } from "@app/islands/app/TaskId";

/**
 * The card is the way in, and while a selection is being made it is the way to pick instead.
 * The title stays a real button so the keyboard and a screen reader have something to land on
 * and announce, but it carries no hover of its own: underlining one line of a card that is
 * entirely clickable says the rest of it is not.
 *
 * Everything else in the card is a control in its own right — the mark, the id, a link in the
 * description — and each stops the click from reaching the card behind it.
 *
 * Marking a task done lives at the right as a mark, and while a selection is being made the
 * selection's box stands in that same place — there is nothing to mark done from a row somebody
 * is picking, and a box added on the left is a column that moves every row sideways when Select
 * is pressed. The left column carries what the task is: its id, whether it is pinned, what it is
 * worth. See docs/interface.md.
 *
 * The mark, the id and the title's first line share one band the height of that line, and each
 * centres inside it. They are three different font sizes, so aligning their tops puts them on
 * three different baselines; centring the row instead fails on a wrapped title, which pushes
 * its first line above the marks and its second below.
 */
/**
 * What a task sorts under: pinned first, then the number.
 *
 * Exported because the list draws the gap between one run and the next, and it is the same
 * answer the server sorted by — two spellings of it would put a line in the wrong place.
 */
export function rank(task: Task): string {
  return `${task.pinned ? 1 : 0}:${task.priority}`;
}

export function TaskRow({
  task,
  apart = false,
  selectable = false,
  selected = false,
  onSelect,
  onOpen,
  onToggleDone,
  onTogglePinned,
}: {
  task: Task;
  /** Set on the first row of a new run, which is where the wider gap goes. */
  apart?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onOpen: (id: string) => void;
  /** Left out where the row is not in the list it would change: the search results from
   *  elsewhere are rows about tasks the list above is not showing, and a tick there is a change
   *  nobody can see the result of. The row still opens. */
  onToggleDone?: (task: Task) => void;
  onTogglePinned?: (task: Task) => void;
}) {
  const done = task.status === "done";
  const pieces = excerpt(task.description);

  /**
   * How long the task has been sitting there, and whether that is a problem yet.
   *
   * A week is where a task starts looking neglected and a month is where it starts looking
   * abandoned — the two marks are the whole feature, and the grey between them is the row
   * saying there is nothing to see.
   *
   * A finished task is never late. It stays grey however old it is, because red on a thing that
   * is done says it needs attention, which is the one thing it does not.
   */
  const since = Date.now() / 1000 - task.updated_at;
  const age =
    done || since < WEEK
      ? "text-faint"
      : since < MONTH
        ? "text-warn"
        : "text-accent";

  return (
    <li
      data-task={task.id}
      onClick={() => {
        // A click that ends a text selection is somebody reading, not somebody pressing.
        if (window.getSelection()?.toString()) return;
        // While picking, the card picks. Opening a task from a row somebody is ticking is the
        // wrong half of a mode, and the box is a small target to have to hit.
        if (selectable) onSelect?.(task.id);
        else onOpen(task.id);
      }}
      className={`raised group relative flex cursor-pointer items-start gap-3 overflow-hidden rounded-lg bg-bg py-2.5 pr-3 pl-3 ${
        apart ? "mt-4" : ""
      }`}
    >
      {/* A bar cropped by the card rather than a border drawn along its edge: a border follows
          the radius and comes out as a leaf. This is a straight line, and the corners take the
          ends off it.

          The twelve pixels of padding beside it are there whether or not there is a bar, so a
          list lines up whether three rows are colored or none. */}
      {task.color ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1 bg-[image:var(--sheen)]"
          style={{ backgroundColor: task.color }}
        />
      ) : null}

      {/* A width, so every row's title starts in the same place. The column used to be as wide
          as an id and nothing else, which is a fixed number of characters; an age is words, and
          without this each row would set its own left margin and the titles would come out
          ragged down the list.

          68px: the longest thing this vocabulary can say is "11 months ago", measured at 63 in
          the face and size it is drawn in, and the id under it is 58. */}
      <span
        className="flex w-17 shrink-0 flex-col items-start"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex h-6 items-center">
          <TaskId id={task.id} />
        </span>

        {/* The exact time is in the tooltip and nowhere else: nobody reads a timestamp and
            thinks "six weeks", they read the number and then do the arithmetic, if they
            bother.

            Smaller than anything else on the row and tucked under the id, because it is a
            thing to notice rather than a thing to read: at the size of the text beside it, a
            date on every row is a second column of writing competing with the titles. The
            margin below it is the gap the column used to carry uniformly — the date belongs to
            the id above it, and the number and the pin below are their own pair. */}
        <time
          dateTime={new Date(task.updated_at * 1000).toISOString()}
          title={`Last changed ${new Date(task.updated_at * 1000).toLocaleString()}`}
          className={`mt-0.5 mb-2 text-[9px] leading-3 whitespace-nowrap ${age}`}
        >
          {ago(task.updated_at)}
        </time>

        {/* Under the id, where the column is already as wide as eight characters and nothing
            else is using the room. The number leads: an unpinned row still spends the pin's
            width, and behind it the number would sit off the left edge the id sets. */}
        <span className="flex items-center gap-1">
          {/* A nought on every row is a column of noughts that says nothing, so it keeps out
              of the way until somebody points at the row — where it stands beside the pin
              rather than leaving it there on its own.

              Unless the row is pinned. The pin is drawn whether or not anybody is pointing,
              and with an invisible nought holding the place in front of it, it hangs in the
              middle of a column with nothing under the id. A nought beside it costs the row
              nothing and gives the pin something to stand next to. */}
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${
              task.priority === 0 ? "bg-line text-muted" : "wash"
            } ${
              task.priority === 0 && !task.pinned
                ? "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100"
                : ""
            }`}
            title={`Priority ${task.priority}`}
          >
            {task.priority}
          </span>

          <button
            type="button"
            hidden={!onTogglePinned}
            aria-label={task.pinned ? "Unpin" : "Pin"}
            title={task.pinned ? "Unpin" : "Pin"}
            aria-pressed={task.pinned}
            onClick={() => onTogglePinned?.(task)}
            className={`flex items-center rounded-md p-0.5 text-base hover:bg-line ${
              task.pinned
                ? "text-brand"
                : "text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            }`}
          >
            <PinIcon />
          </button>
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
            {/* The page's own ground, not a fill: the card hovers to the fill color, and a
                chip painted in it would disappear exactly when somebody points at the card. */}
            {task.tags.map((slug) => (
              <span
                key={slug}
                className="rounded-full bg-fill px-2 py-0.5 text-xs text-muted"
              >
                {slug}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* The box stands where the mark stands, and the two are the same size, so pressing
          Select changes what is in that slot and moves nothing. Beside the id it was a seventh
          column appearing on the left, which pushed every row's contents sideways the moment a
          selection began — and there was already a control here doing nothing while picking.

          The box reports the tick itself; without stopping the click the card behind it
          reports a second one and the row toggles back to where it started. */}
      {selectable ? (
        <span
          className="flex h-6 w-8 shrink-0 items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            aria-label="Select"
            checked={selected}
            onChange={() => onSelect?.(task.id)}
            className="size-4"
          />
        </span>
      ) : (
        <button
          type="button"
          hidden={!onToggleDone}
          aria-label={done ? "Mark as todo" : "Mark done"}
          title={done ? "Mark as todo" : "Mark done"}
          aria-pressed={done}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone?.(task);
          }}
          // Drawn on the row that is being pointed at rather than on all ninety of them: a
          // column of marks down a list is a column of marks. A finger has no hover to wait
          // for, so under one it is simply there — which is the same rule as the pin above,
          // read from the other end.
          className={`flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-lg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 hover:bg-line ${
            done ? "text-brand" : "text-muted hover:text-fg"
          }`}
        >
          {done ? <UndoIcon /> : <CheckIcon />}
        </button>
      )}
    </li>
  );
}
