import { SafeAreaInsets } from "@apps-in-toss/web-framework";
import { useEffect, useMemo, useState } from "react";

export type TossSafeArea = { top: number; right: number; bottom: number; left: number };

/**
 * 시스템 상태바·노치 등에 맞춘 인셋 (네비 pill 예약은 포함하지 않음).
 */
export function useTossSafeAreaInsets(): TossSafeArea {
  const [raw, setRaw] = useState<TossSafeArea>(() => {
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
      right: raw.right,
      bottom: raw.bottom,
      left: raw.left,
    }),
    [raw.bottom, raw.left, raw.right, raw.top],
  );
}
