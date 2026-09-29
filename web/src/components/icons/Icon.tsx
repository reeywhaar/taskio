import type { SVGProps } from "react";

/**
 * Icons are 2px outlined, sized to the text beside them, and silent: the sentence already says
 * it.
 */
export function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 12.5 9 17.5 20 6.5" />
  </Icon>
);

export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const QuestionIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M9.4 9.2a2.8 2.8 0 1 1 3.4 3.2c-.6.2-1 .7-1 1.3v.5" />
    <path d="M11.8 17.3h.01" />
  </Icon>
);

export const CrossIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const BinIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
  </Icon>
);

export const BurgerIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 10h10a5 5 0 0 1 0 10H9M4 10l4-4M4 10l4 4" />
  </Icon>
);

export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a1 1 0 0 1 1-1h9" />
  </Icon>
);

export const CommentIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1Z" />
  </Icon>
);

/**
 * A paperclip, not a pin: the pin is pinning a task.
 *
 * Drawn upright and turned, so its three loops are concentric by construction and the four legs
 * sit far enough apart that a 2px stroke leaves a gap between them at 14px.
 */
export const PaperclipIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path
      transform="rotate(45 12 12)"
      d="M15 6v9.5a3 3 0 0 1-6 0v-9a4.75 4.75 0 0 1 9.5 0v9a6.5 6.5 0 0 1-13 0V9"
    />
  </Icon>
);
/**
 * A pencil with a body, a band and a point, drawn upright and turned. The sliver it was read as a
 * slash at 12px.
 *
 * Turned, its shape sat a unit up and to the right of the box's centre, and read high beside a
 * line of text; the translate puts it back, and a touch low, where words sit.
 */
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <g transform="translate(-1 2) rotate(45 12 12)">
      <path d="M9 16V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v11l-3 5Z" />
      <path d="M9 7h6" />
    </g>
  </Icon>
);

/**
 * Two closed shapes rather than three open strokes: this is read at 14px inside a 20px square,
 * where three separate lines at a 2px stroke are three separate lines and not a pipette.
 *
 * The gap between the shaft and the bulb is what says which way round it is, and what keeps it
 * from reading as a pencil.
 */
export const DropperIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 21v-3l9-9 3 3-9 9H3Z" />
    <circle cx="18" cy="6" r="3.5" />
  </Icon>
);

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 9.5 12 15.5 18 9.5" />
  </Icon>
);

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="m15.5 15.5 4 4" />
  </Icon>
);

export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6ZM12 14v7" />
  </Icon>
);
