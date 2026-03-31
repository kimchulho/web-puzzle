import { partner, setDeviceOrientation, tdsEvent } from "@apps-in-toss/web-framework";
import { useEffect, useRef, useState } from "react";
import { Button, Modal, Text } from "@toss/tds-mobile";
import type { AuthUser } from "@contracts/auth";
import Admin from "@web/components/Admin";
import Lobby from "@web/components/Lobby";
import PuzzleBoard from "@web/components/PuzzleBoard";
import TermsOfService from "@web/components/TermsOfService";
import { decodeRoomId, encodeRoomId } from "@web/lib/roomCode";
import { supabase } from "@web/lib/supabaseClient";
import { clearSession } from "./lib/tossSession";
import {
  TOSS_APP_DISPLAY_NAME,
  TOSS_BRAND_ICON_URL,
  TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
} from "./tossNavAccessory";
import { useTossHostChromePadding } from "./useTossHostChromePadding";
import { useTossSafeAreaInsets } from "./useTossSafeAreaInsets";

export default function GameShell({
  user,
  setUser,
  onLoggedOut,
  onRequestTossLogin,
}: {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  onLoggedOut: () => void;
  onRequestTossLogin: () => void;
}) {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [currentRoom, setCurrentRoom] = useState<{
    id: number;
    imageUrl: string;
    pieceCount: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  const tossHostPadding = useTossHostChromePadding();
  const tossSafeArea = useTossSafeAreaInsets();

  const [showNavLoginModal, setShowNavLoginModal] = useState(false);

  /** 퍼즐방 회전 버튼: WebView 에서는 HTML Fullscreen + orientation.lock 이 막히는 경우가 많아 네이티브 API 사용 */
  const tossOrientationRef = useRef<"portrait" | "landscape">("portrait");

  const handleTossToggleOrientation = async () => {
    const next = tossOrientationRef.current === "portrait" ? "landscape" : "portrait";
    try {
      await setDeviceOrientation({ type: next });
      tossOrientationRef.current = next;
    } catch (e) {
      console.warn("[toss] setDeviceOrientation failed", e);
    }
  };

  useEffect(() => {
    if (!currentRoom) return;
    return () => {
      tossOrientationRef.current = "portrait";
      void setDeviceOrientation({ type: "portrait" }).catch(() => {});
    };
  }, [currentRoom]);

  /** 로비·약관·관리자: 항상 세로 모드 (퍼즐방만 가로 전환 허용) */
  useEffect(() => {
    if (currentRoom) return;
    tossOrientationRef.current = "portrait";
    void setDeviceOrientation({ type: "portrait" }).catch(() => {});
  }, [currentRoom, pathname, showAdmin]);

  useEffect(() => {
    const cleanup = tdsEvent.addEventListener("navigationAccessoryEvent", {
      onEvent: ({ id }) => {
        if (id === TOSS_LEADERBOARD_NAV_ACCESSORY_ID) setShowNavLoginModal(true);
      },
    });
    return cleanup;
  }, []);

  useEffect(() => {
    // defineConfig 반영이 늦거나 누락되는 경우를 대비해 런타임에서도 액세서리 버튼을 보장합니다.
    void partner
      .addAccessoryButton({
        id: TOSS_LEADERBOARD_NAV_ACCESSORY_ID,
        title: "로그인",
        icon: { name: "icon-heart-mono" },
      })
      .catch(() => {});
    return () => {
      void partner.removeAccessoryButton().catch(() => {});
    };
  }, []);

  const navigateToPath = (path: string) => {
    window.history.pushState({}, "", path);
    setPathname(path);
  };

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");

    if (roomParam) {
      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (decodedId) {
        supabase
          .from("pixi_rooms")
          .select("*")
          .eq("id", decodedId)
          .single()
          .then(({ data, error }) => {
            if (data && !error) {
              setCurrentRoom({
                id: data.id,
                imageUrl: data.image_url,
                pieceCount: data.piece_count,
              });
            } else {
              window.history.replaceState({}, "", "/");
            }
            setLoading(false);
          });
      } else {
        window.history.replaceState({}, "", "/");
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search);
      const rp = p.get("room");
      if (!rp) {
        setCurrentRoom(null);
      } else {
        const isNumeric = /^\d+$/.test(rp);
        const decodedId = isNumeric ? parseInt(rp, 10) : decodeRoomId(rp);
        if (decodedId) {
          supabase
            .from("pixi_rooms")
            .select("*")
            .eq("id", decodedId)
            .single()
            .then(({ data, error }) => {
              if (data && !error) {
                setCurrentRoom({
                  id: data.id,
                  imageUrl: data.image_url,
                  pieceCount: data.piece_count,
                });
              }
            });
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleJoinRoom = (roomId: number, imageUrl: string, pieceCount: number) => {
    const roomCode = encodeRoomId(roomId);
    window.history.pushState({}, "", `/?room=${roomCode}`);
    setCurrentRoom({ id: roomId, imageUrl, pieceCount });
  };

  const handleLeaveRoom = () => {
    window.history.pushState({}, "", "/");
    setCurrentRoom(null);
  };

  const handleLogout = () => {
    clearSession();
    setShowAdmin(false);
    onLoggedOut();
  };

  const navLoginModal = (
    <Modal open={showNavLoginModal} onOpenChange={setShowNavLoginModal}>
      <Modal.Overlay />
      <Modal.Content title="로그인" onClick={() => setShowNavLoginModal(false)}>
        <Text display="block" typography="t6" color="adaptive.grey800">
          로그인하면 전적과 기록을 안전하게 저장할 수 있어요.
        </Text>
        <div style={{ marginTop: 20 }}>
          <Button
            color="primary"
            variant="fill"
            display="full"
            size="large"
            onClick={() => {
              setShowNavLoginModal(false);
              onRequestTossLogin();
            }}
          >
            로그인
          </Button>
        </div>
      </Modal.Content>
    </Modal>
  );

  if (loading) {
    return (
      <>
        <div
          className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white box-border"
          style={{
            paddingTop: tossSafeArea.top,
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <div className="text-2xl font-bold animate-pulse">Loading...</div>
        </div>
        {navLoginModal}
      </>
    );
  }

  if (pathname === "/terms") {
    return (
      <>
        <div
          className="min-h-screen box-border bg-slate-950"
          style={{
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <TermsOfService safeAreaTop={tossSafeArea.top} onBack={() => navigateToPath("/")} />
        </div>
        {navLoginModal}
      </>
    );
  }

  if (showAdmin && user?.role === "admin") {
    return (
      <>
        <div
          className="min-h-screen box-border bg-slate-950"
          style={{
            paddingTop: tossSafeArea.top,
            paddingLeft: tossSafeArea.left,
            paddingRight: tossSafeArea.right,
            paddingBottom: tossSafeArea.bottom,
          }}
        >
          <Admin onBack={() => setShowAdmin(false)} />
        </div>
        {navLoginModal}
      </>
    );
  }

  if (currentRoom) {
    return (
      <>
        <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
          <PuzzleBoard
            roomId={currentRoom.id}
            imageUrl={currentRoom.imageUrl}
            pieceCount={currentRoom.pieceCount}
            onBack={handleLeaveRoom}
            user={user}
            setUser={setUser as (u: unknown) => void}
            onToggleOrientation={handleTossToggleOrientation}
            hostWebViewPadding={tossHostPadding}
          />
        </div>
        {navLoginModal}
      </>
    );
  }

  return (
    <>
      <Lobby
        onJoinRoom={handleJoinRoom}
        user={user}
        onLogout={handleLogout}
        onAdmin={() => setShowAdmin(true)}
        onLoginClick={onRequestTossLogin}
        onOpenTerms={() => {
          navigateToPath("/terms");
        }}
        tossUi={{
          safeArea: tossSafeArea,
          brandTitle: TOSS_APP_DISPLAY_NAME,
          brandIconUrl: TOSS_BRAND_ICON_URL,
        }}
      />
      {navLoginModal}
    </>
  );
}
