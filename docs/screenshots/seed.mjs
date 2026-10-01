// What the screenshots show: one account's projects, groups, tasks, comments and tokens.
//
// Invented, all of it. Adding a project, a group or a task is an entry here and nothing else:
// capture.mjs walks this file and makes each thing through the API, in the order it is written.
//
// Inside a description or a comment:
//   @{key}         a mention of the task with that key, turned into its id once it exists;
//                  @{key}#1 is that task's first comment
//   (image:key)    one of the pictures below, drawn in the browser and uploaded first
//
// age is how long ago the task was written and last poked, and ago how long ago a comment was:
// 5h, 3d, 2w. Nothing in the API sets a time, so the capture writes them into the database.

// Typed into the search box, misspelt on purpose: the search is fuzzy, and this is the shot that
// says so.
export const search = "vegtable bds";

export const account = {
  username: "robin",
  password: "a password nobody will ever type",
};

// Tokens by key, so a comment can say which one wrote it. An empty projects list is every
// project; a row with a scope confines the token to the tasks carrying those tags.
export const tokens = [
  { key: "claude", label: "claude", projects: [] },
  {
    key: "gardener",
    label: "garden helper",
    projects: [{ project: "home", scope: "garden" }],
  },
];

// The first project is the default one the account starts with, renamed.
export const projects = [
  {
    name: "Home",
    slug: "home",
    groups: [
      { name: "Repairs", tags: ["repair", "plumbing"], color: "#eab308" },
      { name: "Garden", tags: ["garden"], color: "#16a34a" },
      { name: "Errands", tags: ["errands"], color: "#2563eb" },
    ],
    tasks: [
      {
        key: "tap",
        title: "Fix the kitchen tap",
        tags: ["repair", "plumbing"],
        priority: 2,
        pinned: true,
        age: "9d",
        description: `It drips from the base of the spout, not the nozzle, so it is the cartridge and not a washer.

![The tap, taken apart](image:tap)

- [x] Turn the valve under the sink off
- [x] Take the handle off — 2.5 mm hex key
- [ ] Swap the cartridge
- [ ] Check the O-rings while it is open

Parts: @{parts}`,
        comments: [
          {
            by: "claude",
            ago: "2d",
            body: "The drawing matches a 35 mm ceramic cartridge. I put one on @{parts}, with the O-ring size.",
          },
          {
            ago: "5h",
            body: "Valve off, handle out. The old cartridge is **cracked**, which explains it.",
          },
        ],
      },
      {
        key: "parts",
        title: "Buy a cartridge and O-rings",
        tags: ["errands", "plumbing"],
        priority: 1,
        age: "2d",
        description: `- 35 mm ceramic cartridge
- O-rings, 2 × 18 mm

For @{tap}, the size from @{tap}#1.`,
      },
      {
        key: "beds",
        title: "Plan the vegetable beds",
        tags: ["garden"],
        color: "#16a34a",
        age: "6d",
        description: `Three beds this year, rotated one along from last.

![Where everything goes](image:beds)

- [ ] Order seed potatoes
- [ ] Dig compost into the middle bed`,
        comments: [
          {
            by: "gardener",
            ago: "1d",
            body: "Frost is forecast until the 20th, so the beans wait.",
          },
        ],
      },
      {
        key: "gutters",
        title: "Clear the gutters before the rain",
        tags: ["chores"],
        age: "24d",
      },
      {
        key: "fig",
        title: "Repot the fig",
        tags: ["garden"],
        age: "12d",
        description: "One size up, and a layer of grit at the bottom.",
      },
      {
        key: "library",
        title: "Return the library books",
        tags: ["errands"],
        color: "#eab308",
        age: "5w",
      },
      {
        key: "boiler",
        title: "Book the boiler service",
        tags: ["chores"],
        age: "3w",
        done: true,
      },
      {
        key: "bins",
        title: "Put bin day on the calendar",
        tags: ["chores"],
        age: "2w",
        done: true,
      },
    ],
  },
  {
    name: "Side Project",
    slug: "side-project",
    groups: [
      { name: "Launch", tags: ["launch"], color: "#7c3aed" },
      { name: "Bugs", tags: ["bug"], color: "#dc2626" },
    ],
    tasks: [
      {
        key: "picker",
        title: "Date picker opens off screen in Safari",
        tags: ["bug"],
        priority: 2,
        age: "1d",
        description: `Only below 400 px wide, and only when the field is in the last row.`,
        comments: [
          {
            by: "claude",
            ago: "20h",
            body: "Reproduced at 390 px. The popover measures the window before the keyboard has moved it.",
          },
        ],
      },
      {
        key: "landing",
        title: "Write the landing page",
        tags: ["launch"],
        priority: 1,
        age: "3d",
        description: `## What it says

1. What it is, in one line
2. A screenshot
3. How to run it`,
      },
      {
        key: "backups",
        title: "Set up nightly backups",
        tags: ["ops"],
        age: "10d",
      },
      {
        key: "name",
        title: "Pick a name for the export format",
        tags: ["launch"],
        age: "18d",
      },
    ],
  },
  {
    name: "Reading",
    slug: "reading",
    groups: [],
    tasks: [
      {
        key: "soil",
        title: "Finish the chapter on soil",
        tags: ["book"],
        age: "4d",
      },
      {
        key: "starter",
        title: "Read up on sourdough starters",
        tags: ["article"],
        age: "8d",
      },
    ],
  },
];

