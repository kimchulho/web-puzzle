import React, { useState, useEffect } from 'react';
import { Trophy, Grid3X3, RefreshCw, Users, Lock, Image as ImageIcon, Play, Plus, Grid, Clock, RotateCcw, Maximize, Minimize, LogOut, ShieldAlert, LogIn, ChevronDown, Languages } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { motion } from 'motion/react';
import { encodeRoomId } from '../lib/roomCode';
import { ImageSelectorModal } from './ImageSelectorModal';

const formatPlayTime = (seconds: number) => {
  if (!seconds) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const isBotLikeUser = (name: unknown) =>
  typeof name === 'string' && /(bot|봇)/i.test(name.trim());

export type TossLobbyUi = {
  safeArea: { top: number; left: number; right: number; bottom: number };
  brandTitle: string;
  brandIconUrl: string;
};

const Lobby = ({
  onJoinRoom,
  user,
  onLogout,
  onAdmin,
  onLoginClick,
  onOpenTerms,
  tossUi,
  locale = 'ko',
  onToggleLocale,
}: {
  onJoinRoom: (roomId: number, imageUrl: string, pieceCount: number) => void;
  user?: any;
  onLogout: () => void;
  onAdmin: () => void;
  onLoginClick: () => void;
  onOpenTerms?: () => void;
  /** 앱인토스: 상태바 인셋 + TDS 상단(내비 영역) */
  tossUi?: TossLobbyUi;
  locale?: 'ko' | 'en';
  onToggleLocale?: () => void;
}) => {
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [completedRooms, setCompletedRooms] = useState<any[]>([]);
  const [isRoomsLoading, setIsRoomsLoading] = useState(true);
  const [pieceCount, setPieceCount] = useState(100);
  const [imageUrl, setImageUrl] = useState('https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg');
  const [imageSource, setImageSource] = useState<'public' | 'custom'>('public');
  const [publicImages, setPublicImages] = useState<any[]>([]);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showRoomFullModal, setShowRoomFullModal] = useState(false);
  const [roomFullInfo, setRoomFullInfo] = useState<{ roomCode: string; current: number; max: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(!!document.fullscreenElement);
  const isKo = locale === 'ko';

  useEffect(() => {
    const fetchPublicImages = async () => {
      const { data } = await supabase.from('puzzle_images').select('*').eq('is_public', true);
      if (data) setPublicImages(data);
    };
    fetchPublicImages();
  }, []);


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `private/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('puzzle_images')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading image:', uploadError);
      return;
    }

    const { data } = supabase.storage.from('puzzle_images').getPublicUrl(filePath);
    console.log('Uploaded image URL:', data.publicUrl);
    setImageUrl(data.publicUrl);
    setImageSource('custom');
  };

  const handleAdminUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `public/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('puzzle_images')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Error uploading admin image:', uploadError);
      return;
    }

    const { data } = supabase.storage.from('puzzle_images').getPublicUrl(filePath);
    await supabase.from('puzzle_images').insert([
        { url: data.publicUrl, is_public: true, created_by: user.id }
    ]);
    alert('Admin image uploaded and set to public.');
  };
  const [maxPlayers, setMaxPlayers] = useState<number>(8);
  const [password, setPassword] = useState<string>('');
  const [isCreating, setIsCreating] = useState(false);
  const [guestName, setGuestName] = useState(() => {
    return localStorage.getItem('puzzle_guest_name') || `익명#${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  });

  useEffect(() => {
    if (!user) {
      localStorage.setItem('puzzle_guest_name', guestName);
    }
  }, [guestName, user]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!tossUi) return;

    // iOS WebView pinch zoom/gesture 확대 방지
    const preventGesture = (e: Event) => e.preventDefault();
    // 트랙패드 ctrl+wheel 확대 방지
    const preventCtrlZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };

    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });
    document.addEventListener('wheel', preventCtrlZoom, { passive: false });
    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      document.removeEventListener('wheel', preventCtrlZoom);
    };
  }, [tossUi]);

  const toggleOrientation = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      
      if (window.screen && window.screen.orientation && (window.screen.orientation as any).lock) {
        const currentType = window.screen.orientation.type;
        if (currentType.startsWith('portrait')) {
          await (window.screen.orientation as any).lock('landscape');
        } else {
          await (window.screen.orientation as any).lock('portrait');
        }
      } else {
        console.warn("Screen orientation lock is not supported on this device/browser.");
      }
    } catch (err) {
      console.error("Error attempting to lock orientation:", err);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  };

  const fetchRooms = async () => {
    setIsRoomsLoading(true);
    try {
      const { data: active } = await supabase
        .from('pixi_rooms')
        .select('*')
        .eq('status', 'active')
        .eq('is_private', false)
        .order('created_at', { ascending: false });
      
      const { data: completed } = await supabase
        .from('pixi_rooms')
        .select('*')
        .eq('status', 'completed')
        .eq('is_private', false)
        .order('created_at', { ascending: false });

      if (active && active.length > 0) {
        await Promise.all(active.map(async (room) => {
          const { count: total } = await supabase
            .from('pixi_pieces')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id);
            
          const { count: locked } = await supabase
            .from('pixi_pieces')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.id)
            .eq('is_locked', true);
            
          room.totalPieces = total || room.piece_count;
          room.snappedCount = locked || 0;
          
          if (total === locked && total > 0 && room.status === 'active') {
            const { error } = await supabase
              .from('pixi_rooms')
              .update({ status: 'completed' })
              .eq('id', room.id);
            if (error) {
              console.error("Failed to auto-complete room:", error);
            } else {
              room.status = 'completed';
            }
          }
        }));
      }

      const finalActive = active ? active.filter(r => r.status === 'active') : [];
      const newlyCompleted = active ? active.filter(r => r.status === 'completed') : [];

      if (finalActive.length > 0 || active?.length === 0) {
        setActiveRooms(prev => {
          return finalActive.map(newRoom => {
            const existingRoom = prev.find(r => r.id === newRoom.id);
            if (existingRoom && existingRoom.currentPlayers !== undefined) {
              newRoom.currentPlayers = existingRoom.currentPlayers;
            } else {
              newRoom.currentPlayers = 0;
            }
            return newRoom;
          });
        });
      }
      
      if (completed || newlyCompleted.length > 0) {
        const allCompleted = [...(newlyCompleted || []), ...(completed || [])];
        // remove duplicates
        const uniqueCompleted = Array.from(new Map(allCompleted.map(item => [item.id, item])).values());
        setCompletedRooms(uniqueCompleted);
      }
    } finally {
      setIsRoomsLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    
    // Subscribe to changes
    const channel = supabase.channel('public:pixi_rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pixi_rooms' }, () => {
        fetchRooms();
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const presenceChannels: any[] = [];
    
    activeRooms.forEach(room => {
      const channel = supabase.channel(`room_${room.id}`);
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // 세션 수는 재연결 시 부풀 수 있어, 고유 사용자 수 기준으로 표시합니다.
        const users = new Set<string>();
        Object.values(state).forEach((sessions: any) => {
          sessions.forEach((s: any) => {
            if (s?.user && !isBotLikeUser(s.user)) users.add(String(s.user));
          });
        });
        // user 메타가 없는 레거시 presence만 있는 경우를 대비한 보수적 fallback
        const count = users.size > 0 ? users.size : Object.keys(state).length;
        setActiveRooms(prev => prev.map(r => r.id === room.id ? { ...r, currentPlayers: count } : r));
      });
      channel.subscribe();
      presenceChannels.push(channel);
    });
    
    return () => {
      presenceChannels.forEach(c => supabase.removeChannel(c));
    };
  }, [activeRooms.map(r => r.id).join(',')]);

  const handleCreateRoom = async () => {
    const currentImageUrl = imageUrl;
    console.log('Creating room with image URL:', currentImageUrl);
    const creatorName = user ? user.username : guestName.trim();
    if (!creatorName) return;
    
    setIsCreating(true);

    // If custom image, save it to puzzle_images
    const isPrivate = imageSource === 'custom';
    if (imageSource === 'custom') {
        const insertData: any = { url: currentImageUrl, is_public: false };
        if (user) insertData.created_by = user.id;
        
        await supabase.from('puzzle_images').insert([insertData]);
    }

    const { data, error } = await supabase
      .from('pixi_rooms')
      .insert([
        { 
          creator_name: creatorName, 
          image_url: currentImageUrl, 
          piece_count: pieceCount, 
          max_players: maxPlayers, 
          status: 'active',
          has_password: !!password.trim(),
          is_private: isPrivate
        }
      ])
      .select();
    
    if (data && data.length > 0) {
      const roomId = data[0].id;
      const recentRooms = JSON.parse(localStorage.getItem('puzzle_recent_rooms') || '[]');
      const newRecent = [roomId, ...recentRooms.filter((id: number) => id !== roomId)].slice(0, 10);
      localStorage.setItem('puzzle_recent_rooms', JSON.stringify(newRecent));
      onJoinRoom(roomId, data[0].image_url, data[0].piece_count);
    } else if (error) {
      console.error('Error creating room:', error);
      alert("방 생성에 실패했습니다.");
    }
    setIsCreating(false);
  };

  const handleJoinSpecificRoom = (room: any) => {
    const currentPlayers = room.currentPlayers ?? 0;
    const maxPlayers = room.max_players ?? 0;
    if (maxPlayers > 0 && currentPlayers >= maxPlayers) {
      setRoomFullInfo({
        roomCode: encodeRoomId(room.id),
        current: currentPlayers,
        max: maxPlayers,
      });
      setShowRoomFullModal(true);
      return;
    }

    if (room.has_password) {
      const pwd = prompt('Enter room password:');
      if (pwd === null) return;
      // In a real app, we'd verify the password here or on the server.
      // For now, we just let them in if they enter something, or we'd need a password column.
    }

    const recentRooms = JSON.parse(localStorage.getItem('puzzle_recent_rooms') || '[]');
    const newRecent = [room.id, ...recentRooms.filter((id: number) => id !== room.id)].slice(0, 10);
    localStorage.setItem('puzzle_recent_rooms', JSON.stringify(newRecent));

    onJoinRoom(room.id, room.image_url, room.totalPieces || room.piece_count);
  };

  const tossLight = !!tossUi;
  /** 앱인토스 로비: TDS·퍼즐방과 동일 계열 (밝은 배경 + 블루 포인트) */
  const tossSkin = tossUi
    ? {
        card: "bg-white border-[#D9E8FF] shadow-[0_4px_24px_rgba(47,111,228,0.07)]",
        heading: "text-slate-900",
        body: "text-slate-600",
        label: "text-[#2F6FE4]",
        input:
          "bg-[#F4F8FF] border-[#D9E8FF] text-slate-900 placeholder:text-slate-400 focus:border-[#2F6FE4] focus:ring-1 focus:ring-[#2F6FE4]/30",
        segmentOn: "bg-[#2F6FE4] text-white",
        segmentOff: "bg-white border border-[#D9E8FF] text-slate-600 hover:bg-[#EAF2FF]",
        pillOn: "bg-[#2F6FE4] text-white",
        pillOff: "bg-white border border-[#D9E8FF] text-slate-600 hover:border-[#2F6FE4]/40",
        primaryBtn: "bg-[#3182F6] hover:bg-[#2563EB] text-white shadow-[0_8px_20px_rgba(47,111,228,0.2)]",
        iconBox: "bg-[#EAF2FF] text-[#2F6FE4]",
        subtleIcon: "text-[#2F6FE4]",
        roomCard: "bg-[#F4F8FF] border-[#D9E8FF] hover:border-[#2F6FE4]/35",
        joinBtn: "bg-[#EAF2FF] hover:bg-[#2F6FE4] text-[#2F6FE4] hover:text-white border border-[#D9E8FF]",
        progress: "bg-[#D9E8FF]",
        progressFill: "bg-[#2F6FE4]",
        completedAccent: "text-[#2F6FE4]",
        completedBar: "bg-[#2F6FE4]",
        viewBtn: "bg-[#EAF2FF] hover:bg-[#2F6FE4] text-[#2F6FE4] hover:text-white border border-[#D9E8FF]",
        empty: "text-slate-500",
        footerBorder: "border-[#D9E8FF]",
        footerLink: "text-slate-500 hover:text-[#2F6FE4]",
      }
    : null;

  const headerActions = (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 min-w-0">
          {user ? (
            <>
              <div className="flex items-center gap-2 mr-2 text-xs sm:text-sm">
                <div
                  className={`flex items-center gap-1.5 ${tossLight ? "text-slate-800" : "text-slate-300"}`}
                >
                  <span className={`hidden sm:inline ${tossLight ? "text-slate-500" : "text-slate-500"}`}>
                    환영합니다,
                  </span>
                  <button
                    onClick={() => setShowStatsModal(true)}
                    className={`font-medium transition-colors ${
                      tossLight
                        ? "text-[#2F6FE4] hover:text-[#2563EB]"
                        : "text-indigo-400 hover:text-indigo-300"
                    }`}
                  >
                    {user.username}
                  </button>
                  <span className={`hidden sm:inline ${tossLight ? "text-slate-500" : "text-slate-500"}`}>
                    님
                  </span>
                </div>
                
                <div
                  className={`hidden md:flex items-center gap-3 ml-2 ${
                    tossLight ? "text-slate-600" : "text-slate-400"
                  }`}
                >
                  <span title="완성한 퍼즐" className="flex items-center gap-1">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    {user.completed_puzzles || 0}
                  </span>
                  <span title="맞춘 조각" className="flex items-center gap-1">
                    <Grid className={`w-4 h-4 ${tossLight ? "text-[#2F6FE4]" : "text-indigo-400"}`} />
                    {user.placed_pieces || 0}
                  </span>
                </div>
              </div>

              {/* Stats Modal (Mobile Only) */}
              {showStatsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 md:hidden">
                  <div
                    className={`rounded-2xl p-5 w-full max-w-sm shadow-2xl border ${
                      tossUi
                        ? "bg-white border-[#D9E8FF] text-slate-900"
                        : "bg-slate-900 border-slate-700 text-white"
                    }`}
                  >
                    <h3 className="text-base font-bold mb-4">나의 전적</h3>
                    <div className="space-y-2.5 mb-5 text-sm">
                      <div className="flex justify-between">
                        <span className={tossUi ? "text-slate-500" : "text-slate-400"}>완성한 퍼즐</span>
                        <span className="font-medium">{user.completed_puzzles || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={tossUi ? "text-slate-500" : "text-slate-400"}>맞춘 조각</span>
                        <span className="font-medium">{user.placed_pieces || 0}</span>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={onLogout}
                        className={`flex-1 py-2 rounded-lg transition-colors text-sm ${
                          tossUi
                            ? "bg-red-50 hover:bg-red-100 text-red-600 border border-red-100"
                            : "bg-red-500/10 hover:bg-red-500/20 text-red-400"
                        }`}
                      >
                        로그아웃
                      </button>
                      <button
                        onClick={() => setShowStatsModal(false)}
                        className={`flex-1 py-2 rounded-lg transition-colors text-sm ${
                          tossUi
                            ? "bg-[#EAF2FF] hover:bg-[#D9E8FF] text-[#2F6FE4] font-medium"
                            : "bg-slate-800 hover:bg-slate-700"
                        }`}
                      >
                        닫기
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {user.role === 'admin' && (
                <button 
                  onClick={onAdmin}
                  className={`flex items-center justify-center gap-2 px-3 h-8 sm:h-9 rounded-lg transition-colors shrink-0 text-sm font-medium border ${
                    tossLight
                      ? "bg-[#EAF2FF] hover:bg-[#D9E8FF] border-[#D9E8FF] text-[#2F6FE4]"
                      : "bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/20 text-indigo-400"
                  }`}
                  title="관리자 페이지"
                >
                  <ShieldAlert size={16} />
                  <span className="hidden sm:inline">관리자</span>
                </button>
              )}

              <button 
                onClick={onLogout}
                className={`hidden sm:flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg transition-colors border shrink-0 ${
                  tossLight
                    ? "bg-slate-100 hover:bg-red-50 border-slate-200 text-slate-600 hover:text-red-600"
                    : "bg-slate-800/50 hover:bg-red-500/20 hover:text-red-400 border-slate-700/50 text-slate-400"
                }`}
                title="로그아웃"
              >
                <LogOut size={18} />
              </button>
            </>
          ) : tossLight ? (
            <button
              type="button"
              onClick={onLoginClick}
              className="shrink-0 rounded-lg bg-[#3182F6] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#2563EB] active:opacity-90"
            >
              로그인
            </button>
          ) : (
            <button 
              type="button"
              onClick={onLoginClick}
              className="flex items-center justify-center gap-2 px-4 h-8 sm:h-9 bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors text-white text-sm font-medium shrink-0"
            >
              <LogIn size={16} />
              <span className="hidden sm:inline">{isKo ? "로그인 / 가입" : "Login / Sign up"}</span>
            </button>
          )}

          {!tossUi ? (
            <button
              type="button"
              onClick={onToggleLocale}
              className="flex items-center justify-center gap-1 w-14 h-8 sm:h-9 bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700/50 text-slate-300 hover:text-white shrink-0 text-xs font-semibold"
              title={isKo ? "Switch to English" : "한국어로 전환"}
            >
              <Languages size={14} />
              <span>{isKo ? 'KO' : 'EN'}</span>
            </button>
          ) : null}
          {!tossUi ? (
            <button
              type="button"
              onClick={toggleOrientation}
              className="flex lg:hidden items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700/50 text-slate-400 hover:text-white shrink-0"
              title={isKo ? "화면 회전" : "Rotate Screen"}
            >
              <RotateCcw size={18} />
            </button>
          ) : null}
          {!tossUi ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700/50 text-slate-400 hover:text-white shrink-0"
              title={isFullscreen ? (isKo ? "전체화면 종료" : "Exit Fullscreen") : (isKo ? "전체화면" : "Enter Fullscreen")}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          ) : null}
    </div>
  );

  const tossContentPadX = tossUi
    ? { paddingLeft: tossUi.safeArea.left + 16, paddingRight: tossUi.safeArea.right + 16 }
    : undefined;

  return (
    <div
      className={`min-h-screen relative flex flex-col items-center overflow-y-auto box-border ${
        tossUi ? "pb-12 bg-[#F4F8FF]" : "bg-slate-950 pt-20 pb-12 px-4"
      }`}
      style={
        tossUi
          ? {
              paddingTop: tossUi.safeArea.top + 12,
              paddingBottom: tossUi.safeArea.bottom + 48,
            }
          : undefined
      }
    >
      {!tossUi ? (
        <div className="fixed top-0 left-0 w-full z-50 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50 p-2 sm:p-3 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center bg-indigo-500/10 w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-indigo-500/20 shrink-0">
              <Grid3X3 size={18} className="text-indigo-400" />
            </div>
            <span className="font-bold text-sm sm:text-base">{isKo ? "웹퍼즐" : "Web Puzzle"}</span>
          </div>
          {headerActions}
        </div>
      ) : null}

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full grid grid-cols-1 gap-5 max-w-7xl lg:grid-cols-3 md:grid-cols-2"
        style={
          tossUi
            ? { ...tossContentPadX, paddingTop: 6, boxSizing: "border-box" as const }
            : undefined
        }
      >
        {/* Left Column: Create/Join Form */}
        <div
          className={`rounded-3xl p-5 text-center h-fit border ${
            tossSkin ? `${tossSkin.card}` : "bg-slate-900 border-slate-800"
          }`}
        >
          {!tossUi && (
            <>
              <div
                className={`w-24 h-24 rounded-2xl flex items-center justify-center mx-auto mb-4 ${
                  tossSkin ? tossSkin.iconBox : "bg-indigo-500/10"
                }`}
              >
                <svg
                  width="60"
                  height="60"
                  viewBox="-20 -30 200 200"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={tossSkin ? tossSkin.subtleIcon : "text-indigo-400"}
                >
                  <path d="M25.18,11.87c0,20.95,13.8,42.39,4.85,42.68-8.95.29-11.99-6.96-17.69-6.96s-8.34,4.77-8.34,18.59,2.64,18.59,8.34,18.59,8.74-7.24,17.69-6.96c8.95.29-4.85,21.73-4.85,42.68,20.95,0,42.39,13.8,42.68,4.85.29-8.95-6.96-11.99-6.96-17.69s4.77-8.34,18.59-8.34,18.59,2.64,18.59,8.34-7.24,8.74-6.96,17.69c.29,8.95,21.73-4.85,42.68-4.85,0-20.95-13.8-42.39-4.85-42.68s11.99,6.96,17.69,6.96,8.34-4.77,8.34-18.59-2.64-18.59-8.34-18.59-8.74,7.24-17.69,6.96c-8.95-.29,4.85-21.73,4.85-42.68-20.95,0-42.39-13.8-42.68-4.85s6.96,11.99,6.96,17.69-4.77,8.34-18.59,8.34-18.59-2.64-18.59-8.34,7.24-8.74,6.96-17.69c-.29-8.95-21.73,4.85-42.68,4.85Z"/>
                </svg>
              </div>
              
              <h1 className={`text-3xl font-bold mb-2 ${tossSkin ? tossSkin.heading : "text-white"}`}>
                {isKo ? "웹퍼즐" : "Web Puzzle"}
              </h1>
              <p className={`mb-4 ${tossSkin ? tossSkin.body : "text-slate-400"}`}>
                {isKo
                  ? "새 퍼즐방을 만들고 친구를 초대해 보세요!"
                  : "Create a new puzzle room and invite friends!"}
              </p>
            </>
          )}

          {!user && (
            <div className="mb-4">
              <input
                type="text"
                placeholder="사용할 닉네임을 입력하세요"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className={`w-full rounded-xl p-3 focus:outline-none ${
                  tossSkin
                    ? tossSkin.input
                    : "bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:border-indigo-500"
                }`}
              />
            </div>
          )}

          <div className="space-y-4 mb-4 text-left">
            <div>
              <label
                className={`block text-sm font-medium mb-2 flex items-center gap-2 ${
                  tossSkin ? tossSkin.label : "text-slate-300"
                }`}
              >
                <ImageIcon className="w-4 h-4" /> {isKo ? "이미지" : "Image"}
              </label>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setImageSource("public")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                    imageSource === "public"
                      ? tossSkin
                        ? tossSkin.segmentOn
                        : "bg-indigo-500 text-white"
                      : tossSkin
                        ? tossSkin.segmentOff
                        : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isKo ? "공개" : "Public"}
                </button>
                <button
                  onClick={() => setImageSource("custom")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                    imageSource === "custom"
                      ? tossSkin
                        ? tossSkin.segmentOn
                        : "bg-indigo-500 text-white"
                      : tossSkin
                        ? tossSkin.segmentOff
                        : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isKo ? "직접 업로드" : "Custom"}
                </button>
              </div>
              {imageSource === "public" ? (
                <button
                  onClick={() => setIsImageModalOpen(true)}
                  className={`w-full rounded-xl p-2 transition-colors flex items-center justify-between group border ${
                    tossSkin
                      ? "bg-[#F4F8FF] border-[#D9E8FF] text-slate-900 hover:border-[#2F6FE4]/50"
                      : "bg-slate-950 border-slate-800 hover:border-indigo-500 text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div
                      className={`w-12 h-12 rounded-lg overflow-hidden shrink-0 ${
                        tossSkin ? "bg-white border border-[#D9E8FF]" : "bg-slate-900"
                      }`}
                    >
                      <img 
                        src={imageUrl} 
                        alt="Selected puzzle" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <span className="text-sm font-medium truncate">
                      {publicImages.find(img => img.url === imageUrl)?.title || 
                       publicImages.find(img => img.url === imageUrl)?.category + ' - ' + publicImages.find(img => img.url === imageUrl)?.style || 
                       (isKo ? '이미지를 선택하세요' : 'Select an image')}
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 shrink-0 mr-2 ${
                      tossSkin ? "text-slate-400 group-hover:text-[#2F6FE4]" : "text-slate-500 group-hover:text-indigo-400"
                    }`}
                  />
                </button>
              ) : (
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className={`w-full rounded-xl p-3 focus:outline-none text-sm ${
                    tossSkin
                      ? tossSkin.input
                      : "bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:border-indigo-500"
                  }`}
                />
              )}
            </div>

            <div>
              <label
                className={`block text-sm font-medium mb-2 flex items-center gap-2 ${
                  tossSkin ? tossSkin.label : "text-slate-300"
                }`}
              >
                <Grid className="w-4 h-4" /> {isKo ? "조각 수" : "Target Piece Count"}
              </label>
              <div className="grid grid-cols-6 gap-2">
                {[20, 100, 150, 300, 500, 1000].map((count) => (
                  <button
                    key={count}
                    onClick={() => setPieceCount(count)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      pieceCount === count
                        ? tossSkin
                          ? tossSkin.pillOn
                          : "bg-indigo-500 text-white"
                        : tossSkin
                          ? tossSkin.pillOff
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className={`text-xs mt-2 ${tossSkin ? tossSkin.empty : "text-slate-500"}`}>
                {isKo
                  ? "이미지 비율에 맞춰 정사각형 조각을 유지하기 위해 실제 조각 수는 약간 달라질 수 있습니다."
                  : "Actual count may vary slightly to maintain square pieces based on image aspect ratio."}
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label
                  className={`block text-sm font-medium mb-2 flex items-center gap-2 ${
                    tossSkin ? tossSkin.label : "text-slate-300"
                  }`}
                >
                  <Users className="w-4 h-4" /> {isKo ? "최대 인원" : "Max Players"}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setMaxPlayers(num)}
                      className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                        maxPlayers === num
                          ? tossSkin
                            ? tossSkin.pillOn
                            : "bg-indigo-500 text-white"
                          : tossSkin
                            ? tossSkin.pillOff
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex-1">
                <label
                  className={`block text-sm font-medium mb-2 flex items-center gap-2 ${
                    tossSkin ? tossSkin.label : "text-slate-300"
                  }`}
                >
                  <Lock className="w-4 h-4" /> {isKo ? "비밀번호 (선택)" : "Password (Optional)"}
                </label>
                <input
                  type="text"
                  placeholder={isKo ? "비워두면 공개방" : "Leave empty for public"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full rounded-xl p-3 text-sm focus:outline-none ${
                    tossSkin
                      ? tossSkin.input
                      : "bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:border-indigo-500"
                  }`}
                />
              </div>
            </div>
          </div>

          <button
            onClick={handleCreateRoom}
            disabled={isCreating || (!user && !guestName.trim())}
            className={`w-full font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors ${
              tossSkin
                ? `${tossSkin.primaryBtn} disabled:bg-slate-200 disabled:text-slate-400`
                : "bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white"
            }`}
          >
            <Plus className="w-5 h-5" />
            {isCreating ? (isKo ? '생성 중...' : 'Creating...') : (isKo ? '광고 한 편 보고 방 만들기' : 'Watch an ad and create room')}
          </button>
        </div>

        {/* Middle Column: Active Rooms Gallery */}
        <div
          className={`rounded-3xl p-5 flex flex-col h-[600px] border ${
            tossSkin ? tossSkin.card : "bg-slate-900 border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h2
              className={`text-xl font-bold flex items-center gap-2 ${
                tossSkin ? tossSkin.heading : "text-white"
              }`}
            >
              <Grid className={`w-5 h-5 ${tossSkin ? tossSkin.subtleIcon : "text-indigo-400"}`} />
              {isKo ? "진행 중인 퍼즐방" : "Active Puzzle Rooms"}
            </h2>
            <button
              onClick={fetchRooms}
              className={`transition-colors p-2 rounded-lg ${
                tossSkin
                  ? "text-slate-500 hover:text-[#2F6FE4] hover:bg-[#EAF2FF]"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
              title={isKo ? "목록 새로고침" : "Refresh room list"}
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {isRoomsLoading ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <div className={`w-8 h-8 rounded-full border-2 border-transparent animate-spin ${
                  tossSkin ? "border-t-[#2F6FE4] border-r-[#D9E8FF]" : "border-t-indigo-400 border-r-slate-600"
                }`} />
                <p className="mt-3 text-sm">{isKo ? "진행 중인 퍼즐방을 불러오는 중..." : "Loading active puzzle rooms..."}</p>
              </div>
            ) : activeRooms.length === 0 ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <ImageIcon className={`w-12 h-12 mb-3 ${tossSkin ? "opacity-30 text-[#2F6FE4]" : "opacity-20"}`} />
                <p>{isKo ? "아직 진행 중인 방이 없습니다." : "No active rooms yet."}</p>
                <p className="text-sm mt-1">{isKo ? "첫 번째 방을 만들어 보세요!" : "Be the first to create one!"}</p>
              </div>
            ) : (
              [...activeRooms].sort((a, b) => {
                const aPlayers = a.currentPlayers || 0;
                const bPlayers = b.currentPlayers || 0;
                
                // 1. 현재 플레이어가 있는 방을 맨 위로
                if (aPlayers > 0 && bPlayers === 0) return -1;
                if (bPlayers > 0 && aPlayers === 0) return 1;
                
                // 2. 플레이어가 있는 방들끼리는 플레이어 수가 많은 순
                if (aPlayers > 0 && bPlayers > 0 && aPlayers !== bPlayers) {
                  return bPlayers - aPlayers;
                }
                
                // 3. 최근 활동 시간 기준으로 정렬 (created_at 사용)
                const aTime = new Date(a.created_at).getTime();
                const bTime = new Date(b.created_at).getTime();
                
                return bTime - aTime;
              }).map((room) => (
                <div
                  key={room.id}
                  className={`group rounded-2xl overflow-hidden transition-all duration-300 border ${
                    tossSkin
                      ? tossSkin.roomCard
                      : "bg-slate-950 border-slate-800 hover:border-indigo-500/50"
                  }`}
                >
                  <div className="h-32 w-full overflow-hidden relative">
                    <img
                      src={room.image_url}
                      alt="Puzzle preview"
                      className={`w-full h-full object-cover transition-transform duration-500 ${room.has_password ? "blur-xl scale-125" : "group-hover:scale-105"}`}
                      referrerPolicy="no-referrer"
                    />
                    <div
                      className={`absolute inset-0 bg-gradient-to-t ${
                        tossSkin ? "from-[#F4F8FF] via-transparent to-transparent" : "from-slate-950 to-transparent"
                      }`}
                    />
                    <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                      <div className="flex gap-2 items-center">
                        <span
                          className={`backdrop-blur-sm text-xs font-medium px-2 py-1 rounded-md border ${
                            tossSkin
                              ? "bg-white/90 text-slate-800 border-[#D9E8FF]"
                              : "bg-slate-900/80 text-white border-slate-700"
                          }`}
                        >
                          {room.totalPieces || room.piece_count} {isKo ? "조각" : "Pieces"}
                        </span>
                        {room.has_password && (
                          <span
                            className={`backdrop-blur-sm text-xs font-medium text-amber-600 px-2 py-1 rounded-md border flex items-center gap-1 ${
                              tossSkin ? "bg-white/90 border-[#D9E8FF]" : "bg-slate-900/80 border-slate-700 text-amber-400"
                            }`}
                          >
                            <Lock size={12} />
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-xs flex items-center gap-1 ${
                          tossSkin ? "text-slate-600" : "text-slate-300"
                        }`}
                      >
                        <Users className="w-3 h-3" /> {isKo ? "생성자" : "Created by"} {room.creator_name}
                      </span>
                    </div>
                  </div>
                  {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                    <div className={`w-full h-1.5 overflow-hidden ${tossSkin ? tossSkin.progress : "bg-slate-800"}`}>
                      <div
                        className={`h-full transition-all duration-500 ${
                          tossSkin ? tossSkin.progressFill : "bg-indigo-500"
                        }`}
                        style={{ width: `${Math.round((room.snappedCount / room.totalPieces) * 100)}%` }}
                      />
                    </div>
                  )}
                  <div
                    className={`p-3 flex items-center justify-between ${
                      tossSkin ? "bg-white" : ""
                    }`}
                  >
                    <div className="text-left">
                      <p
                        className={`text-sm font-medium flex items-center gap-2 ${
                          tossSkin ? "text-slate-800" : "text-slate-300"
                        }`}
                      >
                        Room #{encodeRoomId(room.id)}
                        {room.currentPlayers !== undefined && room.max_players !== undefined && (
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-md ${
                              room.currentPlayers >= room.max_players
                                ? "bg-red-500/15 text-red-600"
                                : tossSkin
                                  ? "bg-[#EAF2FF] text-[#2F6FE4]"
                                  : "bg-emerald-500/20 text-emerald-400"
                            }`}
                          >
                            {room.currentPlayers}/{room.max_players}
                          </span>
                        )}
                      </p>
                      {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                        <p
                          className={`text-xs font-medium mt-1 ${
                            tossSkin ? "text-[#2F6FE4]" : "text-indigo-400"
                          }`}
                        >
                          {Math.round((room.snappedCount / room.totalPieces) * 100)}% {isKo ? "완료" : "Complete"} (
                          {room.snappedCount}/{room.totalPieces})
                        </p>
                      )}
                      <p className={`text-xs flex items-center mt-1 ${tossSkin ? "text-slate-500" : "text-slate-500"}`}>
                        <Clock className="w-3 h-3 mr-1" />
                        {new Date(room.created_at).toLocaleDateString()}
                        <span className={`font-medium ml-1 ${tossSkin ? "text-[#2F6FE4]" : "text-indigo-400"}`}>
                          • {formatPlayTime(room.total_play_time_seconds || 0)}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleJoinSpecificRoom(room)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                        tossSkin ? tossSkin.joinBtn : "bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white"
                      }`}
                    >
                      {isKo ? "입장" : "Join"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Completed Rooms Gallery */}
        <div
          className={`rounded-3xl p-5 flex flex-col h-[600px] md:col-span-2 lg:col-span-1 border ${
            tossSkin ? tossSkin.card : "bg-slate-900 border-slate-800"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h2
              className={`text-xl font-bold flex items-center gap-2 ${
                tossSkin ? tossSkin.heading : "text-white"
              }`}
            >
              <Trophy className={`w-5 h-5 ${tossSkin ? tossSkin.subtleIcon : "text-amber-400"}`} />
              {isKo ? "완료된 퍼즐방" : "Completed Puzzles"}
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {isRoomsLoading ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <div className={`w-8 h-8 rounded-full border-2 border-transparent animate-spin ${
                  tossSkin ? "border-t-[#2F6FE4] border-r-[#D9E8FF]" : "border-t-amber-400 border-r-slate-600"
                }`} />
                <p className="mt-3 text-sm">{isKo ? "완료된 퍼즐방을 불러오는 중..." : "Loading completed puzzle rooms..."}</p>
              </div>
            ) : completedRooms.length === 0 ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <Trophy className={`w-12 h-12 mb-3 ${tossSkin ? "opacity-30 text-[#2F6FE4]" : "opacity-20"}`} />
                <p>{isKo ? "아직 완료된 퍼즐방이 없습니다." : "No completed puzzles yet."}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-3">
                {completedRooms.map((room) => (
                  <div
                    key={room.id}
                    className={`group rounded-2xl overflow-hidden transition-all duration-300 border ${
                      tossSkin
                        ? `${tossSkin.roomCard} hover:border-[#2F6FE4]/45`
                        : "bg-slate-950 border-slate-800 hover:border-amber-500/50"
                    }`}
                  >
                    <div className="h-32 w-full overflow-hidden relative">
                      <img
                        src={room.image_url}
                        alt="Puzzle preview"
                        className={`w-full h-full object-cover transition-transform duration-500 ${room.has_password ? "blur-xl scale-125" : "group-hover:scale-105"}`}
                        referrerPolicy="no-referrer"
                      />
                      <div
                        className={`absolute inset-0 bg-gradient-to-t ${
                          tossSkin ? "from-[#F4F8FF] via-transparent to-transparent" : "from-slate-950 to-transparent"
                        }`}
                      />
                      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                        <div className="flex gap-2 items-center">
                          <span
                            className={`backdrop-blur-sm text-xs font-medium px-2 py-1 rounded-md border ${
                              tossSkin
                                ? "bg-white/90 text-slate-800 border-[#D9E8FF]"
                                : "bg-slate-900/80 text-white border-slate-700"
                            }`}
                          >
                            {room.totalPieces || room.piece_count} {isKo ? "조각" : "Pieces"}
                          </span>
                          {room.has_password && (
                            <span
                              className={`backdrop-blur-sm text-xs font-medium px-2 py-1 rounded-md border flex items-center gap-1 ${
                                tossSkin
                                  ? "bg-white/90 text-amber-600 border-[#D9E8FF]"
                                  : "bg-slate-900/80 text-amber-400 border-slate-700"
                              }`}
                            >
                              <Lock size={12} />
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs flex items-center gap-1 ${
                            tossSkin ? "text-slate-600" : "text-slate-300"
                          }`}
                        >
                          <Users className="w-3 h-3" /> {isKo ? "생성자" : "Created by"} {room.creator_name}
                        </span>
                      </div>
                    </div>
                    <div className={`w-full h-1.5 overflow-hidden ${tossSkin ? tossSkin.progress : "bg-slate-800"}`}>
                      <div className={`h-full w-full ${tossSkin ? tossSkin.completedBar : "bg-amber-500"}`} />
                    </div>
                    <div className={`p-3 flex items-center justify-between ${tossSkin ? "bg-white" : ""}`}>
                      <div className="text-left">
                        <p
                          className={`text-sm font-medium flex items-center gap-2 ${
                            tossSkin ? "text-slate-800" : "text-slate-300"
                          }`}
                        >
                          Room #{encodeRoomId(room.id)}
                        </p>
                        <p
                          className={`text-xs font-medium mt-1 ${
                            tossSkin ? tossSkin.completedAccent : "text-amber-400"
                          }`}
                        >
                          100% {isKo ? "완료" : "Complete"}
                        </p>
                        <p className={`text-xs flex items-center mt-1 ${tossSkin ? "text-slate-500" : "text-slate-500"}`}>
                          <Clock className="w-3 h-3 mr-1" />
                          {new Date(room.created_at).toLocaleDateString()}
                          <span
                            className={`font-medium ml-1 ${
                              tossSkin ? tossSkin.completedAccent : "text-amber-400"
                            }`}
                          >
                            • {formatPlayTime(room.total_play_time_seconds || 0)}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleJoinSpecificRoom(room)}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                          tossSkin ? tossSkin.viewBtn : "bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white"
                        }`}
                      >
                        {isKo ? "보기" : "View"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <ImageSelectorModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        images={publicImages}
        selectedUrl={imageUrl}
        onSelect={setImageUrl}
        tossStyling={!!tossUi}
      />

      {showRoomFullModal && roomFullInfo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div
            className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl ${
              tossUi
                ? "border-[#D9E8FF] bg-white text-slate-900"
                : "border-slate-700 bg-slate-900 text-white"
            }`}
          >
            <h3 className="text-base font-bold mb-2">방 입장 불가</h3>
            <p className={`text-sm leading-relaxed ${tossUi ? "text-slate-600" : "text-slate-300"}`}>
              Room #{roomFullInfo.roomCode} 는 현재 정원이 가득 찼습니다.
              <br />
              ({roomFullInfo.current}/{roomFullInfo.max})
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowRoomFullModal(false)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
                  tossUi ? "bg-[#3182F6] hover:bg-[#2563EB] shadow-sm" : "bg-indigo-500 hover:bg-indigo-600"
                }`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {onOpenTerms && (
        <footer
          className={`w-full max-w-6xl mx-auto mt-8 pt-4 text-center box-border border-t ${
            tossSkin ? tossSkin.footerBorder : "border-slate-800/80"
          }`}
          style={tossUi ? tossContentPadX : undefined}
        >
          <button
            type="button"
            onClick={onOpenTerms}
            className={`text-xs transition-colors ${tossSkin ? tossSkin.footerLink : "text-slate-500 hover:text-indigo-400"}`}
          >
            서비스 이용약관
          </button>
        </footer>
      )}
    </div>
  );
};

export default Lobby;

