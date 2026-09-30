#!/usr/bin/env node
//
// Regenerate the README screenshots.
//
//   docs/screenshots/capture.mjs
//
// Builds the frontend and the binary, starts a taskio on an empty data directory, fills it from
// seed.mjs through its own API, drives headless Chromium over the DevTools protocol, and
// overwrites the PNGs next to this file. Everything it starts is stopped on the way out.
//
//   SIZE=800     the window, square, in CSS pixels
//   SCALE=2      device pixels per CSS pixel
//   THEME=light  or dark
//   OUT=dir      where the PNGs land, so a look at dark need not overwrite the committed set
//   ONLY=a,b     just these shots
//   NOTES=0      without the notes
//
// Needs go, node, sqlite3 and Chromium or Chrome, and :80, where taskio listens.
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { crc32, inflateSync } from "node:zlib";

import { Browser, findChromium, waitFor } from "../../web/scripts/cdp.mjs";
import { account, images, projects, search, tokens } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const work = mkdtempSync(join(tmpdir(), "taskio-shots-"));

const SIZE = Number(process.env.SIZE ?? 800);
const SCALE = Number(process.env.SCALE ?? 2);
const THEME = process.env.THEME ?? "light";
const OUT = process.env.OUT ?? here;
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const NOTES = process.env.NOTES !== "0";
const BASE = "http://127.0.0.1";

const children = [];
let browser;
function cleanup() {
  browser?.close();
  for (const child of children) child.kill("SIGTERM");
  // Chromium is still writing its profile as it exits.
  rmSync(work, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 300,
  });
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(1));

const step = (message) => console.log(`==> ${message}`);
function die(message, detail) {
  console.error(message);
  if (detail) console.error(detail);
  process.exit(1);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      stdio: "pipe",
      encoding: "utf8",
      ...options,
    });
  } catch (err) {
    die(
      `${command} ${args.join(" ")} failed`,
      [err.stdout, err.stderr].join("\n"),
    );
  }
}

// --- build ---------------------------------------------------------------------------------

const chromium = findChromium();
if (!chromium) die("no Chromium or Chrome found; set CHROMIUM");

// Something already on :80 would be photographed instead, and look like success.
if (
  await fetch(`${BASE}/healthz`).then(
    () => true,
    () => false,
  )
) {
  die(`something is already listening on ${BASE}; stop it first`);
}

step("building the frontend");
if (!existsSync(join(root, "web", "node_modules")))
  run("npm", ["ci"], { cwd: join(root, "web") });
run("npm", ["run", "build"], { cwd: join(root, "web") });

step("building the binary");
const binary = join(work, "taskio");
run("go", ["build", "-o", binary, "."], { cwd: root });

// --- the server ----------------------------------------------------------------------------

