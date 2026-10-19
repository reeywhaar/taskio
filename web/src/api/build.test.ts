import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The module holds whether the page is behind, so each test takes a fresh copy. */
const load = () => import("@app/api/build");

const serving = (build: string) =>
  vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, build }))),
  );

beforeEach(() => {
  vi.resetModules();
  const meta = document.createElement("meta");
  meta.name = "taskio-build";
  meta.content = "a1a1a1a1a1a1";
  document.head.append(meta);
});
afterEach(() => {
  document.head.querySelector('meta[name="taskio-build"]')?.remove();
  vi.unstubAllGlobals();
});

describe("the build check", () => {
  it("says nothing while the server serves the page's own build", async () => {
    vi.stubGlobal("fetch", serving("a1a1a1a1a1a1"));
    const { checkBuild, useBehind } = await load();
    const { result } = renderHook(() => useBehind());
    await act(() => checkBuild());
    expect(result.current).toBe(false);
  });

  it("says so once the server serves another", async () => {
    vi.stubGlobal("fetch", serving("b2b2b2b2b2b2"));
    const { checkBuild, useBehind } = await load();
    const { result } = renderHook(() => useBehind());
    await act(() => checkBuild());
    expect(result.current).toBe(true);
  });

  it("asks when the tab is looked at again", async () => {
    const fetch = serving("b2b2b2b2b2b2");
    vi.stubGlobal("fetch", fetch);
    const { useBehind } = await load();
    const { result } = renderHook(() => useBehind());
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current).toBe(true));
    expect(fetch).toHaveBeenCalledWith("/healthz", { cache: "no-store" });
  });

  /** Vite's own server writes no build into the page, and there is nothing to compare. */
  it("does not ask from a page with no build", async () => {
    document.head.querySelector('meta[name="taskio-build"]')?.remove();
    const fetch = serving("b2b2b2b2b2b2");
    vi.stubGlobal("fetch", fetch);
    const { checkBuild } = await load();
    await checkBuild();
    expect(fetch).not.toHaveBeenCalled();
  });
});
