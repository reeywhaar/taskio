import type { ButtonHTMLAttributes } from "react";

/**
 * Three variants, and choosing between them is the whole decision.
 *
 * solid is the brand color, which is the one thing on a screen of greys that is this
 * application rather than the browser's furniture. quiet is filled rather than outlined:
 * bordered, it draws a second rounded rectangle inside the one a panel already draws.
 *
 * The size is the control size, stated rather than inherited from the text inside. A button is
 * usually beside a field, and one sized by its own label is 33px next to a 36px input in a row
 * that centres them and a squat block in a row that stretches them. A floor on the width is
 * the same argument sideways: "Add" is three characters and should not be a square.
 */
type Variant = "solid" | "quiet" | "link" | "danger";

/**
 * How tall, which is a question about what the button is standing next to.
 *
 * field and bar are one height, a field's, which is the bar's: 36px, a finger included. A
 * field's was 44, and a page of single buttons — Sign out, Change password… — read as a column of
 * slabs for the lightest things on it; 40 on a phone was the same slab, a little shorter.
 *
 * What is left between them is the width. field keeps a floor, 64px on a phone and 80 above, so
 * "Add" is not a square: four buttons in a task's footer were 7px too wide for a 390px screen at
 * 80, and wrapped. bar has none, because four controls on one line is worth more on a phone than
 * a square Select, and the row wrapped at every width below 390px because of it.
 */
type Size = "field" | "bar" | "compact";

// compact is the bulk bar's: eight controls, and at bar size they wrapped to a second line.
const shapes: Record<Size, string> = {
  field: "min-h-9 min-w-16 px-3 py-1.5 text-sm sm:min-w-20",
  bar: "min-h-9 px-3 py-1.5 text-sm",
  compact: "min-h-7 px-2 py-1 text-xs pointer-coarse:min-h-9",
};

const styles: Record<Variant, string> = {
  solid: "raised wash",
  quiet: "raised bg-bg text-muted hover:text-fg",
  link: "text-muted underline-offset-2 hover:text-fg hover:underline",
  danger: "raised bg-bg text-accent",
};

/*
 * A label ends in "…" when the command stops to ask — a choice, a confirmation, a form it cannot
 * run without — and not when it acts on the press, opens a thing to be written, or names a thing.
 * See docs/interface.md.
 */
export function Button({
  variant = "quiet",
  size = "field",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}) {
  const shape =
    variant === "link" ? "" : `${shapes[size]} justify-center rounded-md`;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 disabled:opacity-50 ${variant === "link" ? (size === "compact" ? "text-xs" : "text-sm") : ""} ${shape} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