step("starting taskio");
const data = join(work, "data");
mkdirSync(data);
// From the checkout, which is where it looks for web/dist when there is no image layout.
const server = spawn(binary, ["serve"], {
  cwd: root,
  env: { ...process.env, TASKIO_PUBLIC_URL: BASE, TASKIO_DATA_DIR: data },
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(server);
let printed = "";
server.stdout.on("data", (d) => (printed += d));
server.stderr.on("data", (d) => (printed += d));

// An empty database means no administrator, so serve prints the one way in.
const invite = await waitFor(
  () => /\/invite\/([A-Za-z0-9_-]+)/.exec(printed)?.[1],
).catch(() => die("taskio printed no invitation", printed));

/** One call as the account, or as a token when one is given. Any failure ends the run. */
async function api(path, { method = "GET", body, as, type } = {}) {
  const raw = body instanceof Buffer;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(as
        ? { Authorization: `Bearer ${as}` }
        : { Cookie: `taskio_auth=${cookie}` }),
      ...(body ? { "Content-Type": type ?? "application/json" } : {}),
    },
    ...(body ? { body: raw ? body : JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) die(`${method} ${path} answered ${res.status}`, text);
  return text ? JSON.parse(text) : null;
}

// --- the browser, which signs in and draws the pictures before it photographs anything -----

browser = await Browser.launch({
  chromium,
  port: 9334,
  profile: join(work, "chrome"),
  base: BASE,
});
await browser.scheme(THEME);

// Signed in from the browser rather than from here, so the session it lists is a browser's and
// not "node". Without the Headless, which is what the sessions list would otherwise name.
const agent = (await browser.eval("navigator.userAgent")).replace(
  "HeadlessChrome",
  "Chrome",
);
await browser.send("Emulation.setUserAgentOverride", { userAgent: agent });
await browser.open("/login");
const accepted =
  await browser.eval(`fetch("/api/auth/invites/${invite}/accept", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: ${JSON.stringify(JSON.stringify(account))},
}).then((r) => r.status)`);
if (accepted >= 300)
  die(`accepting the invitation answered ${accepted}`, printed);
const { cookies } = await browser.send("Network.getCookies", { urls: [BASE] });
const cookie = cookies.find((c) => c.name === "taskio_auth")?.value;
if (!cookie) die("no session cookie came back");

step("drawing the pictures");
const pictures = {};
for (const [key, { width, height, svg }] of Object.entries(images)) {
  const page = `<!doctype html><body style="margin:0">${svg}</body>`;
  await browser.viewport(width, height, 2);
  await browser.load(
    `data:text/html;base64,${Buffer.from(page).toString("base64")}`,
  );
  const png = await browser.png();
  pictures[key] = (
    await api("/api/assets", { method: "POST", body: png, type: "image/png" })
  ).url;
}

// --- the seed ------------------------------------------------------------------------------

step("seeding");
const [first, ...rest] = projects;
const main = (await api("/api/projects")).projects.find((p) => p.default);
await api(`/api/projects/${main.id}`, {
  method: "PATCH",
  body: { name: first.name, slug: first.slug },
});
for (const p of rest)
  await api("/api/projects", {
    method: "POST",
    body: { name: p.name, slug: p.slug },
  });

const secrets = {};
for (const t of tokens) {
  secrets[t.key] = (
    await api("/api/tokens", {
      method: "POST",
      body: { label: t.label, projects: t.projects },
    })
  ).secret;
}

// Every task first, so a description can mention one written after it.
const ids = {};
for (const p of projects) {
  for (const t of p.tasks) {
    const made = await api(`/api/tasks?project=${p.slug}`, {
      method: "POST",
      body: {
        title: t.title,
        tags: t.tags ?? [],
        priority: t.priority ?? 0,
        pinned: t.pinned ?? false,
        color: t.color ?? "",
      },
    });
    ids[t.key] = made.id;
  }
}

const resolveText = (text) =>
  text
    .replace(/@\{(\w+)\}/g, (_, key) => `@${ids[key] ?? die(`no task ${key}`)}`)
    .replace(
      /\(image:(\w+)\)/g,
      (_, key) => `(${pictures[key] ?? die(`no image ${key}`)})`,
    );

const times = [];
const now = Math.floor(Date.now() / 1000);
for (const p of projects) {
  // After the tasks, which are what bring a tag into being.
  for (const g of p.groups)
    await api(`/api/groups?project=${p.slug}`, { method: "POST", body: g });
  for (const t of p.tasks) {
    const id = ids[t.key];
    if (t.description)
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: { description: resolveText(t.description) },
      });
    for (const c of t.comments ?? []) {
      const made = await api(`/api/tasks/${id}/comments`, {
        method: "POST",
        body: { body: resolveText(c.body) },
        as: c.by ? secrets[c.by] : undefined,
      });
      if (c.ago)
        times.push(
          `UPDATE comments SET created_at = ${now - seconds(c.ago)} WHERE id = '${made.id}';`,
        );
    }
    if (t.done) await api(`/api/tasks/${id}/done`, { method: "POST" });
    if (t.age) {
      const at = now - seconds(t.age);
      times.push(
        `UPDATE tasks SET created_at = ${at}, updated_at = ${at}, poked_at = ${at} WHERE id = '${id}';`,
      );
      if (t.done)
        times.push(
          `UPDATE tasks SET done_at = ${at + 86400} WHERE id = '${id}';`,
        );
    }
  }
}

