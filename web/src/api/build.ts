import { useEffect, useSyncExternalStore } from "react";

/** How often an open tab asks, besides when it is looked at again and when the stream returns. */
const EVERY = 15 * 60 * 1000;

/** The build this page was served as, written into the shell by the server. None from Vite's
 *  own server, which has no build to compare. */
const mine = () =>
  document.querySelector<HTMLMetaElement>('meta[name="taskio-build"]')
    ?.content ?? "";

let behind = false;
const listeners = new Set<() => void>();

/**
 * Asks the server which build it serves now. A different one means the page is older than the
 * server, and stays so until it is reloaded: once behind, it does not ask again.
 */
export async function checkBuild() {
  const own = mine();
  if (!own || behind) return;
  try {
    const res = await fetch("/healthz", { cache: "no-store" });
    const { build } = (await res.json()) as { build?: string };
    if (!build || build === own) return;
  } catch {
    // Down, or mid-deploy: the next look will ask again.
    return;
  }
  behind = true;
  for (const listener of listeners) listener();
}

/**
 * Whether a newer build is being served than this page was loaded from.
 *
 * Asked when the tab is looked at again, every quarter of an hour, and by the live stream when
 * it reconnects — which is what a deploy looks like from an open tab.
 */
export function useBehind(): boolean {
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === "visible") void checkBuild();
    };
    document.addEventListener("visibilitychange", look);
    const timer = window.setInterval(checkBuild, EVERY);
    return () => {
      document.removeEventListener("visibilitychange", look);
      window.clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => behind,
  );
}
