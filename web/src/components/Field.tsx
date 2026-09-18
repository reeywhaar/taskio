import { useId, useState, type ReactNode } from "react";

import { Dialog } from "@app/components/Dialog";
import { QuestionIcon } from "@app/components/icons/Icon";

/**
 * A label above its control, and what the control means behind a question mark beside it.
 *
 * A placeholder is not a label: it is gone the moment somebody types, so a filled form becomes
 * a column of values nobody can name.
 *
 * The explanation used to be a line of small grey text under every field, which is a form that
 * reads as twice as long as it is and says most of it to people who already knew. Behind a mark
 * it is there when it is wanted and takes no room when it is not — and there is space in a
 * dialog to say the whole thing rather than the half that fits on one line.
 */
export function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  /** Spans both columns of the grid below. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      {/*
        A grid rather than a column, so the mark can sit beside the caption while staying after
        the control in the DOM.

        A label takes the first labelable thing inside it, and a button is one: drawn where it
        looks like it belongs, the caption would stop naming the field and start naming the
        question mark. Placed after the control and lifted into the first row, the field is
        still the first thing the caption finds, and a reader meets the explanation after the
        thing it explains — which is the order it is useful in.
      */}
      <label className="grid grid-cols-[auto_auto_1fr] items-center gap-x-1 gap-y-1">
        <span className="col-start-1 row-start-1 text-muted">{label}</span>
        <span className="col-span-3 row-start-2 block">{children}</span>
        {hint ? (
          <span className="col-start-2 row-start-1 flex">
            <Help label={label}>{hint}</Help>
          </span>
        ) : null}
      </label>
    </div>
  );
}

/**
 * A caption over something that is not one control.
 *
 * Field wraps its child in a label, which is right for an input and wrong for a set of
 * buttons: a label takes the first labelable thing inside it, so the first pill ends up
 * announced as the caption plus every other pill's text, and the rest are announced as
 * nothing. The caption here names the group instead.
 */
export function Group({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <div className="mb-1 flex items-center gap-1">
        <p className="text-muted">{label}</p>
        {hint ? <Help label={label}>{hint}</Help> : null}
      </div>
      <div role="group" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/**
 * What a field means, one press away.
 *
 * Its own dialog rather than a tooltip: a tooltip is a hover, and half the people reading this
 * are holding a phone. It is the shared modal, so it sits above the dialog it was opened from
 * and Escape takes the explanation off rather than the form.
 */
function Help({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <button
        type="button"
        aria-label={`About ${label.toLowerCase()}`}
        title={`About ${label.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(true)}
        className="flex rounded-full p-0.5 text-faint hover:text-fg"
      >
        <QuestionIcon />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label}>
        {/* A column, because there is room here for more than the one line that used to fit
            under a field, and a hint worth opening is usually more than one. */}
        <div id={id} className="flex flex-col gap-3 text-sm text-muted">
          {children}
        </div>
      </Dialog>
    </>
  );
}

/** Two columns where there is room, one where there is not. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
