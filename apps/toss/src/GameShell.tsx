import { useEffect, useState } from "react";
import type { AuthUser } from "@contracts/auth";
import Admin from "@web/components/Admin";
import Lobby from "@web/components/Lobby";
import PuzzleBoard from "@web/components/PuzzleBoard";
import TermsOfService from "@web/components/TermsOfService";
import { decodeRoomId, encodeRoomId } from "@web/lib/roomCode";
import { supabase } from "@web/lib/supabaseClient";
import { clearSession } from "./lib/tossSession";

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

  if (loading) {
    return (
      <div className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-2xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  if (pathname === "/terms") {
    return <TermsOfService onBack={() => navigateToPath("/")} />;
  }

  if (showAdmin && user?.role === "admin") {
    return <Admin onBack={() => setShowAdmin(false)} />;
  }

  if (currentRoom) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-slate-900 relative">
        <PuzzleBoard
          roomId={currentRoom.id}
          imageUrl={currentRoom.imageUrl}
          pieceCount={currentRoom.pieceCount}
          onBack={handleLeaveRoom}
          user={user}
          setUser={setUser as (u: unknown) => void}
        />
      </div>
    );
  }

  return (
    <Lobby
      onJoinRoom={handleJoinRoom}
      user={user}
      onLogout={handleLogout}
      onAdmin={() => setShowAdmin(true)}
      onLoginClick={onRequestTossLogin}
      onOpenTerms={() => {
        navigateToPath("/terms");
      }}
    />
  );
}
