import type { InputHTMLAttributes } from "react";

/**
 * A field's frame, ground and focus. Width and text size belong to the caller — see
 * docs/interface.md.
 */
export function TextField({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-10 rounded-md border-[1.5px] border-line bg-bg px-3 py-1.5 sm:min-h-11 sm:py-2 text-fg placeholder:text-faint focus:border-brand focus:outline-none ${className}`}
      {...props}
    />
  );
}
