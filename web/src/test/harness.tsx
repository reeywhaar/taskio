import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";

import { ConfirmProvider } from "@app/components/Confirm";

/**
 * A component under a query client of its own.
 *
 * Its own, per render: a client shared between tests carries one test's cached account into
 * the next one, and the failure looks like the component rather than the harness. Retries off,
 * so a test that asserts a refusal waits once rather than three times.
 */
export function mount(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (node: ReactElement) => (
    <QueryClientProvider client={client}>
      <ConfirmProvider>{node}</ConfirmProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(ui));
  return {
    ...view,
    // Re-wrapped, because the bare rerender replaces the whole tree and takes the provider
    // with it — which reads as the component having lost its client.
    rerender: (next: ReactElement) => view.rerender(wrap(next)),
  };
}

/**
 * Lets React finish work that waitFor may have returned in the middle of.
 *
 * waitFor resolves on the first poll where the DOM says what was asked, which can be before
 * React has flushed everything that render scheduled. A change typed into a field in that gap
 * is applied to a tree about to be replaced, and disappears — needed only when a test edits a
 * field the component itself has just filled in.
 */
export const settle = () => act(async () => {});
