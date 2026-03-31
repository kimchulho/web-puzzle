import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [
  path.join(root, "node_modules", ".vite"),
  path.join(root, "node_modules", ".vite-web"),
  path.join(root, "apps", "web", "node_modules", ".vite"),
];

for (const dir of dirs) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("removed:", dir);
  } catch {
    // ignore
  }
}
