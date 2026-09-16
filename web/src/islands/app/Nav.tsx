import { useEffect, useState } from "react";

import { BurgerIcon, CrossIcon } from "@app/components/icons/Icon";
import type { Location } from "@app/islands/app/route";

/**
 * The nav rail holds the three places there are, and is the only thing always in the same
 * place. Where you are is drawn in the foreground colour rather than hidden: the same three
 * items everywhere, one of them lit.
 *
 * Below the breakpoint it goes behind a burger and slides over as a sheet — the same component
 * with different chrome rather than a second nav.
 */
export function Nav({
  location,
  onGo,
}: {
  location: Location;
  onGo: (next: Location) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items = (
    <ul className="flex flex-col gap-0.5 p-2">
      <Item
        label="List"
        lit={location.route.name === "list" || location.route.name === "task"}
        onClick={() => {
          setOpen(false);
          onGo({ ...location, route: { name: "list" } });
        }}
      />
      <Item
        label="Settings"
        lit={location.route.name === "settings"}
        onClick={() => {
          setOpen(false);
          onGo({ ...location, route: { name: "settings" } });
        }}
      />

      {/* An ordinary link to a page the server renders, so it is the one entry here that
          leaves the application. Last, and behind a rule, because that is what the rule says.
          The page is the same text an agent reads, and one page cannot disagree with itself. */}
      <li className="mt-1 border-t border-line pt-1">
        <a
          className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-fill hover:text-fg"
          href="/docs"
        >
          Docs
        </a>
      </li>
    </ul>
  );

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-2 py-2 md:hidden">
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          className="rounded-md p-2 text-lg hover:bg-surface"
          onClick={() => setOpen(true)}
        >
          <BurgerIcon />
        </button>
        <span className="font-semibold">taskio</span>
      </div>

      <nav className="hidden w-48 shrink-0 bg-surface shadow-rail md:block">
        <div className="px-4 py-3 font-semibold">taskio</div>
        {items}
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <nav className="relative h-full w-56 bg-surface shadow-rail">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">taskio</span>
              <button
                type="button"
                aria-label="Close menu"
                className="rounded-md p-1 hover:bg-fill"
                onClick={() => setOpen(false)}
              >
                <CrossIcon />
              </button>
            </div>
            {items}
          </nav>
        </div>
      ) : null}
    </>
  );
}

function Item({
  label,
  lit,
  onClick,
}: {
  label: string;
  lit: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={lit ? "page" : undefined}
        className={`w-full rounded-md px-3 py-2 text-left text-sm ${
          lit
            ? "bg-fill font-medium text-brand"
            : "text-muted hover:bg-fill hover:text-fg"
        }`}
      >
        {label}
      </button>
    </li>
  );
}
