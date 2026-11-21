#!/usr/bin/env node
// Fills a taskio with projects, groups and tasks to click around in.
//
//   TASKIO_URL=http://localhost:3009 node scripts/seed.mjs
//
// Through the API, so the server must be up. It signs in as an existing account: TASKIO_USER
// and TASKIO_PASSWORD, or it asks. TASKIO_URL is where, http://localhost unless set.
//
// Safe to run again: a project, a group or a task (by title, within its project) that is
// already there is left alone.
//
// Nothing in the API sets a time, so every task it makes is a minute old. With TASKIO_DB, the
// path to the server's taskio.db, it writes the ages below straight into it with sqlite3, as the
// screenshots do. Only for a database on this machine's own disk: not one a container on a Mac
// holds through a mounted folder, which two systems writing at once can corrupt.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const BASE = (process.env.TASKIO_URL ?? "http://localhost").replace(/\/$/, "");
const TIMEOUT = 10_000;

/** YYYY-MM-DD, so many days from today: what snoozed_until takes for noon that day. */
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * What to seed. Each project's groups, then its tasks. The default project is whichever the
 * account has; the rest are made by name. ago is in days, and applied only with TASKIO_DB.
 */
const SEED = [
  {
    default: true,
    groups: [
      { name: "Home", tags: ["home"], color: "#2563eb" },
      { name: "Garden", tags: ["garden"], color: "#16a34a" },
      { name: "Repairs", tags: ["repair", "plumbing"], color: "" },
      { name: "Errands", tags: ["errands"], color: "#d97706" },
    ],
    tasks: [
      {
        title: "Fix the kitchen tap",
        tags: ["repair", "plumbing"],
        pinned: true,
        priority: 2,
        description:
          "Drips from the base of the spout, so it is the cartridge.\n\n- [x] Turn the valve off\n- [ ] Take the handle off\n- [ ] Swap the cartridge",
        comments: ["Cartridge is 35 mm, ordered one."],
      },
      {
        title: "Buy a cartridge and O-rings",
        ago: 2,
        tags: ["plumbing", "errands"],
        priority: 1,
      },
      {
        title: "Repot the fig",
        ago: 9,
        tags: ["garden"],
        description: "One size up, grit at the bottom.",
      },
      {
        title: "Plan the vegetable beds",
        ago: 6,
        tags: ["garden"],
        color: "#16a34a",
      },
      { title: "Clear the gutters", tags: ["home"], snooze: 3 },
      { title: "Plant the bulbs", tags: ["garden"], snooze: 10 },
      {
        title: "Return the library books",
        ago: 40,
        tags: ["errands"],
        color: "#eab308",
      },
      {
        title: "Pick up the dry cleaning",
        ago: 5,
        tags: ["errands"],
        done: true,
      },
      { title: "Bleed the radiators", ago: 24, tags: ["home", "repair"] },
      {
        title: "Replace the hallway bulb",
        ago: 12,
        tags: ["home"],
        done: true,
      },
      {
        title: "Sharpen the mower blade",
        tags: ["garden", "repair"],
        snooze: 30,
      },
      {
        title: "Call the plumber about the boiler",
        ago: 1,
        tags: ["plumbing"],
        priority: 3,
      },
    ],
  },
  {
    name: "Side project",
    groups: [
      { name: "Bugs", tags: ["bug"], color: "#dc2626" },
      { name: "Interface", tags: ["ui"], color: "#7c3aed" },
      { name: "API", tags: ["api"], color: "" },
      { name: "Docs", tags: ["docs"], color: "#0891b2" },
    ],
    tasks: [
      {
        title: "Login form loses the password on error",
        tags: ["bug", "ui"],
        pinned: true,
        priority: 2,
      },
      { title: "Paginate the task list", ago: 15, tags: ["api"], priority: 1 },
      { title: "Dark mode for the settings page", ago: 45, tags: ["ui"] },
      {
        title: "Write the API quick start",
        ago: 8,
        tags: ["docs"],
        description: "Token, first request, a list, a patch.",
      },
      {
        title: "Rate limit the login",
        tags: ["api", "bug"],
        comments: ["Five a minute per name seems fine."],
      },
      { title: "Empty state for search", ago: 20, tags: ["ui"], done: true },
      { title: "Upgrade the build tooling", tags: ["docs"], snooze: 14 },
      { title: "Crash when a tag has a slash", tags: ["bug"], priority: 3 },
    ],
  },
  {
    name: "Reading",
    groups: [
      { name: "Books", tags: ["book"], color: "#9333ea" },
      { name: "Articles", tags: ["article"], color: "" },
    ],
    tasks: [
      { title: "The design of everyday things", tags: ["book"], pinned: true },
      { title: "A pattern language", ago: 3, tags: ["book"], snooze: 21 },
      { title: "Read the SQLite WAL notes", ago: 33, tags: ["article"] },
      {
        title: "Finish the essay on calm technology",
        tags: ["article"],
        done: true,
      },
      { title: "Thinking in systems", ago: 10, tags: ["book"], priority: 1 },
    ],
  },
  {
    name: "Work",
    groups: [
      { name: "Reviews", tags: ["review"], color: "#0d9488" },
      { name: "Ops", tags: ["ops"], color: "#ea580c" },
      { name: "Meetings", tags: ["meeting"], color: "" },
      { name: "Hiring", tags: ["hiring"], color: "#db2777" },
    ],
    tasks: [
      {
        title: "Review the backup change",
        tags: ["review", "ops"],
        pinned: true,
        priority: 2,
      },
      {
        title: "Rotate the staging certificates",
        ago: 4,
        tags: ["ops"],
        priority: 1,
      },
      { title: "Agenda for the planning meeting", tags: ["meeting"] },
      {
        title: "Read the two take-home submissions",
        ago: 11,
        tags: ["hiring", "review"],
      },
      { title: "Retro notes", ago: 7, tags: ["meeting"], done: true },
      { title: "Disk alert on the build box", tags: ["ops"], snooze: 2 },
      {
        title: "Write the onboarding checklist",
        ago: 70,
        tags: ["hiring"],
        color: "#db2777",
      },
    ],
  },
  {
    name: "Travel",
    groups: [
      { name: "Packing", tags: ["packing"], color: "#65a30d" },
      { name: "Bookings", tags: ["booking"], color: "#2563eb" },
    ],
    tasks: [
      { title: "Book the train", tags: ["booking"], priority: 2 },
      { title: "Find a place for the second week", ago: 18, tags: ["booking"] },
      { title: "Chargers and adapters", ago: 8, tags: ["packing"] },
      {
        title: "Renew the passport",
        tags: ["booking"],
        snooze: 7,
        priority: 1,
      },
      { title: "Rain jacket", tags: ["packing"], done: true },
    ],
  },
];

