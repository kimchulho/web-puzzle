import { SafeAreaInsets } from "@apps-in-toss/web-framework";
import { useEffect, useMemo, useState } from "react";

/** 우측 상단 … / 닫기 네이티브 pill 이 차지하는 대략적인 폭 (기기·SDK에 따라 약간 달라질 수 있음) */
const TOSS_WEBVIEW_NAV_PILL_RESERVE_PX = 40;

export type HostWebViewPadding = { top: number; right: number; left: number };

/**
 * 퍼즐 상단바가 시스템 상태바·토스 미니앱 오버레이와 겹치지 않도록 여백을 만듭니다.
 * @see https://developers-apps-in-toss.toss.im/bedrock/reference/framework/화면
 */
export function useTossHostChromePadding(): HostWebViewPadding {
  const [raw, setRaw] = useState(() => {
    try {
      return SafeAreaInsets.get();
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  });

  useEffect(() => {
    try {
      const off = SafeAreaInsets.subscribe({
        onEvent: (next) => setRaw(next),
      });
      return () => off();
    } catch {
      return;
    }
  }, []);

  return useMemo(
    () => ({
      top: raw.top,
      right: raw.right + TOSS_WEBVIEW_NAV_PILL_RESERVE_PX,
      left: raw.left,
    }),
    [raw.left, raw.right, raw.top],
  );
}
