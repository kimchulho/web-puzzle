/**
 * `npx ait build`는 apps/toss/dist/web/index.html 이 이미 있으면
 * web.commands.build(vite build)를 건너뜁니다. 예전 번들이 .ait에 계속
 * 묶이지 않도록 AIT 빌드 직전에 삭제합니다.
 * @see node_modules/@apps-in-toss/cli/dist/index.js WebBuildStrategy.ensurePrepared
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "apps", "toss", "dist");

try {
  fs.rmSync(outdir, { recursive: true, force: true });
  console.log("[ait] removed:", outdir);
} catch {
  // ignore
}
