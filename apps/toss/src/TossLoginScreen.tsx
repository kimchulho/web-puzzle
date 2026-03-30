import type { AuthUser } from "@contracts/auth";
import { appLogin } from "@apps-in-toss/web-framework";
import {
  BottomSheet,
  Button,
  Modal,
  Text,
  TextButton,
  TextField,
} from "@toss/tds-mobile";
import { useCallback, useState } from "react";
import { getApiBase } from "./lib/apiBase";
import {
  clearSession,
  fetchAuthMe,
  loadStoredSession,
  persistSession,
  postTossLogin,
} from "./lib/tossSession";

export default function TossLoginScreen({
  onAuthed,
  onCancel,
}: {
  onAuthed: (user: AuthUser) => void;
  /** 로비 등에서 열었을 때 비회원으로 돌아가기 */
  onCancel?: () => void;
}) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [devReferrer, setDevReferrer] = useState("sandbox");
  const [devSheetOpen, setDevSheetOpen] = useState(false);

  const finishLogin = useCallback(
    async (body: { authorizationCode: string; referrer: string }) => {
      setError("");
      setLoading(true);
      try {
        const auth = await postTossLogin(body);
        persistSession(auth);
        setDevSheetOpen(false);
        onAuthed(auth.user);
      } catch (e) {
        setError(e instanceof Error ? e.message : "로그인에 실패했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [onAuthed]
  );

  const handleAppLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const { authorizationCode, referrer } = await appLogin();
      await finishLogin({ authorizationCode, referrer });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "appLogin을 사용할 수 없습니다. 앱인토스 WebView에서 실행하거나 개발자 시트를 사용하세요."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDevSubmit = () => {
    const code = devCode.trim();
    if (!code) {
      setError("authorizationCode를 입력하세요.");
      return;
    }
    void finishLogin({ authorizationCode: code, referrer: devReferrer.trim() });
  };

  const handleLogout = () => {
    clearSession();
    setError("");
  };

  const handleRefreshMe = async () => {
    const s = loadStoredSession();
    if (!s) return;
    setError("");
    setLoading(true);
    try {
      const me = await fetchAuthMe(s.token);
      localStorage.setItem("puzzle_user", JSON.stringify(me.user));
      onAuthed(me.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "갱신 실패");
    } finally {
      setLoading(false);
    }
  };

  const s = loadStoredSession();

  return (
    <div style={{ padding: "24px 20px", maxWidth: 560, margin: "0 auto" }}>
      {onCancel ? (
        <div style={{ marginBottom: 16 }}>
          <TextButton type="button" size="medium" variant="underline" onClick={onCancel}>
            ← 게임으로 돌아가기 (비회원)
          </TextButton>
        </div>
      ) : null}
      <Text display="block" typography="t3" fontWeight="bold" color="adaptive.grey900">
        퍼즐 (Apps in Toss)
      </Text>
      {onCancel ? (
        <Text
          display="block"
          typography="t6"
          color="adaptive.grey600"
          style={{ marginTop: 8, marginBottom: 12 }}
        >
          전적 연동·계정 저장이 필요할 때만 로그인하면 됩니다. 비회원은 로비에서 그대로 플레이할 수 있습니다.
        </Text>
      ) : null}
      {import.meta.env.DEV ? (
        <Text
          display="block"
          typography="t7"
          color="adaptive.grey600"
          style={{ marginTop: onCancel ? 0 : 8, marginBottom: 24 }}
        >
          로컬: npm run dev:server 후 npm run dev:toss. AIT 빌드 전 루트 .env에 VITE_API_BASE_URL(Render URL)을 넣으세요.
        </Text>
      ) : (
        <div style={{ marginBottom: 24 }} />
      )}
      {import.meta.env.PROD && !getApiBase() ? (
        <Text
          display="block"
          typography="t6"
          color="adaptive.red500"
          fontWeight="semibold"
          style={{ marginTop: -16, marginBottom: 24 }}
        >
          오류: 이 번들에 API 주소가 없습니다. 루트 .env에 VITE_API_BASE_URL을 넣고 ait 빌드를 다시 하세요.
        </Text>
      ) : null}

      {s ? (
        <section style={{ marginBottom: 16 }}>
          <Text display="block" typography="t5" fontWeight="semibold" style={{ marginBottom: 8 }}>
            저장된 세션
          </Text>
          <Text display="block" typography="t6" color="adaptive.grey700">
            {s.user.username} · id {s.user.id}
          </Text>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <Button
              color="primary"
              variant="fill"
              display="full"
              size="large"
              loading={loading}
              onClick={() => onAuthed(s.user)}
            >
              게임 입장
            </Button>
            <Button
              color="dark"
              variant="weak"
              display="full"
              size="medium"
              loading={loading}
              onClick={handleRefreshMe}
            >
              /api/auth/me 갱신
            </Button>
            <Button color="dark" variant="weak" display="full" size="medium" onClick={handleLogout}>
              세션 삭제
            </Button>
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: 16 }}>
        <Text display="block" typography="t5" fontWeight="semibold" style={{ marginBottom: 8 }}>
          토스 로그인
        </Text>
        <Text display="block" typography="t7" color="adaptive.grey600" style={{ marginBottom: 12 }}>
          appLogin()으로 인가 코드를 받은 뒤 서버에 전달합니다.
        </Text>
        <Button
          color="primary"
          variant="fill"
          display="full"
          size="large"
          loading={loading}
          onClick={handleAppLogin}
        >
          토스로 로그인
        </Button>
      </section>

      <TextButton type="button" size="medium" variant="underline" onClick={() => setDevSheetOpen(true)}>
        개발자 수동 입력 (인가 코드)
      </TextButton>

      <BottomSheet
        open={devSheetOpen}
        onClose={() => setDevSheetOpen(false)}
        hasTextField
        header={<BottomSheet.Header>개발자 수동 입력</BottomSheet.Header>}
        headerDescription={
          <BottomSheet.HeaderDescription>
            샌드박스에서 받은 authorizationCode와 referrer(sandbox, DEFAULT 등)로 교환을 테스트합니다.
          </BottomSheet.HeaderDescription>
        }
        cta={
          <BottomSheet.CTA loading={loading} onClick={handleDevSubmit}>
            서버로 로그인
          </BottomSheet.CTA>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" }}>
          <TextField
            variant="box"
            label="authorizationCode"
            labelOption="sustain"
            value={devCode}
            onChange={(e) => setDevCode(e.target.value)}
            placeholder="인가 코드"
            autoComplete="off"
          />
          <TextField
            variant="box"
            label="referrer"
            labelOption="sustain"
            value={devReferrer}
            onChange={(e) => setDevReferrer(e.target.value)}
            placeholder="sandbox 또는 DEFAULT"
          />
        </div>
      </BottomSheet>

      <Modal open={Boolean(error)} onOpenChange={(open) => !open && setError("")}>
        <Modal.Overlay />
        <Modal.Content title="알림" onClick={() => setError("")}>
          <Text display="block" typography="t6" color="adaptive.grey800">
            {error}
          </Text>
          <div style={{ marginTop: 20 }}>
            <Button color="primary" variant="fill" display="full" size="large" onClick={() => setError("")}>
              확인
            </Button>
          </div>
        </Modal.Content>
      </Modal>
    </div>
  );
}
