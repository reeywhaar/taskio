/**
 * Drives the built frontend in a real browser and asserts what only a browser can answer.
 *
 * A jsdom test renders a component; it cannot tell you that the light palette never applies, or
 * that two Tailwind classes of equal specificity resolved the wrong way. Both of those shipped
 * and were found by looking at the screen, which is the argument for this existing.
 *
 * Needs a running taskio and a chromium. Not part of `npm test`, which must stay hermetic.
 *
 *   node scripts/smoke.mjs http://127.0.0.1
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Browser } from "./cdp.mjs";

const base = process.argv[2] ?? "http://127.0.0.1";
const chromium = process.env.CHROMIUM ?? "chromium";
const port = 9333;

const failures = [];
function check(name, ok, detail = "") {
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/** Relative luminance, so a contrast ratio can be asserted rather than eyeballed. */
const contrast = `(a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\\d+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}`;

const profile = await mkdtemp(join(tmpdir(), "taskio-smoke-"));
const browser = await Browser.launch({ chromium, port, profile, base });

try {
  // --- the login island, which is what an unauthenticated visitor loads -------------------
  await browser.open("/login");
  check(
    "login island renders",
    (await browser.eval("!!document.querySelector('form')")) === true,
  );

  // The application shell once drew its whole interface for somebody who had never signed in,
  // and every panel in it then failed. Asked here rather than of the server, because what went
  // wrong was what ended up on the screen.
  await browser.open("/");
  const landed = await browser.eval("window.location.pathname");
  check(
    "a stranger asking for the app gets sign-in",
    landed === "/login",
    landed,
  );
  check(
    "and not a line of the app with it",
    (await browser.eval("!document.body.textContent.includes('New task')")) ===
      true,
  );

  // --- both palettes actually apply -------------------------------------------------------
  for (const [scheme, expected] of [
    ["light", "rgb(255, 255, 255)"],
    ["dark", "rgb(17, 17, 19)"],
  ]) {
    await browser.scheme(scheme);
    await browser.open("/login");
    const bg = await browser.eval(
      "getComputedStyle(document.body).backgroundColor",
    );
    check(`${scheme} palette applies`, bg === expected, `body is ${bg}`);
  }

  // --- borders can be seen ----------------------------------------------------------------
  for (const scheme of ["light", "dark"]) {
    await browser.scheme(scheme);
    await browser.open("/login");
    const seen = await browser.eval(`
      (() => {
        const input = document.querySelector('input');
        const style = getComputedStyle(input);
        return {
          width: parseFloat(style.borderTopWidth),
          ratio: (${contrast})(style.borderTopColor, getComputedStyle(document.body).backgroundColor),
        };
      })()`);
    // A thicker edge at a given contrast is read about as easily as a hairline at a higher one,
    // so the bar moves with the weight rather than being one number for both.
    const floor = seen.width > 1 ? 1.6 : 1.9;
    check(
      `${scheme} border is visible`,
      seen.ratio >= floor,
      `${seen.width}px at ${seen.ratio.toFixed(2)}:1, wants ${floor}`,
    );
  }

  // --- a field given a width keeps it ------------------------------------------------------
  await browser.scheme("light");
  await browser.open("/login");
  const full = await browser.eval(`
    (() => {
      const input = document.querySelector('input');
      const form = input.closest('form');
      return input.getBoundingClientRect().width / form.getBoundingClientRect().width;
    })()`);
  check(
    "a field asked to fill its form does",
    full > 0.95,
    `${(full * 100).toFixed(0)}% of it`,
  );

  // --- nothing threw on the way ------------------------------------------------------------
  const errors = await browser.eval("window.__errors ?? []");
  check("no uncaught errors", errors.length === 0, errors.join("; "));
} finally {
  browser.close();
  // Retried and then forgiven: the browser is still flushing its caches as this runs, so the
  // directory refuses to go and the run reports a failure it did not have. It is a temp
  // directory either way.
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  }).catch(() => {});
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall good");
