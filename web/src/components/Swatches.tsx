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
 * 16px, where they were 20 with a thick ring: a block of ten at that size was the heaviest thing in
 * the form, for the one field that means least.
 */
export function Swatches({
  value,
  onChange,
  none,
  row = false,
}: {
  /** #rrggbb, or empty. */
  value: string;
  onChange: (color: string) => void;
  /** What an empty value is called: "No color", "Default color". */
  none: string;
  /** All ten on one line, where nothing shares it: the group dialog. */
  row?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const custom = value !== "" && !COLOURS.includes(value);

  return (
    // Five across rather than a row that runs on: the swatches share a line with the priority
    // stepper, and ten of them in a row made one side of it twice the width of the other. Two
    // short rows are the same swatches in a block the shape of the thing beside them.
    //
    // A fixed count rather than wrapping, because wrapping is decided by whatever width the
    // swatches happen to be given — the same control would be one row in a wide dialog and
    // three on a phone, and where it breaks would be arithmetic nobody chose.
    <div
      className={`grid w-fit items-center gap-1.5 ${row ? "grid-cols-10" : "grid-cols-5"}`}
    >
      <button
        type="button"
        aria-label={none}
        title={none}
        aria-pressed={value === ""}
        onClick={() => onChange("")}
        className={`size-4 rounded-sm border border-dashed border-muted ring-offset-1 ring-offset-bg ${
          value === "" ? "ring-[1.5px] ring-fg" : ""
        }`}
      />

      {COLOURS.map((swatch) => {
        const on = value === swatch;
        return (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={on}
            onClick={() => onChange(swatch)}
            className={`size-4 rounded-sm ring-offset-1 ring-offset-bg ${
              on ? "ring-[1.5px] ring-fg" : ""
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
        className={`flex size-4 items-center justify-center rounded-sm ring-offset-1 ring-offset-bg ${
          value ? "" : "border border-muted"
        } ${custom ? "ring-[1.5px] ring-fg" : ""}`}
        style={value ? { background: value, color: ink(value) } : undefined}
      >
        <DropperIcon className="text-[10px]" />
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
