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
    if (open && !dialog.open) {
      // React's autoFocus is a call, not an attribute, and it has already run by the time this
      // effect does — so whatever is focused inside the dialog now is what asked for it.
      const asked =
        document.activeElement instanceof HTMLElement &&
        dialog.contains(document.activeElement)
          ? document.activeElement
          : null;

      dialog.showModal();

      // showModal focuses the first control it finds whether or not that control wanted it,
      // and a ring on Delete reads as armed. Give it back to whatever asked, or to the dialog,
      // where escape and the tab order still work and nothing is lit.
      if (asked) asked.focus();
      else dialog.focus();
    } else if (!open && dialog.open) dialog.close();
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
      tabIndex={-1}
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
      // The whole screen on a phone. A centred card there spends its margins on the page
      // behind it, which nobody is reading, and leaves the editor a slot to type into.
      //
      // m-auto is load-bearing above that: a modal dialog is centred with inset:0; margin:auto,
      // and Tailwind's preflight resets margin to 0, which leaves only the inset and drops it
      // in the corner.
      className={`flex h-dvh max-h-dvh w-dvw max-w-none flex-col overflow-hidden border-0 bg-surface p-0 text-fg backdrop:bg-black/50 focus:outline-none sm:m-auto sm:h-auto sm:max-h-[85dvh] sm:rounded-xl sm:border-[1.5px] sm:border-line ${
        wide
          ? "sm:w-[min(42rem,calc(100vw-2rem))]"
          : "sm:w-[min(28rem,calc(100vw-2rem))]"
      }`}
    >
      {/* Unmounted while closed, so a form inside starts empty rather than holding whatever was
          typed and abandoned last time. */}
      {open ? (
        <DialogContext.Provider value={ref}>
          {/*
            The body scrolls and the footer does not, so what a dialog asks for is never below
            the fold with nothing to press.

            overscroll-contain stops a touch scroll that reached the end carrying on into the
            page behind, where overflow:hidden on the body is not reliably enough on its own.
          */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-5 pb-4 sm:px-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            {children}
          </div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 pt-4 pb-5 sm:px-5">
              {footer}
            </div>
          ) : null}
        </DialogContext.Provider>
      ) : null}
    </dialog>
  );
}
