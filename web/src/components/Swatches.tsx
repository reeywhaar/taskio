import { useState } from "react";

import { ColorDialog } from "@app/components/ColorDialog";
import { DropperIcon } from "@app/components/icons/Icon";
import { BRAND } from "@app/mark";

/**
 * The colors anything here can wear, without opening the picker.
 *
 * Eight hues far enough apart to be told apart at 16px in a browser tab and at 4px down the
 * edge of a row, which are the sizes they are actually read at. An earlier set had the brand
 * beside an amber and the two were one color — a palette whose entries are not distinguishable
 * has fewer entries than it appears to.
 *
 * The brand leads because it is what a group wears with nothing chosen; the rest run round the
 * wheel.
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
 * `none` names the empty choice for the things that have one. A group without a color wears the
 * brand, so there the first swatch is the brand and empty is what it stores; a task without one
 * wears nothing, so there empty is a swatch of its own and the brand is a color like the rest.
 */
export function Swatches({
  value,
  onChange,
  none,
}: {
  /** #rrggbb, or empty. */
  value: string;
  onChange: (color: string) => void;
  /** What an empty value is called, where it is a choice rather than the brand. */
  none?: string;
}) {
  const [picking, setPicking] = useState(false);
  const custom = value !== "" && !COLOURS.includes(value);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {none ? (
        <button
          type="button"
          aria-label={none}
          title={none}
          aria-pressed={value === ""}
          onClick={() => onChange("")}
          className={`size-5 rounded border-[1.5px] border-dashed border-line ring-offset-2 ring-offset-surface ${
            value === "" ? "ring-2 ring-fg" : ""
          }`}
        />
      ) : null}

      {COLOURS.map((swatch) => {
        // Where the brand is the default, it is stored as no color at all: a group that was
        // never given one and a group given the brand are the same group.
        const held = !none && swatch === BRAND ? "" : swatch;
        const on = value === held;
        return (
          <button
            key={swatch}
            type="button"
            aria-label={!none && swatch === BRAND ? "The brand color" : swatch}
            aria-pressed={on}
            onClick={() => onChange(held)}
            className={`size-5 rounded ring-offset-2 ring-offset-surface ${
              on ? "ring-2 ring-fg" : ""
            }`}
            style={{ background: swatch }}
          />
        );
      })}

      {/* The spot wears whatever is chosen and says what it is for with the dropper, rather
          than wearing a wheel that is a picture of the idea of color. Two swatches of the same
          color would otherwise be ambiguous — the icon is what tells them apart. */}
      <button
        type="button"
        aria-label="Another color"
        title="Another color"
        onClick={() => setPicking(true)}
        className={`flex size-5 items-center justify-center rounded ring-offset-2 ring-offset-surface ${
          value ? "" : "border-[1.5px] border-line"
        } ${custom ? "ring-2 ring-fg" : ""}`}
        style={value ? { background: value, color: ink(value) } : undefined}
      >
        <DropperIcon className="text-xs" />
      </button>

      <ColorDialog
        open={picking}
        value={value || BRAND}
        onClose={(picked) => {
          setPicking(false);
          if (picked) onChange(picked);
        }}
      />
    </div>
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
