// Once, on an empty data directory: start taskio, take the invitation it prints for its first
// administrator as the demo account, fill that with the seed, and stop it again. start.sh then
// starts it for good.
//
// A setup that fails takes its half-made database with it, so the next start tries again
// rather than serving whatever it got as far as.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const USER = process.env.DEMO_USER ?? "demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demodemo";
const DATA = process.env.TASKIO_DATA_DIR ?? "/data";
const BASE = "http://127.0.0.1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Asks until it answers, or for so long and no longer. */
async function waitFor(what, ask, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const got = await ask().catch(() => undefined);
    if (got) return got;
  }
  throw new Error(`no ${what} after ${ms / 1000}s`);
}

const server = spawn("taskio", ["serve"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let printed = "";
server.stdout.on("data", (d) => (printed += d));
server.stderr.on("data", (d) => (printed += d));
const exited = new Promise((resolve) => server.on("exit", resolve));

async function stop() {
  server.kill("SIGTERM");
  const gone = await Promise.race([exited.then(() => true), sleep(15_000)]);
  if (!gone) server.kill("SIGKILL");
}

try {
  const invite = await waitFor(
    "invitation",
    async () => /\/invite\/([A-Za-z0-9_-]+)/.exec(printed)?.[1],
    20_000,
  );
  await waitFor(
    "answer from taskio",
    async () =>
      (await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(2_000) }))
        .ok,
    20_000,
  );

  const accepted = await fetch(`${BASE}/api/auth/invites/${invite}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!accepted.ok)
    throw new Error(`accepting the invitation answered ${accepted.status}`);

  // The database is this container's own, written by one system, so the ages can go straight in.
  execFileSync("node", ["/demo/seed.mjs"], {
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 120_000,
    env: {
      ...process.env,
      TASKIO_URL: BASE,
      TASKIO_USER: USER,
      TASKIO_PASSWORD: PASSWORD,
      TASKIO_DB: join(DATA, "taskio.db"),
    },
  });
  await stop();
  console.log(`Demo ready. Sign in as ${USER} / ${PASSWORD}.`);
} catch (err) {
  await stop();
  for (const file of ["taskio.db", "taskio.db-wal", "taskio.db-shm"])
    rmSync(join(DATA, file), { force: true });
  console.error(`The demo could not be set up: ${err.message}`);
  if (printed) console.error(printed);
  process.exit(1);
}
