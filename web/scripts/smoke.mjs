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
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1";
const chromium = process.env.CHROMIUM ?? "chromium";
const port = 9333;

const failures = [];
function check(name, ok, detail = "") {
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/** One CDP connection, with commands addressed to a page session. */
class Browser {
  #ws;
  #next = 1;
  #pending = new Map();
  #session;

  static async launch(profile) {
    const proc = spawn(
      chromium,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--disable-gpu",
        // The instance under test serves http on a loopback address.
        "--ignore-certificate-errors",
        // Nothing here reads chromium's output, and a pipe nobody drains fills and blocks the
        // process writing into it — which looks like a browser that never finished starting.
      ],
      { stdio: "ignore" },
    );
    proc.on("error", (err) => {
      console.error(`could not start ${chromium}: ${err.message}`);
      process.exit(2);
    });

    const endpoint = await waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      return (await res.json()).webSocketDebuggerUrl;
    });

    const browser = new Browser();
    await browser.#connect(endpoint);
    await browser.#attach();
    browser.proc = proc;
    return browser;
  }

  async #connect(endpoint) {
    this.#ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      this.#ws.onopen = resolve;
      this.#ws.onerror = reject;
    });
    this.#ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const waiting = this.#pending.get(msg.id);
      if (!waiting) return;
      this.#pending.delete(msg.id);
      if (msg.error) waiting.reject(new Error(msg.error.message));
      else waiting.resolve(msg.result);
    };
  }

  async #attach() {
    const { targetId } = await this.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    this.#session = sessionId;
    await this.send("Page.enable");
    await this.send("Runtime.enable");
  }

  send(method, params = {}) {
    const id = this.#next++;
    const message = { id, method, params };
    if (this.#session && !method.startsWith("Target."))
      message.sessionId = this.#session;
    this.#ws.send(JSON.stringify(message));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
  }

  /** Navigates and waits for the island to have rendered something. */
  async open(path) {
    await this.send("Page.navigate", { url: base + path });
    await waitFor(async () => {
      const value = await this.eval(
        "document.querySelector('#root')?.children.length ?? 0",
      );
      return value > 0 ? value : undefined;
    });
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression: `(() => { return (${expression}); })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  }

  scheme(value) {
    return this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value }],
    });
  }

  close() {
    this.#ws.close();
    this.proc.kill();
  }
}

async function waitFor(f, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const value = await f();
      if (value !== undefined && value !== null && value !== false)
        return value;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("gave up waiting");
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
const browser = await Browser.launch(profile);

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
