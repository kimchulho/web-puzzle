import { defineConfig } from "@apps-in-toss/web-framework/config";
import {
  TOSS_APP_DISPLAY_NAME,
  TOSS_BRAND_ICON_URL,
  TOSS_LEADERBOARD_NAV_ACCESSORY_ICON,
  TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
} from "./apps/toss/src/tossNavAccessory";

/**
 * 앱인토스 WebView — `npm run ait:build`(`dist` 선삭제 후 `npx ait build`) / `npx ait deploy` 가 이 파일을 사용합니다.
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
 * @see https://developers-apps-in-toss.toss.im/bedrock/reference/framework/UI/NavigationBar.html
 * @see https://developers-apps-in-toss.toss.im/bedrock/reference/framework/UI/Config.html
 */
export default defineConfig({
  appName: "web-puzzle",
  brand: {
    displayName: TOSS_APP_DISPLAY_NAME,
    primaryColor: "#3182F6",
    icon: TOSS_BRAND_ICON_URL,
  },
  web: {
    /** 로컬 granite dev 전용. 휴대폰 샌드박스에서 붙이려면 예: 192.168.x.x
     *  원격(cloudflare tunnel) 사용 시: host = "abc-def-123.trycloudflare.com", port = 443
     */
    host: "learn-peninsula-searching-conditioning.trycloudflare.com",
    port: 443,
    commands: {
      dev: "vite --config apps/toss/vite.config.ts --host",
      build: "vite build --config apps/toss/vite.config.ts",
    },
  },
  /** 비게임(partner): 흰색 내비게이션 바·로고·이름 표시 (@see 공통 설정) */
  webViewProps: {
    type: "partner",
  },
  /**
   * 비게임: `withHomeButton`으로 첫 화면 복귀.
   * 액세서리(더보기 왼쪽)는 모노톤 아이콘 1개만.
   */
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
    initialAccessoryButton: {
      id: TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
      title: "로그인",
      icon: { name: TOSS_LEADERBOARD_NAV_ACCESSORY_ICON },
    },
  },
  outdir: "apps/toss/dist",
  permissions: [],
});
