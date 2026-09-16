import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { lockScroll } from "@app/components/scrollLock";

/**
 * The dialog a piece of the tree is inside, if it is inside one.
 *
 * A ref rather than the element, because the provider is the dialog itself and its element does
 * not exist until after the first render; by the time a child's effect reads .current, it does.
 */
const DialogContext = createContext<RefObject<HTMLDialogElement | null> | null>(
  null,
);

/**
 * A modal, on the native dialog element, at every size.
 *
 * Native rather than a div with role="dialog": showModal() brings focus trapping, Escape,
 * inertness of the rest of the page, and top-layer stacking that no z-index can lose an
 * argument with. Every one of those is tedious to reimplement and easy to reimplement slightly
 * wrong.
 *
 * Controlled, because the element's own open state is DOM state and two sources of truth for
 * one boolean is how a dialog ends up shut in React and open on screen.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** A description is markdown with images in it, and needs room to be worth writing in. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const parent = useContext(DialogContext);

  // Where the press started. A click on the backdrop targets the dialog itself — but so does one
  // that began on text inside and finished outside, which is what selecting a description and
  // dragging past the edge looks like.
  const startedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Guarded both ways: showModal on an open dialog throws, and close on a shut one fires a
    // second close event that would call onClose again.
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Both are needed and neither covers the other: holding the page still leaves a parent
    // dialog free to scroll away underneath, and the reverse.
    const releasePage = lockScroll(document.body);
    const above = parent?.current;
    const releaseParent = above ? lockScroll(above) : undefined;
    return () => {
      releaseParent?.();
      releasePage();
    };
  }, [open, parent]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Escape fires cancel before close. Routing through one path means there is one way out.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        startedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (startedOnBackdrop.current && e.target === e.currentTarget)
          onClose();
        startedOnBackdrop.current = false;
      }}
      // m-auto is load-bearing: a modal dialog is centred with inset:0; margin:auto, and
      // Tailwind's preflight resets margin to 0, which leaves only the inset and drops it in
      // the corner.
      //
      // overscroll-contain stops a touch scroll that reached the end carrying on into the page
      // behind, where overflow:hidden on the body is not reliably enough on its own.
      className={`m-auto max-h-[85dvh] ${
        wide
          ? "w-[min(42rem,calc(100vw-2rem))]"
          : "w-[min(28rem,calc(100vw-2rem))]"
      } overflow-y-auto overscroll-contain rounded-xl border-[1.5px] border-line bg-surface p-0 text-fg backdrop:bg-black/50`}
    >
      {/* Unmounted while closed, so a form inside starts empty rather than holding whatever was
          typed and abandoned last time. */}
      {open ? (
        <DialogContext.Provider value={ref}>
          <div className="flex flex-col gap-4 px-5 pt-5 pb-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            {children}
          </div>
          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 pt-4 pb-5">
              {footer}
            </div>
          ) : null}
        </DialogContext.Provider>
      ) : null}
    </dialog>
  );
}
