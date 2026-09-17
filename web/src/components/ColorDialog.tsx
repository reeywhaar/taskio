import {
  useEffect,
  useState,
  type PointerEvent as Press,
  type ReactNode,
} from "react";

import { Button } from "@app/components/Button";
import { Dialog } from "@app/components/Dialog";
import { TextField } from "@app/components/TextField";
import { hexToHsv, hsvToHex, readHex } from "@app/components/color";

/** The spectrum, as a strip. Six stops is the whole wheel; the browser fills the rest. */
const HUES =
  "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)";

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The color picker, ours rather than the operating system's.
 *
 * `input type="color"` opens whatever the platform decides: on macOS that is a window with
 * sliders, crayons and a magnifier in it, which is a lot of furniture for choosing between eight
 * shades of blue, and it cannot be styled, sized or told what this application looks like.
 *
 * A square of shade over a strip of hue is the picker everybody already knows, and it is two
 * gradients and some arithmetic. HSV rather than RGB because a person picks in it: along is how
 * much color, up is how much light, and the strip says which color.
 *
 * Nothing is committed until Save. The cross leaves what was there, which matters here more than
 * elsewhere — dragging across a square passes through a hundred colors nobody chose.
 */
export function ColorDialog({
  open,
  value,
  onClose,
  preview,
}: {
  open: boolean;
  /** #rrggbb, or empty for a starting point rather than a choice. */
  value: string;
  onClose: (color?: string) => void;
  /** Where the caller shows what wearing it looks like. */
  preview?: (color: string) => ReactNode;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value || "#ef6500"));
  const [typed, setTyped] = useState("");

  // Reset when it opens rather than when it closes: a dialog cleared on the way out shows the
  // next person's starting point for as long as it takes to close.
  useEffect(() => {
    if (!open) return;
    setHsv(hexToHsv(value || "#ef6500"));
    setTyped("");
  }, [open, value]);

  const hex = hsvToHex(hsv);

  /** A press anywhere on a track is a choice, and so is every move while it is held. */
  const track = (set: (x: number, y: number) => void) => {
    const at = (e: Press<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      set(
        clamp((e.clientX - box.left) / box.width),
        clamp((e.clientY - box.top) / box.height),
      );
    };
    return {
      onPointerDown: (e: Press<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        at(e);
      },
      onPointerMove: (e: Press<HTMLElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
      },
    };
  };

  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="Pick a color"
      footer={
        <>
          {preview ? preview(hex) : null}
          <span className="flex-1" />
          <Button variant="solid" onClick={() => onClose(hex)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* White along the top, black along the bottom, the hue at the right: three corners
            somebody can aim at, which is what makes a square of color navigable. */}
        <div
          {...track((x, y) => setHsv({ ...hsv, s: x, v: 1 - y }))}
          className="relative h-44 w-full cursor-crosshair touch-none rounded-md"
          style={{
            background: `linear-gradient(to top, #000, rgba(0,0,0,0)),
                         linear-gradient(to right, #fff, rgba(255,255,255,0)),
                         hsl(${hsv.h} 100% 50%)`,
          }}
        >
          <Thumb left={hsv.s} top={1 - hsv.v} color={hex} />
        </div>

        <div
          {...track((x) => setHsv({ ...hsv, h: x * 360 }))}
          className="relative h-5 w-full cursor-crosshair touch-none rounded-full"
          style={{ background: HUES }}
        >
          <Thumb
            left={hsv.h / 360}
            top={0.5}
            color={hsvToHex({ ...hsv, s: 1, v: 1 })}
          />
        </div>

        {/* Typed as well as pointed at, because a color is usually copied from somewhere — and
            because a square and a strip are no use to a keyboard. */}
        <div className="flex items-center gap-2">
          <TextField
            className="w-32 font-mono"
            aria-label="Hex"
            placeholder="#2563eb"
            value={typed || hex}
            onChange={(e) => {
              setTyped(e.target.value);
              const read = readHex(e.target.value);
              if (read) setHsv(hexToHsv(read));
            }}
            onBlur={() => setTyped("")}
          />
          <span
            className="size-8 shrink-0 rounded-md border-[1.5px] border-line"
            style={{ background: hex }}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** Where the choice is, on either track. A ring rather than a dot: it has to be seen on both. */
function Thumb({
  left,
  top,
  color,
}: {
  left: number;
  top: number;
  color: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.4)]"
      style={{
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        background: color,
      }}
    />
  );
}
