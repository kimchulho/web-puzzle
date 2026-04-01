import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const zOverlay = 300;

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: zOverlay,
  backgroundColor: "rgba(0, 0, 0, 0.52)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  boxSizing: "border-box",
};

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 340,
  borderRadius: 20,
  backgroundColor: "#ffffff",
  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.16)",
  padding: "22px 20px 18px",
  boxSizing: "border-box",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1.35,
  color: "#191f28",
  letterSpacing: "-0.02em",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  gap: 8,
  marginTop: 20,
};

const btnBase: CSSProperties = {
  flex: 1,
  border: "none",
  cursor: "pointer",
  padding: "14px 12px",
  fontSize: 15,
  fontWeight: 600,
  borderRadius: 14,
  minHeight: 48,
};

const btnSecondary: CSSProperties = {
  ...btnBase,
  backgroundColor: "#f2f4f6",
  color: "#333d4b",
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  backgroundColor: "#3182f6",
  color: "#ffffff",
};

/**
 * TDS ConfirmDialog 가 WebView+Tailwind 환경에서 카드/딤/버튼 라운드가 빠지는 경우가 있어,
 * 토스 확인 모달과 유사한 형태를 인라인 스타일로 고정합니다.
 */
export function LeavePuzzleConfirmDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={backdropStyle} role="presentation" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-puzzle-confirm-title"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="leave-puzzle-confirm-title" style={titleStyle}>
          로비로 나가시겠어요?
        </h2>
        <div style={rowStyle}>
          <button type="button" style={btnSecondary} onClick={onCancel}>
            안 나가기
          </button>
          <button type="button" style={btnPrimary} onClick={onConfirm}>
            나가기
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