// Nothing in the API sets a time, and a list where everything was written a second ago shows
// neither ages nor the staleness they are coloured by.
step("backdating");
run("sqlite3", [join(data, "taskio.db"), times.join("\n")]);

function seconds(span) {
  const [, n, unit] = /^(\d+)([hdw])$/.exec(span) ?? die(`not a span: ${span}`);
  return Number(n) * { h: 3600, d: 86400, w: 604800 }[unit];
}

// --- the shots -----------------------------------------------------------------------------

/** Everything drawn: fonts in, pictures decoded, and the dialog's entrance over. */
async function settled() {
  await browser.eval("document.fonts.ready.then(() => true)");
  await waitFor(() =>
    browser.eval(
      "[...document.images].every((i) => i.complete && i.naturalWidth > 0)",
    ),
  );
  await sleep(400);
}

const click = (selector, text) =>
  browser.eval(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) throw new Error("nothing to click: " + ${JSON.stringify(text)});
    el.click();
    return true;
  })()`);

const into = (selector) =>
  browser.eval(
    `(document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "center" }), true)`,
  );

/** The region an element takes with its notes, and a margin, inside the window. */
const around = (selector, margin = 16) =>
  browser.eval(`(() => {
    const rects = [document.querySelector(${JSON.stringify(selector)}), ...document.querySelectorAll("[data-note]")]
      .map((el) => el.getBoundingClientRect());
    const x = Math.max(0, Math.min(...rects.map((r) => r.left)) - ${margin});
    const y = Math.max(0, Math.min(...rects.map((r) => r.top)) - ${margin});
    const right = Math.min(innerWidth, Math.max(...rects.map((r) => r.right)) + ${margin});
    const bottom = Math.min(innerHeight, Math.max(...rects.map((r) => r.bottom)) + ${margin});
    return { x, y, width: right - x, height: bottom - y };
  })()`);

/**
 * Popovers over the page, each pointing at what it explains.
 *
 * A note is { at, text?, tight?, say, side, dx?, dy?, width? }: at is a selector, and text picks
 * the one whose words include it. The popover goes on that side of it, nudged by dx and dy, with
 * an arrow on the edge facing it; side "over" sits on it without one. Shown as a popover, because
 * a task's dialog is in the top layer and anything else is drawn under it.
 */
const annotate = (notes) =>
  browser.eval(`(() => {
    const notes = ${JSON.stringify(notes)};
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    const ground = dark ? "#f4f4f5" : "#1d1d20", ink = dark ? "#18181b" : "#fafafa";
    const host = document.createElement("div");
    host.popover = "manual";
    host.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none";
    document.body.append(host);
    host.showPopover();
    for (const n of notes) {
      const target = [...document.querySelectorAll(n.at)].find((el) => !n.text || el.textContent.includes(n.text));
      if (!target) throw new Error("no " + n.at + (n.text ? " saying " + n.text : ""));
      // tight measures the words rather than the box, for a line whose box is the whole width:
      // the text that says them, or the element's first.
      let r = target.getBoundingClientRect();
      if (n.tight) {
        const walk = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walk.nextNode()) && !(node.textContent.trim() && (!n.text || node.textContent.includes(n.text))));
        const range = document.createRange();
        range.selectNodeContents(node ?? target);
        r = range.getBoundingClientRect();
      }
      const box = document.createElement("div");
      box.dataset.note = "";
      box.textContent = n.say;
      box.style.cssText = "position:absolute;max-width:" + (n.width ?? 240) + "px;padding:7px 11px;border-radius:9px;" +
        "background:" + ground + ";color:" + ink + ";font:500 13px/1.35 system-ui,sans-serif;" +
        "box-shadow:0 1px 2px rgb(0 0 0 / 0.12),0 8px 24px rgb(0 0 0 / 0.18)";
      host.append(box);
      const b = box.getBoundingClientRect();
      const gap = 10;
      let x = { right: r.right + gap, left: r.left - gap - b.width }[n.side] ?? r.left + r.width / 2 - b.width / 2;
      let y = { below: r.bottom + gap, above: r.top - gap - b.height }[n.side] ?? r.top + r.height / 2 - b.height / 2;
      x = Math.min(innerWidth - b.width - 10, Math.max(10, x + (n.dx ?? 0)));
      y = Math.min(innerHeight - b.height - 10, Math.max(10, y + (n.dy ?? 0)));
      box.style.left = x + "px";
      box.style.top = y + "px";
      if (n.side === "over") continue;
      // A square turned half over, on the edge that faces the target and level with its middle.
      const arrow = document.createElement("div");
      const along = (from, size, mid) => Math.min(size - 14, Math.max(14, mid - from));
      const horizontal = n.side === "right" || n.side === "left";
      const at = horizontal ? along(y, b.height, r.top + r.height / 2) : along(x, b.width, r.left + r.width / 2);
      arrow.style.cssText = "position:absolute;width:10px;height:10px;background:" + ground + ";transform:rotate(45deg);" +
        (horizontal ? "top:" + (at - 5) + "px;" + (n.side === "right" ? "left:-4px" : "right:-4px")
                    : "left:" + (at - 5) + "px;" + (n.side === "below" ? "top:-4px" : "bottom:-4px"));
      box.append(arrow);
    }
    return true;
  })()`);

/**
 * Every id the page shows, swapped for one that is the same on every run.
 *
 * The server's are random, so without this each capture drew new ones into the rows, the title
 * bars, the mention chips and the token list, and git saw eight changed pictures of the same
 * screens. Each stand-in is made from its seed key, in the real one's shape and length, so the
 * layout does not move. Swapped in the page's text and fields just before the picture, with the
 * caret hidden and every transition finished, which would otherwise differ from run to run.
 */
const hashed = (key, length, alphabet) =>
  [...createHash("sha256").update(key).digest()]
    .slice(0, length)
    .map((byte) => alphabet[byte % alphabet.length])
    .join("");
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const standIns = [
  ...Object.entries(ids).map(([key, id]) => [
    id,
    hashed(`task:${key}`, 8, CROCKFORD),
  ]),
  ...Object.entries(pictures).map(([key, url]) => {
    const id = /a_[0-9a-z]+/.exec(url)[0];
    return [id, `a_${hashed(`picture:${key}`, 26, CROCKFORD)}`];
  }),
  ...(await api("/api/tokens")).tokens.flatMap((t) => {
    const key =
      tokens.find((seeded) => seeded.label === t.label)?.key ?? t.label;
    const bare = t.id.replace(/^k_/, "");
    const fake = hashed(`token:${key}`, bare.length, "0123456789abcdef");
    return bare === t.id
      ? [[t.id, fake]]
      : [
          [t.id, `k_${fake}`],
          [bare, fake],
        ];
  }),
];
const disguise = () =>
  browser.eval(`(() => {
    const pairs = ${JSON.stringify(standIns)};
    const swap = (text) => pairs.reduce((t, [real, fake]) => t.split(real).join(fake), text);
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walk.nextNode()); ) {
      const next = swap(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const field of document.querySelectorAll("textarea, input")) {
      const next = swap(field.value);
      if (next !== field.value) field.value = next;
    }
    // And everything at rest: a colour mid-transition was a few pixels different each run.
    const style = document.createElement("style");
    style.textContent =
      "*, ::before, ::after { caret-color: transparent !important; transition: none !important; }";
    document.head.append(style);
    for (const animation of document.getAnimations()) animation.finish();
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))));
  })()`);

const tokensPanel = `(() => [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent.trim() === "Tokens"))()`;

// Each shot is the whole window unless it names an element, which is photographed alone.
const shots = [
  {
    name: "list",
    go: () => browser.open("/"),
    notes: [
      {
        at: "li[data-task] button",
        text: "Clear the gutters",
        say: "Ages warm up as a task goes stale",
        side: "right",
      },
    ],
  },
  {
    name: "row",
    go: () => browser.open("/"),
    element: `li[data-task="${ids.tap}"]`,
  },
  {
    name: "search",
    go: async () => {
      await browser.open("/");
      await browser.eval(
        `(document.querySelector('input[type="search"]').focus(), true)`,
      );
      const before = await browser.eval(
        "document.querySelectorAll('li[data-task]').length",
      );
      await browser.send("Input.insertText", { text: search });
      // The list narrowed, which is the search having answered.
      await waitFor(() =>
        browser.eval(
          `(() => { const n = document.querySelectorAll("li[data-task]").length; return n > 0 && n < ${before}; })()`,
        ),
      );
    },
    notes: [
      { at: "li[data-task]", say: "Misspelt, and still found", side: "below" },
    ],
  },
  // The same task written and then read, so the two read as one dialog's two faces.
  {
    name: "edit",
    go: async () => {
      await browser.open(`/t/${ids.tap}`);
      await waitFor(() =>
        browser.eval("!!document.querySelector('dialog[open] .prose')"),
      );
      await click("dialog[open] button", "Edit");
      await waitFor(() =>
        browser.eval("!!document.querySelector('dialog[open] textarea')"),
      );
    },
    notes: [
      {
        at: "dialog[open] button",
        text: "View",
        say: "View shows it rendered",
        side: "left",
      },
    ],
  },
  {
    name: "task",
    // Read, which is how a task opens.
    go: async () => {
      await browser.open(`/t/${ids.tap}`);
      await waitFor(() =>
        browser.eval("!!document.querySelector('dialog[open] .prose img')"),
      );
    },
    notes: [
      {
        at: "dialog[open] .prose img",
        say: "A pasted photo stays where it was written",
        side: "over",
        dx: 170,
        dy: 70,
      },
      {
        at: "dialog[open] li[data-check]",
        text: "Take the handle off",
        tight: true,
        say: "Read view: its checkboxes tick right here, no editor",
        side: "right",
      },
    ],
  },
  {
    name: "comments",
    go: async () => {
      await browser.open(`/t/${ids.tap}`);
      await waitFor(() =>
        browser.eval("!!document.querySelector('dialog[open] section')"),
      );
      await into("dialog[open] section");
    },
    element: "dialog[open] section",
    notes: [
      {
        at: "dialog[open] section li p > span",
        text: "claude",
        say: "Agents comment too, signed with their token",
        side: "right",
        dx: 24,
        dy: -8,
        width: 320,
      },
    ],
  },
  {
    name: "tokens",
    go: async () => {
      await browser.open("/settings");
      await waitFor(() =>
        browser.eval(`!!${tokensPanel}?.querySelector("li, tr")`),
      );
      await browser.eval(
        `(${tokensPanel}.scrollIntoView({ block: "start" }), true)`,
      );
    },
    notes: [
      {
        at: "section span",
        text: "Home · garden",
        say: "Scoped: it sees only garden tasks",
        side: "below",
      },
    ],
  },
  {
    name: "docs",
    go: () => browser.load(`${BASE}/docs`),
    notes: [
      {
        at: "h1",
        tight: true,
        say: "The one page an agent reads. No SDK",
        side: "right",
      },
    ],
  },
];

step(`photographing at ${SIZE}×${SIZE}, ${SCALE}x, ${THEME}`);
for (const shot of shots) {
  if (ONLY.length && !ONLY.includes(shot.name)) continue;
  await browser.viewport(SIZE, SIZE, SCALE);
  await shot.go();
  await settled();
  await disguise();
  if (NOTES && shot.notes) await annotate(shot.notes);
  const clip = shot.element ? await around(shot.element) : undefined;
  const file = join(OUT, `${shot.name}.png`);
  const png = stamp(await browser.png(clip), SCALE);
  const before = existsSync(file) ? readFileSync(file) : null;
  if (before && alike(before, png)) {
    // The same picture, kept; its metadata brought up to date if the stamp has changed.
    const restamped = stamp(before, SCALE);
    if (!restamped.equals(before)) writeFileSync(file, restamped);
    console.log(`  ${shot.name}.png, unchanged`);
    continue;
  }
  writeFileSync(file, png);
  console.log(`  ${shot.name}.png`);
}

step("done");
process.exit(0);

/**
 * The density a PNG was drawn at, said the two ways a macOS screenshot says it: a pHYs chunk,
 * and an EXIF block with the same resolution in inches, which is what some of the system reads
 * instead. A 2x capture says 144 dpi, and a viewer that reads it shows it at the size it was on
 * screen rather than twice that.
 */
function stamp(png, scale) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const dpi = 72 * scale;
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 0);
  phys.writeUInt32BE(Math.round(dpi / 0.0254), 4);
  phys[8] = 1; // the unit is the metre

  // A big-endian TIFF header and one directory of three entries: XResolution and YResolution,
  // each a rational stored after the directory, and ResolutionUnit, 2 being the inch.
  const exif = Buffer.alloc(66);
  exif.write("MM", 0, "latin1");
  exif.writeUInt16BE(42, 2);
  exif.writeUInt32BE(8, 4);
  exif.writeUInt16BE(3, 8);
  const entry = (at, tag, type, value) => {
    exif.writeUInt16BE(tag, at);
    exif.writeUInt16BE(type, at + 2);
    exif.writeUInt32BE(1, at + 4);
    if (type === 3) exif.writeUInt16BE(value, at + 8);
    else exif.writeUInt32BE(value, at + 8);
  };
  entry(10, 0x011a, 5, 50);
  entry(22, 0x011b, 5, 58);
  entry(34, 0x0128, 3, 2);
  exif.writeUInt32BE(0, 46); // no next directory
  for (const at of [50, 58]) {
    exif.writeUInt32BE(dpi, at);
    exif.writeUInt32BE(1, at + 4);
  }

  // After IHDR, which is always first, and in place of any already there.
  const parts = [png.subarray(0, 8)];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const end = at + 12 + length;
    if (type !== "pHYs" && type !== "eXIf") parts.push(png.subarray(at, end));
    if (type === "IHDR") parts.push(chunk("pHYs", phys), chunk("eXIf", exif));
    at = end;
  }
  return Buffer.concat(parts);
}

/**
 * Whether two captures are one picture, give or take the rasteriser.
 *
 * With the content pinned, a run still moved a few dozen anti-aliased pixels at an edge by a few
 * levels now and then, and git saw a new file. Kept when under a thousandth of the pixels differ
 * and none by more than 24 of 255: a moved icon or a changed word is far more than 24 levels,
 * and a changed colour is far more than a thousandth of the picture.
 */
function alike(before, after) {
  const a = decode(before);
  const b = decode(after);
  if (
    !a ||
    !b ||
    a.width !== b.width ||
    a.height !== b.height ||
    a.channels !== b.channels
  ) {
    return false;
  }
  let differing = 0;
  for (let at = 0; at < a.pixels.length; at += a.channels) {
    let worst = 0;
    for (let c = 0; c < a.channels; c++) {
      worst = Math.max(worst, Math.abs(a.pixels[at + c] - b.pixels[at + c]));
    }
    if (worst > 24) return false;
    if (worst > 0) differing++;
  }
  return differing <= (a.pixels.length / a.channels) * 0.001;
}

/** The pixels of an 8-bit, non-interlaced RGB or RGBA PNG, which is what Chromium writes. */
function decode(png) {
  let width, height, channels;
  const data = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = { 2: 3, 6: 4 }[body[9]];
      if (body[8] !== 8 || !channels || body[12] !== 0) return null;
    }
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c =
        x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = raw[line + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  return { width, height, channels, pixels };
}
