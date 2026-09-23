import { ago, MONTH, WEEK } from "@app/ago";
import { Boundary } from "@app/components/Boundary";
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
  still = false,
}: {
  task: Task;
  /** Nothing to press: a row that shows a task and does nothing else, for a list of them
   *  somewhere that is not the list, like the bulk bar's selection. */
  still?: boolean;
  /** Set on the first row of a new run, which is where the wider gap goes. */
  apart?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
  /** Left out where the row is not in the list it would change: the search results from
   *  elsewhere are rows about tasks the list above is not showing, and a tick there is a change
   *  nobody can see the result of. The row still opens. */
  onToggleDone?: (task: Task) => void;
  onTogglePinned?: (task: Task) => void;
}) {
  // Finished with, whichever way it got there: both leave the todo list, both are struck
  // through, and both offer the way back rather than the way forward.
  const finished = task.status !== "todo";
  const binned = task.status === "deleted";
  // The one control on the right, and the three things it can mean.
  const mark = binned ? "Restore" : finished ? "Mark as todo" : "Mark done";

  /**
   * How long the task has been sitting there, and whether that is a problem yet.
   *
   * A week is where a task starts looking neglected and a month is where it starts looking
   * abandoned — the two marks are the whole feature, and the grey between them is the row
   * saying there is nothing to see.
   *
   * A finished task is never late. It stays grey however old it is, because red on a thing that
   * is done says it needs attention, which is the one thing it does not.
   *
   * What the number counts from is the last thing that happened to the task rather than the last
   * time anything was written to it. A finished list is a record of what was finished, so the
   * useful moment there is the finishing — a task closed a minute ago read "8 hours ago" because
   * somebody had edited its description that morning, which is true and is not what anybody is
   * reading the column for.
   *
   * A todo counts from its last poke, for the same reason: a tag taken off in bulk is a write,
   * and it said the task had been looked at when nobody had.
   */
  const at = binned
    ? (task.deleted_at ?? task.updated_at)
    : finished
      ? (task.done_at ?? task.updated_at)
      : task.poked_at;

  const since = Date.now() / 1000 - at;
  const age =
    finished || since < WEEK
      ? "text-faint"
      : since < MONTH
        ? "text-warn"
        : "text-accent";

  return (
    <li
      data-task={task.id}
      onClick={() => {
        if (still) return;
        // A click that ends a text selection is somebody reading, not somebody pressing.
        if (window.getSelection()?.toString()) return;
        // While picking, the card picks. Opening a task from a row somebody is ticking is the
        // wrong half of a mode, and the box is a small target to have to hit.
        if (selectable) onSelect?.(task.id);
        else onOpen?.(task.id);
      }}
      // Three columns wide, two rows narrow: on a phone the column and the mark took 100px of
      // 390 and left the title a four-line ribbon. Placed rather than duplicated.
      className={`raised relative grid grid-cols-[1fr_auto] ${still ? "" : "group cursor-pointer"} items-start gap-x-3 gap-y-1 overflow-hidden rounded-lg bg-bg py-2.5 pr-3 pl-3 sm:grid-cols-[auto_1fr_auto] sm:gap-y-0 ${
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

      {/* 68px above the breakpoint, so every title starts in the same place: "11 months ago"
          measures 63 and the id under it 58. A row across the top below it. */}
      <span
        className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 sm:w-17 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex h-6 items-center">
          {still ? (
            <span className="inline-block w-[8ch] font-mono text-xs tabular-nums text-faint">
              {task.id}
            </span>
          ) : (
            <TaskId id={task.id} />
          )}
        </span>

        {/* Small and tucked under the id: a thing to notice, not to read. One in the bin
            says so instead — it is not waiting for anybody. Exact time in the tooltip. */}
        <time
          dateTime={new Date(at * 1000).toISOString()}
          title={`${
            binned ? "Deleted" : finished ? "Done" : "Last poked"
          } ${new Date(at * 1000).toLocaleString()}`}
          className={`text-[9px] leading-3 whitespace-nowrap sm:mt-0.5 sm:mb-2 ${
            binned ? "text-accent" : age
          }`}
        >
          {binned ? "deleted" : ago(at)}
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

          {still ? (
            task.pinned ? (
              <span
                aria-label="Pinned"
                className="flex items-center p-0.5 text-base text-brand"
              >
                <PinIcon />
              </span>
            ) : null
          ) : (
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
          )}
        </span>
      </span>

      {/* The whole width on a phone, the middle column above that. */}
      <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        {/* A button, so the keyboard and a screen reader have something to land on and
            announce. Its click reaches the card like any other, which is what opens the
            task — one way in, by mouse and by keyboard. */}
        {still ? (
          <p
            className={`text-base leading-6 ${finished ? "text-muted line-through" : ""}`}
          >
            {task.title}
          </p>
        ) : (
          <button
            type="button"
            className={`block w-full cursor-pointer text-left text-base leading-6 ${
              finished ? "text-muted line-through" : ""
            }`}
          >
            {task.title}
          </button>
        )}

        {/* A line saying so, without the retry: a button inside the row is a press on the row. */}
        <Boundary
          fallback={
            <p className="text-sm text-accent">
              The description could not be shown.
            </p>
          }
        >
          <Excerpt source={task.description} still={still} />
        </Boundary>

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
      {still ? null : selectable ? (
        <span
          className="col-start-2 row-start-1 flex h-6 w-8 shrink-0 items-center justify-center sm:col-start-3"
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
          aria-label={mark}
          title={mark}
          aria-pressed={finished}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone?.(task);
          }}
          // Drawn on the row that is being pointed at rather than on all ninety of them: a
          // column of marks down a list is a column of marks. A finger has no hover to wait
          // for, so under one it is simply there — which is the same rule as the pin above,
          // read from the other end.
          className={`col-start-2 row-start-1 flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-lg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 hover:bg-line sm:col-start-3 ${
            finished ? "text-brand" : "text-muted hover:text-fg"
          }`}
        >
          {finished ? <UndoIcon /> : <CheckIcon />}
        </button>
      )}
    </li>
  );
}

/** The row's opening lines, in a component of its own so the boundary around it can catch a
 *  description the parser throws on. */
function Excerpt({ source, still }: { source: string; still: boolean }) {
  const pieces = excerpt(source);
  if (pieces.length === 0) return null;
  return (
    // Two lines at most, and the clamp draws its own ellipsis: how many lines fit is a
    // question about a width no other layer can see. A link stays a link because a
    // description is often mostly one, and the click is the link's, not the row's.
    <p className="line-clamp-2 text-sm text-muted">
      {pieces.map((piece, i) =>
        piece.br ? (
          <br key={i} />
        ) : piece.href && !still ? (
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
  );
}
