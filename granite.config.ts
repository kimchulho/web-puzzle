import { defineConfig } from "@apps-in-toss/web-framework/config";

/**
 * 앱인토스 WebView — `npx ait build` / `npx ait deploy` 가 이 파일을 사용합니다.
 *
 * - appName: 콘솔에 만든 미니앱 ID와 반드시 동일 (intoss://{appName} 검증·업로드에 사용).
 * - outdir: `web.commands.build` 결과물 경로와 일치해야 합니다 (기본: apps/toss/dist).
 * - 로컬 샌드박스: `npm run dev:granite` (+ API 필요 시 `npm run dev:server`).
 * - Android 실기기(USB): `npm run android:reverse` 후 샌드박스에서 `intoss://web-puzzle`.
 *   (8081=Metro·5174=Vite·3000=API 가 PC로 붙음.) Wi‑Fi만 쓸 땐 web.host 를 PC LAN IP 로.
 *
 * web.host / web.port 는 API(백엔드) 주소가 아닙니다.
 * Vite 개발 서버(미니앱 HTML/JS를 여는 주소)용이에요. Render 등 백엔드 URL은
 * 빌드 전 환경변수 VITE_API_BASE_URL · VITE_BACKEND_URL 로 넣습니다.
 *
 * @see https://developers-apps-in-toss.toss.im/tutorials/webview.html
 */
export default defineConfig({
  appName: "web-puzzle",
  brand: {
    displayName: "웹퍼즐",
    primaryColor: "#3182F6",
    icon: "",
  },
  web: {
    /** 로컬 granite dev 전용. 휴대폰 샌드박스에서 붙이려면 예: 192.168.x.x */
    host: "localhost",
    port: 5174,
    commands: {
      dev: "vite --config apps/toss/vite.config.ts --host",
      build: "vite build --config apps/toss/vite.config.ts",
    },
  },
  webViewProps: {
    type: "game",
  },
  outdir: "apps/toss/dist",
  permissions: [],
});
