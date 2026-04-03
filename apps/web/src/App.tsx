/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import PuzzleBoard from './components/PuzzleBoard';
import Lobby from './components/Lobby';
import Auth from './components/Auth';
import Admin from './components/Admin';
import TermsOfService from './components/TermsOfService';
import { supabase } from './lib/supabaseClient';
import { encodeRoomId, decodeRoomId } from './lib/roomCode';

function readStoredPuzzleUser(): unknown | null {
  try {
    const raw = localStorage.getItem('puzzle_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem('puzzle_user');
    return null;
  }
}

export default function App() {
  const [locale, setLocale] = useState<'ko' | 'en'>(() => {
    const saved = localStorage.getItem('webpuzzle_locale');
    if (saved === 'ko' || saved === 'en') return saved;
    return 'ko';
  });
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [currentRoom, setCurrentRoom] = useState<{id: number, imageUrl: string, pieceCount: number} | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(() => readStoredPuzzleUser());
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const navigateToPath = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    
    if (roomParam) {
      const isNumeric = /^\d+$/.test(roomParam);
      const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);

      if (decodedId) {
        supabase.from('pixi_rooms').select('*').eq('id', decodedId).single().then(({ data, error }) => {
          if (data && !error) {
            setCurrentRoom({ id: data.id, imageUrl: data.image_url, pieceCount: data.piece_count });
          } else {
            window.history.replaceState({}, '', '/');
          }
          setLoading(false);
        });
      } else {
        window.history.replaceState({}, '', '/');
        setLoading(false);
      }
    } else {
      setLoading(false);
    }

    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (!roomParam) {
        setCurrentRoom(null);
      } else {
        const isNumeric = /^\d+$/.test(roomParam);
        const decodedId = isNumeric ? parseInt(roomParam, 10) : decodeRoomId(roomParam);
        if (decodedId) {
          supabase.from('pixi_rooms').select('*').eq('id', decodedId).single().then(({ data, error }) => {
            if (data && !error) {
              setCurrentRoom({ id: data.id, imageUrl: data.image_url, pieceCount: data.piece_count });
            }
          });
        }
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleJoinRoom = (roomId: number, imageUrl: string, pieceCount: number) => {
    const roomCode = encodeRoomId(roomId);
    window.history.pushState({}, '', `/?room=${roomCode}`);
    // SPA 전환 시 모바일 브라우저 주소줄/스크롤 상태를 초기화해
    // 퍼즐 상단 툴바 safe-area 계산이 안정적으로 잡히게 한다.
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
    setCurrentRoom({ id: roomId, imageUrl, pieceCount });
  };

  const handleLeaveRoom = () => {
    window.history.pushState({}, '', '/');
    setCurrentRoom(null);
  };

  const handleLogout = () => {
    localStorage.removeItem('puzzle_user');
    setUser(null);
    setShowAdmin(false);
  };

  const toggleLocale = () => {
    setLocale((prev) => {
      const next = prev === 'ko' ? 'en' : 'ko';
      localStorage.setItem('webpuzzle_locale', next);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="h-[100dvh] min-h-screen w-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="text-2xl font-bold animate-pulse">Loading...</div>
      </div>
    );
  }

  if (pathname === '/terms') {
    return <TermsOfService onBack={() => navigateToPath('/')} />;
  }

  if (showAuth) {
    return (
      <Auth
        onLogin={(u) => { setUser(u); setShowAuth(false); }}
        onClose={() => setShowAuth(false)}
        onOpenTerms={() => {
          navigateToPath('/terms');
          setShowAuth(false);
        }}
      />
    );
  }

  if (showAdmin && user?.role === 'admin') {
    return <Admin onBack={() => setShowAdmin(false)} />;
  }

  if (currentRoom) {
    return (
      <div className="h-[100dvh] min-h-screen w-screen overflow-hidden bg-slate-900 relative">
        <PuzzleBoard 
          roomId={currentRoom.id} 
          imageUrl={currentRoom.imageUrl} 
          pieceCount={currentRoom.pieceCount} 
          onBack={handleLeaveRoom}
          user={user}
          setUser={setUser}
          locale={locale}
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
      onLoginClick={() => setShowAuth(true)}
      onOpenTerms={() => navigateToPath('/terms')}
      locale={locale}
      onToggleLocale={toggleLocale}
    />
  );
}
