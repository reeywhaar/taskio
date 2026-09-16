import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@app/components/Button";

/**
 * Keeps one broken piece from taking the page with it.
 *
 * A class, because catching a render is the one thing hooks cannot do. What it shows is short
 * and names where the trouble is rather than what it was: the message React hands over is a
 * stack trace's first line, which tells somebody reading a settings page nothing they can act
 * on. The console keeps the rest.
 *
 * Trying again is worth offering because most of what breaks a render here is data that was
 * not what it claimed, and the next answer may be. It only clears the flag — anything that
 * fails the same way twice says so again rather than looping.
 */
export class Boundary extends Component<
  { children: ReactNode; what?: string; onReset?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `${this.props.what ?? "something"} failed to render`,
      error,
      info,
    );
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-accent">
          {this.props.what ?? "This"} could not be shown.
        </p>
        <Button
          onClick={() => {
            this.setState({ failed: false });
            this.props.onReset?.();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
}
