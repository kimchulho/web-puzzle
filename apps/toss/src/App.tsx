import { useEffect, useState } from "react";
import type { AuthUser } from "@contracts/auth";
import GameShell from "./GameShell";
import TossLoginScreen from "./TossLoginScreen";
import { loadStoredSession } from "./lib/tossSession";
import { useTossSafeAreaInsets } from "./useTossSafeAreaInsets";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [showTossLogin, setShowTossLogin] = useState(false);
  const tossSafe = useTossSafeAreaInsets();

  useEffect(() => {
    const s = loadStoredSession();
    if (s) setUser(s.user);
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div
        className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white text-lg box-border"
        style={{
          paddingTop: tossSafe.top,
          paddingLeft: tossSafe.left,
          paddingRight: tossSafe.right,
          paddingBottom: tossSafe.bottom,
        }}
      >
        …
      </div>
    );
  }

  if (showTossLogin) {
    return (
      <TossLoginScreen
        onAuthed={(u) => {
          setUser(u);
          setShowTossLogin(false);
        }}
        onCancel={() => setShowTossLogin(false)}
      />
    );
  }

  return (
    <GameShell
      user={user}
      setUser={setUser}
      onLoggedOut={() => setUser(null)}
      onRequestTossLogin={() => setShowTossLogin(true)}
    />
  );
}
