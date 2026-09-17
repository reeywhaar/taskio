import type { InputHTMLAttributes, ReactNode } from "react";

import { MinusIcon, PlusIcon } from "@app/components/icons/Icon";
import { TextField } from "@app/components/TextField";

/**
 * A number, with the two buttons the platform does not draw.
 *
 * No browser on a phone renders the spinner on `input[type=number]` — iOS Safari included — so
 * on the one device where the keyboard is most in the way, the only way to change a number was
 * to type it. These are ordinary buttons, which every browser draws, and they are the size of
 * the field rather than the size of a spinner arrow, because the pointer that needed them is a
 * finger.
 *
 * The native spinner is turned off everywhere rather than left to appear beside ours on a
 * desktop — see main.css. Two steppers on one field is a field restyled twice.
 *
 * The value is a string, like the draft it comes from: a cleared number input reads as NaN, and
 * "" and "-" are both things somebody passes through on the way to typing -1. Anything that is
 * not a number counts as nought, so a step from a half-typed field is still a step.
 */
export function NumberField({
  value,
  onChange,
  label,
  className = "",
  ...props
}: {
  value: string;
  onChange: (next: string) => void;
  /**
   * What is being counted, which names all three controls: the field, and "Decrease Priority"
   * and "Increase Priority" either side of it.
   *
   * Said here rather than taken from a caption above, because a caption cannot reach these. A
   * label element wrapping this would attach itself to the first labelable thing inside — which
   * is a button, not the field — so the callers use Group, and the name comes down as a prop.
   */
  label: string;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
>) {
  const step = (by: number) => {
    const n = Number(value);
    onChange(String((Number.isFinite(n) ? n : 0) + by));
  };

  return (
    <div className="flex items-center gap-1.5">
      <Step label={`Decrease ${label}`} onClick={() => step(-1)}>
        <MinusIcon />
      </Step>
      <TextField
        type="number"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-16 text-center ${className}`}
        {...props}
      />
      <Step label={`Increase ${label}`} onClick={() => step(1)}>
        <PlusIcon />
      </Step>
    </div>
  );
}

/** Square, and the height of the field it stands beside, which is where the size comes from. */
function Step({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="raised flex size-10 shrink-0 items-center justify-center rounded-md bg-bg text-muted sm:size-11 hover:text-fg"
    >
      {children}
    </button>
  );
}
