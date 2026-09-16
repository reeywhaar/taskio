import type { ButtonHTMLAttributes } from "react";

/**
 * Three variants, and choosing between them is the whole decision.
 *
 * solid is the brand colour, which is the one thing on a screen of greys that is this
 * application rather than the browser's furniture. quiet is filled rather than outlined:
 * bordered, it draws a second rounded rectangle inside the one a panel already draws.
 *
 * The size is the control size, stated rather than inherited from the text inside. A button is
 * usually beside a field, and one sized by its own label is 33px next to a 44px input in a row
 * that centres them and a squat block in a row that stretches them. A floor on the width is
 * the same argument sideways: "Add" is three characters and should not be a square.
 */
type Variant = "solid" | "quiet" | "link" | "danger";

const styles: Record<Variant, string> = {
  solid: "bg-brand text-brand-ink hover:opacity-90",
  quiet: "bg-surface text-fg hover:bg-fill",
  link: "text-muted underline-offset-2 hover:text-fg hover:underline",
  danger: "bg-surface text-accent hover:bg-fill",
};

export function Button({
  variant = "quiet",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const shape =
    variant === "link"
      ? ""
      : "min-h-11 min-w-20 justify-center rounded-md px-3 py-1.5";
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 text-sm disabled:opacity-50 ${shape} ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