function ask(question, { hidden = false } = {}) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  if (hidden) {
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
      else if (s.includes("\n")) rl.output.write("\n");
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

let cookie = "";

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: `taskio_auth=${cookie}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${path} answered ${res.status}: ${text}`);
  return { data: text ? JSON.parse(text) : null, res };
}

const q = (params) => {
  const s = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== ""),
  ).toString();
  return s ? `?${s}` : "";
};

async function main() {
  try {
    await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw new Error(`nothing answers at ${BASE}; start taskio first`);
  }

  const username = process.env.TASKIO_USER || (await ask("Username: "));
  const password =
    process.env.TASKIO_PASSWORD || (await ask("Password: ", { hidden: true }));
  const { res } = await api("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
  cookie =
    /taskio_auth=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  if (!cookie) throw new Error("signed in, but no session cookie came back");

  const made = { projects: 0, groups: 0, tasks: 0 };
  /** What was made, with how old it should look. */
  const aged = [];
  let { projects } = (await api("/api/projects")).data;

  for (const plan of SEED) {
    let project = plan.default
      ? projects.find((p) => p.default)
      : projects.find((p) => p.name === plan.name);
    if (!project) {
      project = (
        await api("/api/projects", {
          method: "POST",
          body: { name: plan.name },
        })
      ).data;
      projects = [...projects, project];
      made.projects++;
    }
    const slug = project.default ? "" : project.slug;

    const { groups } = (await api(`/api/groups${q({ project: slug })}`)).data;
    for (const group of plan.groups) {
      if (groups.some((g) => g.name === group.name)) continue;
      await api(`/api/groups${q({ project: slug })}`, {
        method: "POST",
        body: group,
      });
      made.groups++;
    }

    const { tasks } = (
      await api(
        `/api/tasks${q({ project: slug, status: "all", limit: "1000" })}`,
      )
    ).data;
    for (const task of plan.tasks) {
      if (tasks.some((t) => t.title === task.title)) continue;
      const { done, snooze, comments, ago, ...fields } = task;
      const body = {
        ...fields,
        ...(snooze ? { snoozed_until: inDays(snooze) } : {}),
      };
      const { data: created } = await api(`/api/tasks${q({ project: slug })}`, {
        method: "POST",
        body,
      });
      for (const comment of comments ?? [])
        await api(`/api/tasks/${created.id}/comments`, {
          method: "POST",
          body: { body: comment },
        });
      if (done) await api(`/api/tasks/${created.id}/done`, { method: "POST" });
      if (ago) aged.push({ id: created.id, ago, done: !!done });
      made.tasks++;
    }
  }

  const db = process.env.TASKIO_DB;
  if (db && aged.length) {
    const now = Math.floor(Date.now() / 1000);
    const sql = aged.map(({ id, ago, done }) => {
      const at = now - ago * 86400;
      // Finished a day after it was written, or now, whichever is sooner.
      const finished = done ? `, done_at = ${Math.min(at + 86400, now)}` : "";
      return `UPDATE tasks SET created_at = ${at}, updated_at = ${at}, poked_at = ${at}${finished} WHERE id = '${id}';`;
    });
    execFileSync("sqlite3", [db, sql.join("\n")], { timeout: TIMEOUT });
  }

  console.log(
    `Seeded ${BASE}: ${made.projects} projects, ${made.groups} groups, ${made.tasks} tasks made` +
      (db ? `, ${aged.length} aged.` : "."),
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
