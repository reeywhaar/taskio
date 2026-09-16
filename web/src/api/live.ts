import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { qk } from "@app/api/keys";

/**
 * Keeps an open tab in step with what another one did.
 *
 * The server says only that something changed, so this refetches what is on screen rather than
 * patching a cache from a payload — one round trip against a second copy of the model that
 * would have to stay true.
 *
 * EventSource rather than a socket: it reconnects on its own with backoff, which is most of
 * what a socket here would need hand-writing.
 */
export function useLive() {
  const client = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/events");
    const refresh = () => {
      client.invalidateQueries({ queryKey: qk.tasks });
      client.invalidateQueries({ queryKey: qk.tags });
    };

    source.addEventListener("changed", refresh);
    // A reconnection means the stream was down, and anything that happened while it was down
    // was not delivered. Asking once on the way back is cheaper than tracking what was missed.
    source.addEventListener("open", refresh);

    return () => source.close();
  }, [client]);
}
