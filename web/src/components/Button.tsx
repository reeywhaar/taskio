import type { ButtonHTMLAttributes } from "react";

/**
 * Three variants, and choosing between them is the whole decision.
 *
 * solid is the brand color, which is the one thing on a screen of greys that is this
 * application rather than the browser's furniture. quiet is filled rather than outlined:
 * bordered, it draws a second rounded rectangle inside the one a panel already draws.
 *
 * The size is the control size, stated rather than inherited from the text inside. A button is
 * usually beside a field, and one sized by its own label is 33px next to a 44px input in a row
 * that centres them and a squat block in a row that stretches them. A floor on the width is
 * the same argument sideways: "Add" is three characters and should not be a square.
 */
type Variant = "solid" | "quiet" | "link" | "danger";

/**
 * How tall, which is a question about what the button is standing next to.
 *
 * field is beside an input and matches it, so both shrink together on a phone: 44px where there
 * is room, 40 where there is not.
 *
 * bar is a row of controls with no field in it, where 44px reads as a stack of slabs — and
 * where a finger is still a finger, so the height comes back below a pointer that is not one.
 * It carries no minimum width either: four controls on one line is worth more on a phone than
 * a square Select, and the row wrapped at every width below 390px because of it.
 */
type Size = "field" | "bar" | "compact";

// compact is the bulk bar's: eight controls, and at bar size they wrapped to a second line.
const shapes: Record<Size, string> = {
  field: "min-h-10 min-w-20 px-3 py-1.5 text-sm sm:min-h-11",
  bar: "min-h-9 px-3 py-1.5 text-sm pointer-coarse:min-h-10",
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
