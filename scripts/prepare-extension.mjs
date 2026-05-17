import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "out");
const nextDir = join(outDir, "_next");
const extensionAssetDir = join(outDir, "next-assets");

await rename(nextDir, extensionAssetDir);
await removeExportArtifacts(outDir);
await replaceAssetReferences(outDir);

await rename(join(outDir, "index.html"), join(outDir, "sandbox.html"));

await writeFile(
  join(outDir, "index.html"),
  `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Unfollowers</title>
  </head>
  <body>
    <script src="extension-shell.js"></script>
  </body>
</html>
`,
);

await mkdir(join(outDir, "icons"), { recursive: true });
await copyFile(join(root, "public", "instagram.svg"), join(outDir, "icons", "instagram.svg"));

async function removeExportArtifacts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.name.endsWith(".txt") || entry.name.startsWith("_")) {
        await rm(path, { recursive: true, force: true });
        return;
      }

      if (entry.isDirectory()) {
        await removeExportArtifacts(path);
      }
    }),
  );
}

async function replaceAssetReferences(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        await replaceAssetReferences(path);
        return;
      }

      if (!isTextFile(path)) {
        return;
      }

      const fileStat = await stat(path);
      if (fileStat.size > 10_000_000) {
        return;
      }

      const source = await readFile(path, "utf8");
      const updated = source
        .replaceAll("/_next/", "next-assets/")
        .replaceAll('"/_next/', '"next-assets/')
        .replaceAll("'/_next/", "'next-assets/");

      if (updated !== source) {
        await writeFile(path, updated);
      }
    }),
  );
}

function isTextFile(path) {
  return [".html", ".js", ".css", ".json", ".svg", ".txt"].includes(
    extname(path),
  );
}
