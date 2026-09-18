/**
 * How long ago, in the coarsest unit that still says something.
 *
 * A task's own date is the only thing on a row that says whether it is still live. An exact
 * timestamp does not: nobody reads "2026-08-04 11:42" and thinks "six weeks"; they read the
 * number and then do the arithmetic, if they bother. The point of the label is to be understood
 * without doing any.
 *
 * Coarse on purpose, and coarser the further back it goes. The difference between eleven and
 * twelve minutes is not worth a word, and the difference between one week and two is the whole
 * reason this exists.
 */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The two marks on the scale, and what the row is colored by. Seconds, like the timestamps. */
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** at and now are unix seconds, which is what the API speaks. */
export function ago(at: number, now: number = Date.now() / 1000): string {
  const since = Math.max(0, Math.floor(now - at));

  // A clock a few seconds out of step would otherwise say a task was touched in the future.
  if (since < MINUTE) return "just now";
  if (since < HOUR) return count(since / MINUTE, "min");
  if (since < DAY) return count(since / HOUR, "hour");
  if (since < WEEK) return count(since / DAY, "day");
  if (since < MONTH) return count(since / WEEK, "week");
  if (since < YEAR) return count(since / MONTH, "month");
  return count(since / YEAR, "year");
}

/** "1 week ago", "3 weeks ago" — the plural is the only thing that varies. */
function count(n: number, unit: string): string {
  const whole = Math.floor(n);
  return `${whole} ${unit}${whole === 1 ? "" : "s"} ago`;
}
