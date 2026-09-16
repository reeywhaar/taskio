import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

/**
 * Builds the page an agent reads before its first request.
 *
 * Static HTML with the whole text in it: an agent does one GET and reads the body, so a page
 * that needed JavaScript would look right in a browser and be empty to the only reader it is
 * for. Rendered with the same marked the editor's preview uses, so the two cannot disagree
 * about what markdown means here.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

// A checkout has docs/ beside web/; the image copies it to /docs.
async function findSource() {
  for (const path of [`${root}../docs/api.md`, "/docs/api.md"]) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // Try the next.
    }
  }
  throw new Error("docs/api.md not found");
}
const source = await findSource();
const body = marked.parse(source, { async: false });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#111113">
<link rel="alternate" type="text/markdown" href="/docs.md">
<title>taskio API</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#18181b;--muted:#52525b;--line:#e4e4e7;--surface:#f7f7f8}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a;--surface:#18181b}}
body{background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif;margin:0}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 6rem}
h1,h2,h3{line-height:1.25}
h2{margin-top:2.5rem;border-top:1px solid var(--line);padding-top:1.5rem}
a{color:inherit}
code{background:var(--surface);padding:.1em .35em;border-radius:.25rem;font-size:.9em}
pre{background:var(--surface);padding:1rem;border-radius:.5rem;overflow-x:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;font-size:.95em;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--line);padding:.4rem .6rem;text-align:left;vertical-align:top}
blockquote{margin:1rem 0;padding-left:1rem;border-left:3px solid var(--line);color:var(--muted)}
.back{font-size:.9em;color:var(--muted)}
</style>
</head>
<body>
<main>
<p class="back"><a href="/">&larr; taskio</a> &middot; <a href="/docs.md">this page as markdown</a> &middot; <a href="/settings">get a token</a></p>
${body}
</main>
</body>
</html>
`;

await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/docs.html`, html);
await writeFile(`${root}dist/docs.md`, source);
console.log("docs: dist/docs.html, dist/docs.md");
