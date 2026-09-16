import type { ReactNode } from "react";

/**
 * A label above its control, and the hint below both.
 *
 * A placeholder is not a label: it is gone the moment somebody types, so a filled form becomes
 * a column of values nobody can name.
 *
 * The hint sits outside the label element on purpose. Inside it, a wrapping label makes every
 * word it contains part of the control's accessible name, and the field announces itself as
 * "New password At least 8 characters" — the hint read as if it were the question.
 */
export function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  /** Spans both columns of the grid below. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <label className="flex flex-col gap-1">
        <span className="text-muted">{label}</span>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
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
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <p className="mb-1 text-muted">{label}</p>
      <div role="group" aria-label={label}>
        {children}
      </div>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

/** Two columns where there is room, one where there is not. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}
