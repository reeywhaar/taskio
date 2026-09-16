import type { SelectHTMLAttributes } from "react";

import { ChevronDownIcon } from "@app/components/icons/Icon";

/**
 * A select with the same metrics as a TextField, and our own chevron.
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
        className="w-full appearance-none rounded-md border-[1.5px] border-line bg-bg py-2 pr-9 pl-3 text-fg focus:border-brand focus:outline-none"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 text-muted" />
    </span>
  );
}