// Drawn rather than committed: an SVG each, rendered in the capture's own browser and uploaded as
// a PNG, which is what somebody pasting a photo of their sink would have sent.
const paper = "#fbfaf6";
const ink = "#3b4049";
const faint = "#9aa0aa";
const accent = "#e8702a";
const font = `font-family="system-ui, sans-serif" fill="${ink}"`;

export const images = {
  tap: {
    width: 720,
    height: 360,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360">
  <rect width="720" height="360" fill="${paper}"/>
  <g stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="300" y="40" width="120" height="36" rx="10"/>
    <line x1="360" y1="76" x2="360" y2="96" stroke-dasharray="4 6" stroke="${faint}"/>
    <rect x="330" y="100" width="60" height="70" rx="6"/>
    <line x1="338" y1="118" x2="382" y2="118"/>
    <line x1="338" y1="134" x2="382" y2="134"/>
    <path d="M352 150 l8 10 l-6 6" stroke="${accent}"/>
    <line x1="360" y1="170" x2="360" y2="188" stroke-dasharray="4 6" stroke="${faint}"/>
    <ellipse cx="360" cy="196" rx="34" ry="7"/>
    <ellipse cx="360" cy="214" rx="34" ry="7"/>
    <line x1="360" y1="222" x2="360" y2="236" stroke-dasharray="4 6" stroke="${faint}"/>
    <path d="M318 320 V250 a12 12 0 0 1 12 -12 h60 a12 12 0 0 1 12 12 V270 h120 a24 24 0 0 1 24 24 v10"/>
    <line x1="300" y1="320" x2="420" y2="320"/>
  </g>
  <g ${font} font-size="17">
    <text x="440" y="64">handle</text>
    <text x="410" y="140">cartridge, 35 mm</text>
    <text x="410" y="162" fill="${accent}">cracked</text>
    <text x="410" y="212">O-rings, 18 mm</text>
    <text x="150" y="290">body</text>
    <text x="560" y="330">spout</text>
  </g>
  <g stroke="${faint}" stroke-width="1.5">
    <line x1="424" y1="58" x2="436" y2="58"/>
    <line x1="394" y1="134" x2="406" y2="134"/>
    <line x1="398" y1="206" x2="406" y2="206"/>
    <line x1="196" y1="284" x2="312" y2="284"/>
  </g>
</svg>`,
  },
  beds: {
    width: 720,
    height: 300,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300" viewBox="0 0 720 300">
  <rect width="720" height="300" fill="${paper}"/>
  <g stroke="${ink}" stroke-width="3" fill="none" stroke-linejoin="round">
    <rect x="40" y="60" width="190" height="200" rx="8"/>
    <rect x="265" y="60" width="190" height="200" rx="8"/>
    <rect x="490" y="60" width="190" height="200" rx="8"/>
  </g>
  <g ${font} font-size="18" text-anchor="middle">
    <text x="135" y="44">1 · roots</text>
    <text x="360" y="44">2 · legumes</text>
    <text x="585" y="44">3 · leaves</text>
    <text x="135" y="160" font-size="16" fill="${faint}">potatoes, carrots</text>
    <text x="360" y="160" font-size="16" fill="${faint}">beans, peas</text>
    <text x="585" y="160" font-size="16" fill="${faint}">lettuce, chard</text>
  </g>
  <g fill="#6aa56f">
    ${[0, 1, 2]
      .map((bed) =>
        [0, 1, 2, 3]
          .map(
            (i) =>
              `<circle cx="${75 + bed * 225 + i * 40}" cy="210" r="9"/><circle cx="${75 + bed * 225 + i * 40}" cy="100" r="9"/>`,
          )
          .join(""),
      )
      .join("")}
  </g>
  <path d="M360 262 v24 M352 278 l8 8 l8 -8" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <text x="378" y="290" ${font} font-size="15" fill="${accent}">compost here</text>
</svg>`,
  },
};
