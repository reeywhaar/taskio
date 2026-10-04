import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@app/components/Button";
import { ColorDialog } from "@app/components/ColorDialog";
import { ChevronDownIcon, DropperIcon } from "@app/components/icons/Icon";
import { BRAND } from "@app/mark";

/**
 * The colors anything here can wear, without opening the picker.
 *
 * Eight hues far enough apart to be told apart at 16px in a browser tab and at 4px down the
 * edge of a row, which are the sizes they are actually read at. An earlier set had the brand
 * beside an amber and the two were one color — a palette whose entries are not distinguishable
 * has fewer entries than it appears to.
 *
 * The brand leads, and the rest run round the wheel.
 */
export const COLOURS = [
  BRAND,
  "#dc2626",
  "#eab308",
  "#16a34a",
  "#0d9488",
  "#2563eb",
  "#7c3aed",
  "#c026d3",
];

/**
 * A row of colors and a way out of it.
 *
 * The eight are a shortcut rather than the range: the browser's own picker sits beside them and
 * the server takes any six hex digits. It wears a wheel rather than its own value, which is what
 * the control does rather than what it happens to hold — showing the value made a ninth swatch
 * that was a copy of whichever of the eight was chosen.
 *
 * `none` names the empty choice, a dashed swatch of its own: nothing on a task, and on a group the
 * default, which is the brand. Either way the brand is a color like the rest beside it.
 *
 * One row, always. Where it shares a line with other fields it is behind ColorSelect instead.
 */
// Each on a tile of its own, and the chosen one's tile shaded: a ring round a 16px square of
// color was heavier than the color it marked.
const tile = (on: boolean) =>
  `flex rounded-md p-1 ${on ? "bg-line" : "hover:bg-shade"}`;

export function Swatches({
  value,
  onChange,
  none,
  custom: offerCustom = true,
}: {
  /** #rrggbb, or empty. */
  value: string;
  onChange: (color: string) => void;
  /** What an empty value is called: "No color", "Default color". */
  none: string;
  /** Whether the picker for any other color is offered. A task's is not: see ColorSelect. */
  custom?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const custom = value !== "" && !COLOURS.includes(value);

  return (
    <div className="flex w-fit items-center gap-0.5">
      <button
        type="button"
        aria-label={none}
        title={none}
        aria-pressed={value === ""}
        onClick={() => onChange("")}
        className={tile(value === "")}
      >
        <Swatch color="" />
      </button>

      {COLOURS.map((swatch) => {
        const on = value === swatch;
        return (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={on}
            onClick={() => onChange(swatch)}
            className={tile(on)}
          >
            <Swatch color={swatch} />
          </button>
        );
      })}

      {/* The spot wears whatever is chosen and says what it is for with the dropper, rather
          than wearing a wheel that is a picture of the idea of color. Two swatches of the same
          color would otherwise be ambiguous — the icon is what tells them apart. */}
      {offerCustom ? (
        <button
          type="button"
          aria-label="Another color"
          title="Another color"
          onClick={() => setPicking(true)}
          className={tile(custom)}
        >
          <span
            className={`flex size-4 items-center justify-center rounded-sm ${
              value ? "" : "border border-muted"
            }`}
            style={value ? { background: value, color: ink(value) } : undefined}
          >
            <DropperIcon className="text-[10px]" />
          </span>
        </button>
      ) : null}

      {offerCustom ? (
        <ColorDialog
          open={picking}
          value={value || BRAND}
          onClose={(picked) => {
            setPicking(false);
            if (picked) onChange(picked);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * The color as a field: what it is, and the row of swatches when pressed.
 *
 * The swatches were a block of ten beside Project and Priority, the heaviest thing in the form for
 * the one field that means least. As a field it is the height of the two beside it, and the row
 * it opens is the same one the group dialog shows. Closes on a choice, on Escape and on a press
 * elsewhere; Escape is the popover's, not the dialog's around it.
 */
export function ColorSelect({
  value,
  onChange,
  none,
  label,
  compact = false,
  custom = true,
}: {
  value: string;
  onChange: (color: string) => void;
  none: string;
  /** What the field is, for a reader who meets the button alone. */
  label: string;
  /** Small and flat, for a row of small settings. */
  compact?: boolean;
  /** Whether any other color can be picked than the eight. A task's cannot: one picked
   *  colour is used once and never found again without a list of recent ones, and nothing
   *  here needs one. A group's can, being the tab's. */
  custom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Under the button, ending at its right edge, unless that runs out of what scrolls around it: off
  // its left where the field starts a line, as on a phone or in a group's dialog, or off its
  // bottom where the field is the last, which made the dialog scroll to show it.
  const [flush, setFlush] = useState<"left" | "right">("right");
  const [above, setAbove] = useState(false);

  useLayoutEffect(() => {
    if (!open || !box.current || !pop.current) return;
    const at = box.current.getBoundingClientRect();
    const room = scroller(box.current).getBoundingClientRect();
    setFlush(
      at.right - pop.current.offsetWidth < room.left + 8 ? "left" : "right",
    );
    const tall = pop.current.offsetHeight + 8;
    setAbove(at.bottom + tall > room.bottom && at.top - tall > room.top);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <div
      ref={box}
      // As wide as its button, so the popover lines up with the button and not the line.
      className="relative w-fit"
      onKeyDown={(e) => {
        if (!open || e.key !== "Escape") return;
        // The picker's own dialog, opened from in here, closes itself.
        const within = (e.target as Element).closest("dialog");
        if (within && within !== box.current?.closest("dialog")) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }}
    >
      {compact ? (
        // Flat, like the stepper beside it, and hung out by its padding so the swatch lines up
        // with the caption.
        <button
          type="button"
          aria-label={`${label}: ${value || none}`}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="-ml-1.5 flex h-7 items-center gap-1 rounded-md px-1.5 text-muted hover:bg-fill hover:text-fg pointer-coarse:h-9"
        >
          <Swatch color={value} />
          <ChevronDownIcon className={open ? "rotate-180" : ""} />
        </button>
      ) : (
        <Button
          aria-label={`${label}: ${value || none}`}
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          <Swatch color={value} />
          <ChevronDownIcon className={open ? "rotate-180" : ""} />
        </Button>
      )}
      {open ? (
        <div
          ref={pop}
          className={`aloft absolute z-40 rounded-lg bg-bg p-1.5 ${
            flush === "right" ? "right-0" : "left-0"
          } ${above ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
        >
          <Swatches
            value={value}
            none={none}
            custom={custom}
            onChange={(color) => {
              onChange(color);
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The nearest ancestor that scrolls, which is what would clip the popover. */
function scroller(from: Element): Element {
  for (let el = from.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return document.documentElement;
}

/** What a color field shows of its value: the color, or the dashed nothing. */
function Swatch({ color }: { color: string }) {
  return color ? (
    <span className="block size-4 rounded-sm" style={{ background: color }} />
  ) : (
    <span className="block size-4 rounded-sm border border-dotted border-muted" />
  );
}

/**
 * Black or white, whichever can be seen on that color.
 *
 * The dropper sits on a color somebody chose, so there is no palette to pick its own from: the
 * WCAG relative luminance of the ground decides, at the threshold where black and white swap
 * places against mid-grey.
 */
function ink(color: string): string {
  const channel = (at: number) => {
    const value = parseInt(color.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.18 ? "#111113" : "#ffffff";
}
