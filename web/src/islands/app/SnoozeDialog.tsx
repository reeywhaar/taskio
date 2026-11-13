import { useEffect, useState } from "react";

import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { NumberField } from "@app/components/NumberField";
import { Select } from "@app/components/Select";

type Unit = "days" | "weeks";

/**
 * When a snooze of so many days or weeks ends: noon, here, on that day.
 *
 * A day rather than a moment, because "in three days" is what somebody means, and noon so the
 * task is back before the afternoon whichever zone somebody is in or travels to.
 */
export function wakeAt(count: number, unit: Unit, from = new Date()): Date {
  const at = new Date(from);
  at.setDate(at.getDate() + count * (unit === "weeks" ? 7 : 1));
  at.setHours(12, 0, 0, 0);
  return at;
}

/**
 * Off the list for so many days or weeks.
 *
 * Wake now is here rather than in the footer behind it: one button there for a task's sleep,
 * and what it offers depends on whether the task is asleep.
 */
export function SnoozeDialog({
  open,
  until,
  onSnooze,
  onWake,
  onClose,
}: {
  open: boolean;
  /** When it is snoozed until now, in unix seconds; null for a task on the list. */
  until: number | null;
  /** Unix seconds. */
  onSnooze: (until: number) => Promise<unknown>;
  onWake: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [count, setCount] = useState("1");
  const [unit, setUnit] = useState<Unit>("days");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCount("1");
      setUnit("days");
    }
  }, [open]);

  const n = Math.max(1, Math.floor(Number(count)) || 1);
  const at = wakeAt(n, unit);

  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await what();
    } finally {
      setBusy(false);
    }
  };
  const snooze = () => run(() => onSnooze(Math.floor(at.getTime() / 1000)));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Snooze"
      footer={
        <>
          {until ? (
            <Button disabled={busy} onClick={() => void run(onWake)}>
              Wake now
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="solid" disabled={busy} onClick={() => void snooze()}>
            Snooze
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void snooze();
        }}
      >
        {until ? (
          <p className="text-sm text-muted">
            Snoozed until {dayOf(new Date(until * 1000))}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">By</span>
          <NumberField
            data-autofocus
            label="How many"
            min={1}
            value={count}
            onChange={(next) =>
              setCount(next !== "" && Number(next) < 1 ? "1" : next)
            }
          />
          <Select
            aria-label="Days or weeks"
            className="w-28"
            value={unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
          >
            <option value="days">{n === 1 ? "day" : "days"}</option>
            <option value="weeks">{n === 1 ? "week" : "weeks"}</option>
          </Select>
        </div>
        <p className="text-xs text-muted">
          Off the list until {dayOf(at)}, at noon. It comes back as if just
          poked.
        </p>
      </form>
    </Dialog>
  );
}

/** "Thu, Nov 20", with the year only when it is not this one. */
export function dayOf(at: Date): string {
  return at.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(at.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
