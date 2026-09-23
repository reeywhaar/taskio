import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@app/components/Button";
import { ChevronDownIcon } from "@app/components/icons/Icon";

/**
 * A button that opens a short list of more buttons, above it.
 *
 * Above, because the one place it is used is a bar at the foot of the screen. No ellipsis on the
 * label: opening a menu asks nothing, and the chevron already says a list is coming. It closes on
 * a choice, on Escape, and on a press anywhere else.
 */
export function Menu({
  label,
  disabled,
  children,
}: {
  label: ReactNode;
  disabled?: boolean;
  /** The items, each given a way to close the menu once it has done its thing. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button
        size="compact"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {label}
        <ChevronDownIcon className={open ? "rotate-180" : ""} />
      </Button>
      {open ? (
        <div
          role="menu"
          className="aloft absolute right-0 bottom-full z-40 mb-1.5 flex min-w-32 flex-col rounded-md bg-bg p-1"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** One line of a menu. */
export function MenuItem({
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`rounded px-2.5 py-1.5 text-left text-xs whitespace-nowrap hover:bg-shade disabled:opacity-50 ${
        danger ? "text-accent" : "text-fg"
      }`}
      {...props}
    />
  );
}
