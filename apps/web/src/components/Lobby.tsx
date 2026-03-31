import React, { useState, useEffect } from 'react';
import { Button } from '@toss/tds-mobile';
import { Trophy, Grid3X3, RefreshCw, Users, Lock, Image as ImageIcon, Play, Plus, Grid, Clock, RotateCcw, Maximize, Minimize, LogOut, ShieldAlert, LogIn, ChevronDown } from 'lucide-react';
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
}: {
  onJoinRoom: (roomId: number, imageUrl: string, pieceCount: number) => void;
  user?: any;
  onLogout: () => void;
  onAdmin: () => void;
  onLoginClick: () => void;
  onOpenTerms?: () => void;
  /** 앱인토스: 상태바 인셋 + TDS 상단(내비 영역) */
  tossUi?: TossLobbyUi;
}) => {
  const [activeRooms, setActiveRooms] = useState<any[]>([]);
  const [completedRooms, setCompletedRooms] = useState<any[]>([]);
  const [pieceCount, setPieceCount] = useState(100);
  const [imageUrl, setImageUrl] = useState('https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg');
  const [imageSource, setImageSource] = useState<'public' | 'custom'>('public');
  const [publicImages, setPublicImages] = useState<any[]>([]);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(!!document.fullscreenElement);

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
        const count = Object.keys(state).length;
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
                        ? "text-indigo-600 hover:text-indigo-700"
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
                    <Grid className="w-4 h-4 text-indigo-400" />
                    {user.placed_pieces || 0}
                  </span>
                </div>
              </div>

              {/* Stats Modal (Mobile Only) */}
              {showStatsModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 md:hidden">
                  <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm text-white shadow-2xl">
                    <h3 className="text-base font-bold mb-4">나의 전적</h3>
                    <div className="space-y-2.5 mb-5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">완성한 퍼즐</span>
                        <span className="font-medium">{user.completed_puzzles || 0}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">맞춘 조각</span>
                        <span className="font-medium">{user.placed_pieces || 0}</span>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={onLogout}
                        className="flex-1 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors text-sm"
                      >
                        로그아웃
                      </button>
                      <button 
                        onClick={() => setShowStatsModal(false)}
                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-sm"
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
                      ? "bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700"
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
            <Button color="primary" variant="fill" size="medium" onClick={onLoginClick}>
              로그인
            </Button>
          ) : (
            <button 
              type="button"
              onClick={onLoginClick}
              className="flex items-center justify-center gap-2 px-4 h-8 sm:h-9 bg-indigo-500 hover:bg-indigo-600 rounded-lg transition-colors text-white text-sm font-medium shrink-0"
            >
              <LogIn size={16} />
              <span className="hidden sm:inline">로그인 / 가입</span>
            </button>
          )}

          {!tossUi ? (
            <button
              type="button"
              onClick={toggleOrientation}
              className="flex lg:hidden items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700/50 text-slate-400 hover:text-white shrink-0"
              title="Rotate Screen"
            >
              <RotateCcw size={18} />
            </button>
          ) : null}
          {!tossUi ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-slate-800/50 hover:bg-slate-700 rounded-lg transition-colors border border-slate-700/50 text-slate-400 hover:text-white shrink-0"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
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
      className={`min-h-screen relative bg-slate-950 flex flex-col items-center overflow-y-auto box-border ${
        tossUi ? "pt-4 pb-12" : "pt-20 pb-12 px-4"
      }`}
      style={
        tossUi
          ? {
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
            <span className="font-bold text-sm sm:text-base">Web Puzzle</span>
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
            ? { ...tossContentPadX, paddingTop: 16, boxSizing: "border-box" as const }
            : undefined
        }
      >
        {/* Left Column: Create/Join Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 text-center h-fit">
          <div className="w-24 h-24 bg-indigo-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg width="60" height="60" viewBox="-20 -30 200 200" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
              <path d="M25.18,11.87c0,20.95,13.8,42.39,4.85,42.68-8.95.29-11.99-6.96-17.69-6.96s-8.34,4.77-8.34,18.59,2.64,18.59,8.34,18.59,8.74-7.24,17.69-6.96c8.95.29-4.85,21.73-4.85,42.68,20.95,0,42.39,13.8,42.68,4.85.29-8.95-6.96-11.99-6.96-17.69s4.77-8.34,18.59-8.34,18.59,2.64,18.59,8.34-7.24,8.74-6.96,17.69c.29,8.95,21.73-4.85,42.68-4.85,0-20.95-13.8-42.39-4.85-42.68s11.99,6.96,17.69,6.96,8.34-4.77,8.34-18.59-2.64-18.59-8.34-18.59-8.74,7.24-17.69,6.96c-8.95-.29,4.85-21.73,4.85-42.68-20.95,0-42.39-13.8-42.68-4.85s6.96,11.99,6.96,17.69-4.77,8.34-18.59,8.34-18.59-2.64-18.59-8.34,7.24-8.74,6.96-17.69c-.29-8.95-21.73,4.85-42.68,4.85Z"/>
            </svg>
          </div>
          
          <h1 className="text-3xl font-bold text-white mb-2">
            {tossUi ? "퍼즐 로비" : "Web Puzzle"}
          </h1>
          <p className="text-slate-400 mb-4">
            {tossUi ? "방을 만들고 친구를 초대해 같이 맞춰 보세요." : "Create a new puzzle room and invite friends!"}
          </p>

          {!user && (
            <div className="mb-4">
              <input
                type="text"
                placeholder="사용할 닉네임을 입력하세요"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          )}


          <div className="space-y-4 mb-4 text-left">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> Image
              </label>
              <div className="flex gap-2 mb-2">
                <button onClick={() => setImageSource('public')} className={`flex-1 py-2 rounded-lg text-sm ${imageSource === 'public' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>Public</button>
                <button onClick={() => setImageSource('custom')} className={`flex-1 py-2 rounded-lg text-sm ${imageSource === 'custom' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>Custom</button>
              </div>
              {imageSource === 'public' ? (
                <button
                  onClick={() => setIsImageModalOpen(true)}
                  className="w-full bg-slate-950 border border-slate-800 hover:border-indigo-500 rounded-xl p-2 text-white transition-colors flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0">
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
                       'Select an image'}
                    </span>
                  </div>
                  <ChevronDown className="w-5 h-5 text-slate-500 group-hover:text-indigo-400 shrink-0 mr-2" />
                </button>
              ) : (
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-sm"
                />
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                <Grid className="w-4 h-4" /> Target Piece Count
              </label>
              <div className="grid grid-cols-6 gap-2">
                {[20, 100, 150, 300, 500, 1000].map(count => (
                  <button
                    key={count}
                    onClick={() => setPieceCount(count)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      pieceCount === count 
                        ? 'bg-indigo-500 text-white' 
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Actual count may vary slightly to maintain square pieces based on image aspect ratio.
              </p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Max Players
                </label>
                <select
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white focus:outline-none focus:border-indigo-500 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
                    <option key={num} value={num}>{num} {num === 1 ? 'Player' : 'Players'}</option>
                  ))}
                </select>
              </div>
              
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Lock className="w-4 h-4" /> Password (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Leave empty for public"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 text-sm"
                />
              </div>
            </div>
          </div>
          
          <button
            onClick={handleCreateRoom}
            disabled={isCreating || (!user && !guestName.trim())}
            className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {isCreating ? 'Creating...' : 'Create Room'}
          </button>
        </div>

        {/* Middle Column: Active Rooms Gallery */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col h-[600px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Grid className="w-5 h-5 text-indigo-400" />
              Active Puzzle Rooms
            </h2>
            <button 
              onClick={fetchRooms}
              className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
              title="Refresh room list"
            >
              <RefreshCw size={18} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {activeRooms.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <ImageIcon className="w-12 h-12 mb-3 opacity-20" />
                <p>No active rooms yet.</p>
                <p className="text-sm mt-1">Be the first to create one!</p>
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
                  className="group bg-slate-950 border border-slate-800 hover:border-indigo-500/50 rounded-2xl overflow-hidden transition-all duration-300"
                >
                  <div className="h-32 w-full overflow-hidden relative">
                    <img 
                      src={room.image_url} 
                      alt="Puzzle preview" 
                      className={`w-full h-full object-cover transition-transform duration-500 ${room.has_password ? 'blur-xl scale-125' : 'group-hover:scale-105'}`}
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                      <div className="flex gap-2 items-center">
                        <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-white px-2 py-1 rounded-md border border-slate-700">
                          {room.totalPieces || room.piece_count} Pieces
                        </span>
                        {room.has_password && (
                          <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-amber-400 px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1">
                            <Lock size={12} />
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-300 flex items-center gap-1">
                        <Users className="w-3 h-3" /> Created by {room.creator_name}
                      </span>
                    </div>
                  </div>
                  {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                    <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
                      <div 
                        className="bg-indigo-500 h-full transition-all duration-500"
                        style={{ width: `${Math.round((room.snappedCount / room.totalPieces) * 100)}%` }}
                      />
                    </div>
                  )}
                  <div className="p-3 flex items-center justify-between">
                    <div className="text-left">
                      <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                        Room #{encodeRoomId(room.id)}
                        {room.currentPlayers !== undefined && room.max_players !== undefined && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-md ${room.currentPlayers >= room.max_players ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                            {room.currentPlayers}/{room.max_players}
                          </span>
                        )}
                      </p>
                      {room.snappedCount !== undefined && room.totalPieces !== undefined && (
                        <p className="text-xs text-indigo-400 font-medium mt-1">
                          {Math.round((room.snappedCount / room.totalPieces) * 100)}% Complete ({room.snappedCount}/{room.totalPieces})
                        </p>
                      )}
                      <p className="text-xs text-slate-500 flex items-center mt-1">
                        <Clock className="w-3 h-3 mr-1" />
                        {new Date(room.created_at).toLocaleDateString()}
                        <span className="text-indigo-400 font-medium ml-1">
                          • {formatPlayTime(room.total_play_time_seconds || 0)}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleJoinSpecificRoom(room)}
                      className="bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      Join
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Completed Rooms Gallery */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col h-[600px] md:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Completed Puzzles
            </h2>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {completedRooms.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <Trophy className="w-12 h-12 mb-3 opacity-20" />
                <p>No completed puzzles yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-3">
                {completedRooms.map((room) => (
                  <div 
                    key={room.id}
                    className="group bg-slate-950 border border-slate-800 hover:border-amber-500/50 rounded-2xl overflow-hidden transition-all duration-300"
                  >
                    <div className="h-32 w-full overflow-hidden relative">
                      <img 
                        src={room.image_url} 
                        alt="Puzzle preview" 
                        className={`w-full h-full object-cover transition-transform duration-500 ${room.has_password ? 'blur-xl scale-125' : 'group-hover:scale-105'}`}
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end">
                        <div className="flex gap-2 items-center">
                          <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-white px-2 py-1 rounded-md border border-slate-700">
                            {room.totalPieces || room.piece_count} Pieces
                          </span>
                          {room.has_password && (
                            <span className="bg-slate-900/80 backdrop-blur-sm text-xs font-medium text-amber-400 px-2 py-1 rounded-md border border-slate-700 flex items-center gap-1">
                              <Lock size={12} />
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-slate-300 flex items-center gap-1">
                          <Users className="w-3 h-3" /> Created by {room.creator_name}
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 overflow-hidden">
                      <div className="bg-amber-500 h-full w-full" />
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <div className="text-left">
                        <p className="text-sm font-medium text-slate-300 flex items-center gap-2">
                          Room #{encodeRoomId(room.id)}
                        </p>
                        <p className="text-xs text-amber-400 font-medium mt-1">
                          100% Complete
                        </p>
                        <p className="text-xs text-slate-500 flex items-center mt-1">
                          <Clock className="w-3 h-3 mr-1" />
                          {new Date(room.created_at).toLocaleDateString()}
                          <span className="text-amber-400 font-medium ml-1">
                            • {formatPlayTime(room.total_play_time_seconds || 0)}
                          </span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleJoinSpecificRoom(room)}
                        className="bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                      >
                        View
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
      />

      {onOpenTerms && (
        <footer
          className="w-full max-w-6xl mx-auto mt-8 pt-4 border-t border-slate-800/80 text-center box-border"
          style={tossUi ? tossContentPadX : undefined}
        >
          <button
            type="button"
            onClick={onOpenTerms}
            className="text-xs text-slate-500 hover:text-indigo-400 transition-colors"
          >
            서비스 이용약관
          </button>
        </footer>
      )}
    </div>
  );
};

export default Lobby;

