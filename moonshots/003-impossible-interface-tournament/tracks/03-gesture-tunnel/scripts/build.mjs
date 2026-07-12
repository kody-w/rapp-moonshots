import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(trackRoot, "src");

const [template, styles, coreSource, appSource] = await Promise.all([
  readFile(resolve(sourceRoot, "index.template.html"), "utf8"),
  readFile(resolve(sourceRoot, "styles.css"), "utf8"),
  readFile(resolve(sourceRoot, "core.mjs"), "utf8"),
  readFile(resolve(sourceRoot, "app.mjs"), "utf8"),
]);

const core = coreSource.replace(/\bexport\s+/g, "");
const app = appSource.replace(
  /^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/core\.mjs["'];\s*/,
  "",
);

const output = template
  .replace("/*__STYLES__*/", styles.trim())
  .replace("//__CORE__", core.trim())
  .replace("//__APP__", app.trim());

if (/__(STYLES|CORE|APP)__/.test(output)) {
  throw new Error("Build failed: an inline placeholder remains.");
}

await writeFile(resolve(trackRoot, "index.html"), `${output.trim()}\n`, "utf8");
console.log("Built index.html (self-contained, no external assets).");
