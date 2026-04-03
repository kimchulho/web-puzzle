import { TossAds } from "@apps-in-toss/web-framework";
import { useEffect, useRef, useState } from "react";

/** 앱인토스 콘솔 테스트용 리스트형 배너 ID @see https://developers-apps-in-toss.toss.im/ads/develop.html */
export const TOSS_LOBBY_TEST_BANNER_AD_GROUP_ID = "ait-ad-test-banner-id";

type InitState = "idle" | "pending" | "ok" | "fail";
let tossAdsInitState: InitState = "idle";
const tossAdsInitWaiters: Array<(ok: boolean) => void> = [];

function ensureTossAdsInitialized(): Promise<boolean> {
  if (!TossAds.initialize.isSupported()) return Promise.resolve(false);
  if (tossAdsInitState === "ok") return Promise.resolve(true);
  if (tossAdsInitState === "fail") return Promise.resolve(false);
  return new Promise((resolve) => {
    tossAdsInitWaiters.push(resolve);
    if (tossAdsInitState === "idle") {
      tossAdsInitState = "pending";
      TossAds.initialize({
        callbacks: {
          onInitialized: () => {
            tossAdsInitState = "ok";
            tossAdsInitWaiters.splice(0).forEach((r) => r(true));
          },
          onInitializationFailed: () => {
            tossAdsInitState = "fail";
            tossAdsInitWaiters.splice(0).forEach((r) => r(false));
          },
        },
      });
    }
  });
}

/** 배너 슬롯 높이 + (추가 상하 패딩 없음) — 로비 스크롤 하단 여백 계산용 */
export const TOSS_LOBBY_BANNER_SLOT_H = 96;
export const TOSS_LOBBY_BANNER_VERTICAL_PAD = 0;

/**
 * 토스 로비 하단 고정형 배너(리스트형 96px 권장).
 * 화면 하단에 항상 표시(`fixed`)되어 긴 목록을 스크롤해도 사라지지 않아요.
 * 게임형: 홈 인디케이터 위 최소 여백 4px — @see https://developers-apps-in-toss.toss.im/ads/develop.html
 */
export function TossLobbyBottomBanner({
  safeAreaBottom,
  safeAreaLeft = 0,
  safeAreaRight = 0,
}: {
  safeAreaBottom: number;
  safeAreaLeft?: number;
  safeAreaRight?: number;
}) {
  const supported =
    typeof window !== "undefined" &&
    TossAds.initialize.isSupported() &&
    TossAds.attachBanner.isSupported();
  const containerRef = useRef<HTMLDivElement>(null);
  const [adsReady, setAdsReady] = useState(false);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void ensureTossAdsInitialized().then((ok) => {
      if (!cancelled && ok) setAdsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !adsReady || !containerRef.current) return;

    const el = containerRef.current;
    const attached = TossAds.attachBanner(TOSS_LOBBY_TEST_BANNER_AD_GROUP_ID, el, {
      theme: "auto",
      tone: "blackAndWhite",
      variant: "expanded",
    });

    return () => {
      attached.destroy();
    };
  }, [supported, adsReady]);

  if (!supported) return null;

  return (
    <div
      className="pointer-events-auto fixed bottom-0 left-0 right-0 z-40 w-full border-t border-[#D9E8FF] bg-[#F4F8FF] shadow-[0_-4px_24px_rgba(47,111,228,0.08)]"
      style={{
        paddingTop: 0,
        paddingBottom: safeAreaBottom,
        paddingLeft: safeAreaLeft,
        paddingRight: safeAreaRight,
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: TOSS_LOBBY_BANNER_SLOT_H }} />
    </div>
  );
}
