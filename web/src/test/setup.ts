import "@testing-library/react";

/**
 * jsdom has no modal dialog: showModal and close are missing, and Dialog calls both.
 *
 * Only what the component needs — open flipped, and close firing the event it listens for.
 * A fuller stand-in would be pretending to test focus trapping and the top layer, which are
 * exactly the things jsdom cannot answer and a browser has to.
 */
function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function close(this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
}

if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= showModal;
  HTMLDialogElement.prototype.close ??= close;
}
