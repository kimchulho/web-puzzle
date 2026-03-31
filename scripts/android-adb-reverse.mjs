/**
 * Android 실기기(USB) + 앱인토스 샌드박스: PC의 Metro(8081)·토스 Vite(5174)·API(3000) 포트를
 * 기기의 localhost로 포워딩합니다.
 *
 * 전제: Android SDK platform-tools 의 `adb` 가 PATH에 있고, USB 디버깅으로 기기가 연결됨.
 * https://developers-apps-in-toss.toss.im/development/local-server.md
 */
import { spawnSync } from "child_process";

const pairs = [
  [8081, "Metro (Granite)"],
  [5174, "apps/toss Vite (granite.config web.port)"],
  [3000, "API + 웹 통합 서버 (dev:server, 선택)"],
];

function run(args) {
  const r = spawnSync("adb", args, { stdio: "inherit" });
  if (r.error) {
    console.error(
      "\nadb 실행 실패. Android Studio → SDK → platform-tools 를 PATH에 넣거나,\n" +
        "USB 디버깅이 켜진 기기가 연결됐는지 확인하세요.\n",
      r.error.message
    );
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("Setting adb reverse (device localhost → PC)…\n");
for (const [port, label] of pairs) {
  console.log(`  tcp:${port}  ← ${label}`);
  run(["reverse", `tcp:${port}`, `tcp:${port}`]);
}
console.log("\nDone. 확인: adb reverse --list");
