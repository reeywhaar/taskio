import type { SelectHTMLAttributes } from "react";

import { ChevronDownIcon } from "@app/components/icons/Icon";

/**
 * A select that is a well like a TextField, with our own chevron.
 *
 * Sunken rather than bordered, with a TextField's height: it was a box with a line round it
 * standing beside fields that are wells, which reads as two kinds of control where there is one
 * kind — somewhere to put a value. The focus is the well's own, lit at the mouth.
 *
 * appearance-none rather than the browser's arrow: that one is drawn hard against the right
 * edge whatever padding is set, and it is a different shape and weight in every browser. Ours
 * is the icon the rest of the application uses, with room around it.
 */
export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative inline-flex items-center ${className}`}>
      <select
        className="sunken min-h-10 w-full appearance-none rounded-md border-0 bg-bg py-1.5 pr-9 pl-3 text-fg focus:outline-none sm:min-h-11 sm:py-2"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 text-muted" />
    </span>
  );
}
