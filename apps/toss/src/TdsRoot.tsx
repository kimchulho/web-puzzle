import { TDSMobileProvider, type ColorPreference } from "@toss/tds-mobile";
import { useMemo, type ReactNode } from "react";

function getUserAgent(): {
  fontA11y: undefined;
  fontScale: number;
  isAndroid: boolean;
  isIOS: boolean;
  colorPreference: ColorPreference;
} {
  if (typeof window === "undefined") {
    return {
      fontA11y: undefined,
      fontScale: 1,
      isAndroid: false,
      isIOS: true,
      colorPreference: "light",
    };
  }
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  return {
    fontA11y: undefined,
    fontScale: 1,
    isAndroid,
    /** 데스크톱 브라우저는 iOS 쪽 변수로 폴백 (TDS 로컬 프리뷰용) */
    isIOS: isIOS || !isAndroid,
    /** 앱인토스 WebView는 라이트 모드만 지원 */
    colorPreference: "light",
  };
}

/**
 * 앱인토스 WebView TDS 루트.
 * @see https://developers-apps-in-toss.toss.im/tutorials/webview.html
 */
export function TdsRoot({ children }: { children: ReactNode }) {
  const userAgent = useMemo(() => getUserAgent(), []);
  return (
    <TDSMobileProvider userAgent={userAgent} resetGlobalCss={false}>
      {children}
    </TDSMobileProvider>
  );
}
