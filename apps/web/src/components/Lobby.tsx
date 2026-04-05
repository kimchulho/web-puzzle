import React, { useState, useEffect, useRef } from 'react';
import { Trophy, RefreshCw, Users, Lock, Image as ImageIcon, Play, Plus, Grid, Clock, RotateCcw, Maximize, Minimize, LogOut, ShieldAlert, LogIn, ChevronDown, Languages } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { motion } from 'motion/react';
import { encodeRoomId, parseRoomNumberOrCode } from '../lib/roomCode';
import { recordUserRoomVisit } from '../lib/recordUserRoomVisit';
import { apiUrl } from '../lib/apiBase';
import { ImageSelectorModal } from './ImageSelectorModal';
import {
  DEFAULT_PUZZLE_DIFFICULTY,
  normalizePuzzleDifficulty,
  puzzleDifficultyLabel,
  PUZZLE_DIFFICULTIES,
  type PuzzleDifficulty,
} from '../lib/puzzleDifficulty';
import {
  TossLobbyBottomBanner,
  TOSS_LOBBY_BANNER_SLOT_H,
  TOSS_LOBBY_BANNER_VERTICAL_PAD,
} from './TossLobbyBottomBanner';
import { hasTossRewardAdBeenSeenForRoom, runTossRewardedRoomEntry } from '../lib/tossRewardedAdGate';

const formatPlayTime = (seconds: number) => {
  if (!seconds) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const WEB_REWARDED_AD_UNIT_PATH = '/23346390161/web_puzzle_rewarded';
const GPT_SCRIPT_ID = 'google-publisher-tag-script';
const REWARDED_DEBUG_PREFIX = '[RewardedAd]';
const ENABLE_WEB_REWARDED_GATE = false;

const LS_GUEST_CREATED_ROOMS = "puzzle_created_room_ids";

const calculateResolvedPieceCount = (requested: number, imageWidth: number, imageHeight: number) => {
  let target = Math.min(1000, Math.max(1, Math.floor(requested)));
  const aspectRatio = Math.max(0.1, imageWidth / Math.max(1, imageHeight));
  let rows = Math.max(1, Math.round(Math.sqrt(target / aspectRatio)));
  let cols = Math.max(1, Math.round(aspectRatio * rows));

  while (rows * cols > 1000) {
    target -= 10;
    if (target <= 10) {
      rows = Math.max(1, Math.floor(Math.sqrt(10 / aspectRatio)));
      cols = Math.max(1, Math.floor(aspectRatio * rows));
      break;
    }
    rows = Math.max(1, Math.round(Math.sqrt(target / aspectRatio)));
    cols = Math.max(1, Math.round(aspectRatio * rows));
  }
  return rows * cols;
};

const resolvePieceCountFromImage = async (imageUrl: string, requested: number): Promise<number> => {
  if (typeof window === "undefined" || !imageUrl) return requested;
  return await new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      if (w > 0 && h > 0) {
        resolve(calculateResolvedPieceCount(requested, w, h));
        return;
      }
      resolve(requested);
    };
    img.onerror = () => resolve(requested);
    img.src = imageUrl;
  });
};

function readGuestCreatedRoomIds(): number[] {
  try {
    const raw = localStorage.getItem(LS_GUEST_CREATED_ROOMS);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

function pushGuestCreatedRoomId(roomId: number) {
  const cur = readGuestCreatedRoomIds();
  const next = [roomId, ...cur.filter((id) => id !== roomId)].slice(0, 30);
  localStorage.setItem(LS_GUEST_CREATED_ROOMS, JSON.stringify(next));
}

/** BIGINT from PostgREST may be number or string; user.id from API may differ in type. */
function sameCreatorId(rowCreator: unknown, userId: unknown): boolean {
  if (rowCreator == null || userId == null || userId === "") return false;
  return String(rowCreator) === String(userId);
}

/** Logged-in: created_by or legacy creator_name match. Guest: localStorage ids from room creation. */
function roomIsMine(
  room: { id: number; created_by?: string | number | null; creator_name?: string | null },
  user?: { id?: string | number; username?: string } | null
): boolean {
  if (user?.id != null && user.id !== "") {
    if (sameCreatorId(room.created_by, user.id)) return true;
    if (!room.created_by && user.username && room.creator_name === user.username) return true;
    return false;
  }
  return readGuestCreatedRoomIds().includes(room.id);
}

function parseRoomIdField(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return null;
}

/** Server visit rows → ordered room ids (newest first) + last access time per room (ms). */
function parseServerVisits(rows: { room_id: unknown; last_visited_at: unknown }[]): {
  orderedIds: number[];
  atMs: Map<number, number>;
} {
  const atMs = new Map<number, number>();
  const orderedIds: number[] = [];
  const seen = new Set<number>();
  for (const v of rows) {
    const id = parseRoomIdField(v.room_id);
    if (id == null || seen.has(id)) continue;
    const t = v.last_visited_at;
    let ms: number;
    if (typeof t === "string") ms = Date.parse(t);
    else if (typeof t === "number" && Number.isFinite(t)) ms = t;
    else ms = NaN;
    if (!Number.isFinite(ms)) ms = 0;
    atMs.set(id, ms);
    orderedIds.push(id);
    seen.add(id);
  }
  return { orderedIds, atMs };
}

/** Server-ordered ids first, then local-only ids (same browser), preserving order within each. */
function mergeContinueRoomOrder(serverOrdered: number[], localOrdered: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of serverOrdered) {
    if (typeof id === "number" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of localOrdered) {
    if (typeof id === "number" && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Pinned = 내 방 또는 이어하기(continue) 목록에 있는 방. 그 안에서는 가장 최근 접속이 맨 위. */
function sortActiveRoomsForLobby(
  rooms: any[],
  user: { id?: string | number; username?: string } | undefined | null,
  continueRoomOrder: number[],
  serverVisitAtMs: Map<number, number>
): any[] {
  const continueIndex = new Map<number, number>();
  continueRoomOrder.forEach((id, i) => {
    if (typeof id === "number" && !continueIndex.has(id)) continueIndex.set(id, i);
  });

  const guestCreated = user?.id != null && user.id !== "" ? [] : readGuestCreatedRoomIds();

  const mine = (r: any) => {
    if (user?.id != null && user.id !== "") {
      if (sameCreatorId(r.created_by, user.id)) return true;
      if (!r.created_by && user.username && r.creator_name === user.username) return true;
      return false;
    }
    return guestCreated.includes(r.id);
  };

  const pinned = (r: any) => mine(r) || continueIndex.has(r.id);

  const pinnedLastAccessMs = (r: any): number => {
    if (serverVisitAtMs.has(r.id)) {
      const v = serverVisitAtMs.get(r.id)!;
      if (Number.isFinite(v)) return v;
    }
    const ci = continueIndex.get(r.id);
    if (ci !== undefined) return 1e15 - ci;
    if (mine(r)) return new Date(r.created_at).getTime();
    return 0;
  };

  const tiePlayersAndTime = (a: any, b: any) => {
    const aPlayers = a.currentPlayers || 0;
    const bPlayers = b.currentPlayers || 0;
    if (aPlayers > 0 && bPlayers === 0) return -1;
    if (bPlayers > 0 && aPlayers === 0) return 1;
    if (aPlayers > 0 && bPlayers > 0 && aPlayers !== bPlayers) return bPlayers - aPlayers;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  };

  return [...rooms].sort((a, b) => {
    const pa = pinned(a);
    const pb = pinned(b);
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    if (pa && pb) {
      const ta = pinnedLastAccessMs(a);
      const tb = pinnedLastAccessMs(b);
      if (tb !== ta) return tb - ta;
      return tiePlayersAndTime(a, b);
    }
    return tiePlayersAndTime(a, b);
  });
}

declare global {
  interface Window {
    googletag?: any;
  }
}

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
  onJoinRoom: (roomId: number, imageUrl: string, pieceCount: number, difficulty: PuzzleDifficulty) => void;
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
  const [continueRoomIdsServer, setContinueRoomIdsServer] = useState<number[]>([]);
  const [serverVisitAtMs, setServerVisitAtMs] = useState<Map<number, number>>(() => new Map());
  const [completedRooms, setCompletedRooms] = useState<any[]>([]);
  const [isRoomsLoading, setIsRoomsLoading] = useState(true);
  /** 배경 갱신(Realtime·수동 새로고침): 목록이 이미 있으면 전면 스피너 대신 헤더 쪽만 표시 */
  const [isRoomsRefreshing, setIsRoomsRefreshing] = useState(false);
  const roomsRefreshDepthRef = useRef(0);
  const [pieceCount, setPieceCount] = useState(100);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>(DEFAULT_PUZZLE_DIFFICULTY);
  const [imageUrl, setImageUrl] = useState('https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg');
  const [imageSource, setImageSource] = useState<'public' | 'custom'>('public');
  const [publicImages, setPublicImages] = useState<any[]>([]);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showRoomFullModal, setShowRoomFullModal] = useState(false);
  const [roomFullInfo, setRoomFullInfo] = useState<{ roomCode: string; current: number; max: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(!!document.fullscreenElement);
  const [isRewardAdLoading, setIsRewardAdLoading] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomCodeError, setRoomCodeError] = useState<string | null>(null);
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);
  const gptLoadPromiseRef = useRef<Promise<void> | null>(null);
  const gptServicesEnabledRef = useRef(false);
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

  const bumpRoomsRefreshing = (delta: number) => {
    roomsRefreshDepthRef.current = Math.max(0, roomsRefreshDepthRef.current + delta);
    setIsRoomsRefreshing(roomsRefreshDepthRef.current > 0);
  };

  const fetchRooms = async (opts?: { background?: boolean }) => {
    const background = !!opts?.background;
    if (background) {
      bumpRoomsRefreshing(1);
    } else {
      setIsRoomsLoading(true);
    }
    try {
      if (!user?.id) {
        setContinueRoomIdsServer([]);
        setServerVisitAtMs(new Map());
      } else {
        const token =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("puzzle_access_token")
            : null;
        if (!token) {
          setContinueRoomIdsServer([]);
          setServerVisitAtMs(new Map());
        } else {
          const visitsRes = await fetch(apiUrl("/api/user/room-visits"), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (visitsRes.ok) {
            const body = (await visitsRes.json()) as {
              visits?: { room_id: unknown; last_visited_at: unknown }[];
            };
            const visits = body.visits ?? [];
            if (visits.length) {
              const { orderedIds, atMs } = parseServerVisits(visits);
              setContinueRoomIdsServer(orderedIds);
              setServerVisitAtMs(atMs);
            } else {
              setContinueRoomIdsServer([]);
              setServerVisitAtMs(new Map());
            }
          } else {
            setContinueRoomIdsServer([]);
            setServerVisitAtMs(new Map());
          }
        }
      }

      const token =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("puzzle_access_token")
          : null;
      const summaryRes = await fetch(apiUrl("/api/rooms/summary"), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!summaryRes.ok) {
        console.error(`Failed to fetch room summary: HTTP ${summaryRes.status}`);
        setActiveRooms([]);
        setCompletedRooms([]);
        return;
      }
      const summary = (await summaryRes.json()) as {
        activeRooms?: any[];
        completedRooms?: any[];
      };
      setActiveRooms(Array.isArray(summary.activeRooms) ? summary.activeRooms : []);
      setCompletedRooms(Array.isArray(summary.completedRooms) ? summary.completedRooms : []);
    } finally {
      if (background) {
        bumpRoomsRefreshing(-1);
      } else {
        setIsRoomsLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchRooms({ background: false });

    // Subscribe to changes
    const channel = supabase.channel('public:rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => {
        void fetchRooms({ background: true });
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

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

    const resolvedPieceCount = await resolvePieceCountFromImage(currentImageUrl, pieceCount);
    const insertRow: Record<string, unknown> = {
      creator_name: creatorName,
      image_url: currentImageUrl,
      piece_count: resolvedPieceCount,
      difficulty,
      max_players: maxPlayers,
      status: 'active',
      has_password: !!password.trim(),
      is_private: isPrivate,
    };
    if (user?.id) insertRow.created_by = user.id;

    const { data, error } = await supabase.from('rooms').insert([insertRow]).select();

    if (data && data.length > 0) {
      const roomId = data[0].id;
      if (!user?.id) pushGuestCreatedRoomId(roomId);
      if (user?.id) void recordUserRoomVisit(roomId);
      const recentRooms = JSON.parse(localStorage.getItem('puzzle_recent_rooms') || '[]');
      const newRecent = [roomId, ...recentRooms.filter((id: number) => id !== roomId)].slice(0, 10);
      localStorage.setItem('puzzle_recent_rooms', JSON.stringify(newRecent));
      const doEnter = () =>
        onJoinRoom(roomId, data[0].image_url, resolvedPieceCount, normalizePuzzleDifficulty((data[0] as any).difficulty ?? difficulty));
      if (tossUi) {
        const ok = await runTossRewardedRoomEntry(roomId, doEnter);
        if (!ok) {
          alert(
            isKo
              ? '보상형 광고를 끝까지 시청하면 퍼즐방으로 이동할 수 있어요.'
              : 'Watch the rewarded ad through to enter your puzzle room.'
          );
        }
      } else {
        doEnter();
      }
    } else if (error) {
      console.error('Error creating room:', error);
      alert("방 생성에 실패했습니다.");
    }
    setIsCreating(false);
  };

  const ensureGptLoaded = async () => {
    if (typeof window === 'undefined') {
      throw new Error('Browser environment is required.');
    }

    if (window.googletag?.apiReady) {
      console.info(`${REWARDED_DEBUG_PREFIX} GPT already ready`);
      return;
    }
    if (gptLoadPromiseRef.current) {
      await gptLoadPromiseRef.current;
      return;
    }

    gptLoadPromiseRef.current = new Promise<void>((resolve, reject) => {
      window.googletag = window.googletag || { cmd: [] };

      const existing = document.getElementById(GPT_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) {
        if (window.googletag?.apiReady) {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load GPT script.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = GPT_SCRIPT_ID;
      script.async = true;
      script.src = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load GPT script.'));
      document.head.appendChild(script);
    });

    await gptLoadPromiseRef.current;
    console.info(`${REWARDED_DEBUG_PREFIX} GPT script loaded`);
  };

  const showRewardedAdAndWait = async () => {
    console.info(`${REWARDED_DEBUG_PREFIX} start`, { adUnitPath: WEB_REWARDED_AD_UNIT_PATH });
    await ensureGptLoaded();

    return await new Promise<boolean>((resolve) => {
      const gt = window.googletag;
      if (!gt) {
        console.warn(`${REWARDED_DEBUG_PREFIX} googletag missing after load`);
        resolve(false);
        return;
      }

      gt.cmd.push(() => {
        const pubads = gt.pubads();
        const rewardedSlot = gt.defineOutOfPageSlot(
          WEB_REWARDED_AD_UNIT_PATH,
          gt.enums?.OutOfPageFormat?.REWARDED
        );

        if (!rewardedSlot) {
          console.warn(`${REWARDED_DEBUG_PREFIX} defineOutOfPageSlot returned null`);
          resolve(false);
          return;
        }
        console.info(`${REWARDED_DEBUG_PREFIX} slot created`);

        rewardedSlot.addService(pubads);

        let rewardGranted = false;
        let finalized = false;
        const finalize = (ok: boolean) => {
          if (finalized) return;
          finalized = true;
          try {
            pubads.removeEventListener('rewardedSlotReady', onReady);
            pubads.removeEventListener('rewardedSlotGranted', onGranted);
            pubads.removeEventListener('rewardedSlotClosed', onClosed);
            gt.destroySlots([rewardedSlot]);
          } catch {
            // noop
          }
          console.info(`${REWARDED_DEBUG_PREFIX} finalized`, { ok, rewardGranted });
          resolve(ok);
        };

        const onReady = (event: any) => {
          if (event.slot !== rewardedSlot) return;
          console.info(`${REWARDED_DEBUG_PREFIX} rewardedSlotReady`);
          try {
            event.makeRewardedVisible();
            console.info(`${REWARDED_DEBUG_PREFIX} makeRewardedVisible called`);
          } catch {
            console.error(`${REWARDED_DEBUG_PREFIX} makeRewardedVisible failed`);
            finalize(false);
          }
        };
        const onGranted = (event: any) => {
          if (event.slot !== rewardedSlot) return;
          rewardGranted = true;
          console.info(`${REWARDED_DEBUG_PREFIX} rewardedSlotGranted`);
        };
        const onClosed = (event: any) => {
          if (event.slot !== rewardedSlot) return;
          console.info(`${REWARDED_DEBUG_PREFIX} rewardedSlotClosed`);
          finalize(rewardGranted);
        };

        pubads.addEventListener('rewardedSlotReady', onReady);
        pubads.addEventListener('rewardedSlotGranted', onGranted);
        pubads.addEventListener('rewardedSlotClosed', onClosed);

        if (!gptServicesEnabledRef.current) {
          gt.enableServices();
          gptServicesEnabledRef.current = true;
          console.info(`${REWARDED_DEBUG_PREFIX} enableServices`);
        }

        console.info(`${REWARDED_DEBUG_PREFIX} display slot`);
        gt.display(rewardedSlot);

        window.setTimeout(() => {
          console.warn(`${REWARDED_DEBUG_PREFIX} timeout`);
          finalize(false);
        }, 25000);
      });
    });
  };

  const handleCreateRoomWithReward = async () => {
    if (tossUi) {
      await handleCreateRoom();
      return;
    }

    console.info(`${REWARDED_DEBUG_PREFIX} create-room button clicked (web mode)`);
    setIsRewardAdLoading(true);
    const rewarded = await showRewardedAdAndWait().catch((err) => {
      console.error('Rewarded ad failed:', err);
      return false;
    });
    setIsRewardAdLoading(false);
    console.info(`${REWARDED_DEBUG_PREFIX} rewarded result`, { rewarded });

    if (!rewarded) {
      alert(isKo ? '광고를 끝까지 시청하면 방을 만들 수 있어요.' : 'Please finish watching the ad to create a room.');
      return;
    }

    await handleCreateRoom();
  };

  const handleCreateRoomClick = async () => {
    if (!tossUi && ENABLE_WEB_REWARDED_GATE) {
      await handleCreateRoomWithReward();
      return;
    }
    await handleCreateRoom();
  };

  const proceedAfterJoinChecks = async (
    room: any,
    opts?: { skipTossRewardedAd?: boolean }
  ) => {
    if (room.has_password) {
      const pwd = prompt(isKo ? '방 비밀번호를 입력하세요:' : 'Enter room password:');
      if (pwd === null) return;
    }

    const recentRooms = JSON.parse(localStorage.getItem('puzzle_recent_rooms') || '[]');
    const newRecent = [room.id, ...recentRooms.filter((id: number) => id !== room.id)].slice(0, 10);
    localStorage.setItem('puzzle_recent_rooms', JSON.stringify(newRecent));

    if (user?.id) void recordUserRoomVisit(room.id);

    const enter = () => {
      onJoinRoom(
        room.id,
        room.image_url,
        room.totalPieces || room.piece_count,
        normalizePuzzleDifficulty(room.difficulty)
      );
      setRoomCodeInput("");
      setRoomCodeError(null);
    };

    const skipAd = !!opts?.skipTossRewardedAd;
    if (tossUi && !skipAd) {
      setIsRewardAdLoading(true);
      try {
        const ok = await runTossRewardedRoomEntry(room.id, enter);
        if (!ok) {
          alert(
            isKo
              ? '보상형 광고를 끝까지 시청하면 입장할 수 있어요.'
              : 'Watch the rewarded ad through to join the room.'
          );
        }
      } finally {
        setIsRewardAdLoading(false);
      }
    } else {
      enter();
    }
  };

  const handleJoinSpecificRoom = async (
    room: any,
    opts?: { skipTossRewardedAd?: boolean }
  ) => {
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

    await proceedAfterJoinChecks(room, opts);
  };

  const handleJoinByRoomCode = async () => {
    setRoomCodeError(null);
    const trimmed = roomCodeInput.trim();
    if (!trimmed) {
      setRoomCodeError(isKo ? '방 번호를 입력해 주세요.' : 'Enter a room code.');
      return;
    }
    const id = parseRoomNumberOrCode(roomCodeInput);
    if (id == null) {
      setRoomCodeError(
        isKo
          ? '방 번호 형식이 올바르지 않습니다. (6자 코드 또는 숫자 ID)'
          : 'Invalid code. Use the 6-character code or a numeric room ID.'
      );
      return;
    }

    setIsJoiningByCode(true);
    const { data, error } = await supabase.from('rooms').select('*').eq('id', id).maybeSingle();
    setIsJoiningByCode(false);

    if (error) {
      console.error('Join by room code:', error);
      setRoomCodeError(isKo ? '방 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : 'Could not load the room. Please try again.');
      return;
    }
    if (!data) {
      setRoomCodeError(isKo ? '해당 번호의 방을 찾을 수 없습니다.' : 'No room found with that code.');
      return;
    }

    await handleJoinSpecificRoom(
      { ...data },
      { skipTossRewardedAd: data.status === "completed" }
    );
  };

  const tossLight = !!tossUi;
  /** 토스 보상형 광고 게이트 진행 중(다른 입장·코드 입력과 겹치지 않게 버튼 비활성화) */
  const tossRewardGateBusy = !!tossUi && isRewardAdLoading;

  const showActiveRoomsLoading =
    activeRooms.length === 0 && (isRoomsLoading || isRoomsRefreshing);
  const showCompletedRoomsLoading =
    completedRooms.length === 0 && (isRoomsLoading || isRoomsRefreshing);

  const tossJoinCtaLabel = (roomId: number) => {
    if (tossRewardGateBusy) return isKo ? "대기 중…" : "Wait…";
    if (!tossUi) return isKo ? "입장" : "Join";
    if (hasTossRewardAdBeenSeenForRoom(roomId)) return isKo ? "입장" : "Join";
    return isKo ? "광고 시청 후 입장" : "Join after ad";
  };
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
      className={`relative box-border flex flex-col ${
        tossUi
          ? "h-[100dvh] max-h-[100dvh] min-h-0 overflow-hidden bg-[#F4F8FF]"
          : "min-h-[100dvh] min-h-screen bg-slate-950"
      }`}
    >
      <div
        className={`relative flex w-full flex-1 min-h-0 flex-col items-center overflow-y-auto overflow-x-hidden ${
          !tossUi ? "pt-20 pb-12 px-4" : ""
        }`}
        style={
          tossUi
            ? {
                paddingTop: tossUi.safeArea.top + 12,
                paddingBottom:
                  tossUi.safeArea.bottom +
                  TOSS_LOBBY_BANNER_SLOT_H +
                  TOSS_LOBBY_BANNER_VERTICAL_PAD,
              }
            : undefined
        }
      >
      {!tossUi ? (
        <div className="fixed top-0 left-0 w-full z-50 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50 p-2 sm:p-3 flex items-center justify-between text-white">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center bg-indigo-500/10 w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-indigo-500/20 shrink-0">
              <svg
                width="24"
                height="24"
                viewBox="-20 -30 200 200"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-indigo-400"
              >
                <path d="M25.18,11.87c0,20.95,13.8,42.39,4.85,42.68-8.95.29-11.99-6.96-17.69-6.96s-8.34,4.77-8.34,18.59,2.64,18.59,8.34,18.59,8.74-7.24,17.69-6.96c8.95.29-4.85,21.73-4.85,42.68,20.95,0,42.39,13.8,42.68,4.85.29-8.95-6.96-11.99-6.96-17.69s4.77-8.34,18.59-8.34,18.59,2.64,18.59,8.34-7.24,8.74-6.96,17.69c.29,8.95,21.73-4.85,42.68-4.85,0-20.95-13.8-42.39-4.85-42.68s11.99,6.96,17.69,6.96,8.34-4.77,8.34-18.59-2.64-18.59-8.34-18.59-8.74,7.24-17.69,6.96c-8.95-.29,4.85-21.73,4.85-42.68-20.95,0-42.39-13.8-42.68-4.85s6.96,11.99,6.96,17.69-4.77,8.34-18.59,8.34-18.59-2.64-18.59-8.34,7.24-8.74,6.96-17.69c-.29-8.95-21.73,4.85-42.68,4.85Z"/>
              </svg>
            </div>
            <span className="font-bold text-sm sm:text-base">{isKo ? "퍼즐록스" : "puzzlox"}</span>
          </div>
          {headerActions}
        </div>
      ) : null}

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full grid grid-cols-1 gap-6 max-w-7xl lg:grid-cols-3 md:grid-cols-2"
        style={
          tossUi
            ? { ...tossContentPadX, paddingTop: 6, boxSizing: "border-box" as const }
            : undefined
        }
      >
        {/* Left Column: Create/Join Form */}
        <div
          className="text-center h-fit px-1"
        >
          {!tossUi && (
            <>
              <h1 className={`text-3xl font-bold mb-2 ${tossSkin ? tossSkin.heading : "text-white"}`}>
                {isKo ? "퍼즐록스" : "puzzlox"}
              </h1>
              <p className={`mb-4 ${tossSkin ? tossSkin.body : "text-slate-400"}`}>
                {isKo
                  ? "새 퍼즐방을 만들고 친구를 초대해 보세요!"
                  : "Create a new puzzle room and invite friends!"}
              </p>
            </>
          )}

          {tossUi ? (
            <div
              className="mb-4 rounded-xl border border-[#D9E8FF] bg-[#EAF2FF]/90 px-3 py-2.5 text-left text-xs leading-relaxed text-slate-700"
              role="note"
            >
              <p className="mb-1 font-semibold text-slate-900">
                {isKo ? "보상형 광고 안내" : "Rewarded video"}
              </p>
              <p>
                {isKo
                  ? "방을 처음 만들거나, 진행 중인 방을 이 기기에서 처음 열 때만 짧은 보상형 광고를 시청한 뒤 퍼즐방으로 이동해요. 완료된 퍼즐방은 광고 없이 바로 들어가요. 같은 방은 한 번 시청하면 이 기기에서는 다시 나오지 않아요."
                  : "A short rewarded ad plays only when you create a room or open an active room for the first time on this device. Completed puzzles open with no ad. Each room only asks once on this device."}
              </p>
            </div>
          ) : null}

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

            <div>
              <label
                className={`block text-sm font-medium mb-2 flex items-center gap-2 ${
                  tossSkin ? tossSkin.label : "text-slate-300"
                }`}
              >
                <ShieldAlert className="w-4 h-4" /> {isKo ? "난이도" : "Difficulty"}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PUZZLE_DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${
                      difficulty === d
                        ? tossSkin
                          ? tossSkin.pillOn
                          : "bg-indigo-500 text-white"
                        : tossSkin
                          ? tossSkin.pillOff
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    }`}
                  >
                    {puzzleDifficultyLabel(d, isKo)}
                  </button>
                ))}
              </div>
              <p className={`text-xs mt-2 ${tossSkin ? tossSkin.empty : "text-slate-500"}`}>
                {difficulty === "easy"
                  ? (isKo
                      ? "초급: 퍼즐판에 20% 투명 밑그림이 항상 표시됩니다."
                      : "Easy: 20% transparent guide image is always visible.")
                  : difficulty === "medium"
                  ? (isKo
                      ? "중급: 전체 20% 밑그림이 보이며, 진행도 5%마다 투명도가 1%씩 감소합니다."
                      : "Medium: full 20% guide is shown, and opacity drops by 1% every 5% progress.")
                  : difficulty === "hard"
                  ? (isKo
                      ? "고급: 밑그림 없음. 내부 조각은 테두리/고정 체인과 연결될 때만 정위치 고정됩니다."
                      : "Hard: no guide; inner pieces lock only when connected to border/locked chain.")
                  : (isKo
                      ? "악몽: 고급 규칙 + 조각 회전/앞면 뒤집기. 시작 시 일부 조각이 뒤집히고 회전됩니다."
                      : "Nightmare: hard rules + piece rotation/front-side flip. Pieces start partially flipped and rotated.")}
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
            onClick={handleCreateRoomClick}
            disabled={
              isCreating ||
              (ENABLE_WEB_REWARDED_GATE && isRewardAdLoading) ||
              tossRewardGateBusy ||
              (!user && !guestName.trim())
            }
            className={`w-full font-medium py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors ${
              tossSkin
                ? `${tossSkin.primaryBtn} disabled:bg-slate-200 disabled:text-slate-400`
                : "bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white"
            }`}
          >
            <Plus className="w-5 h-5" />
            {isCreating || (ENABLE_WEB_REWARDED_GATE && isRewardAdLoading)
              ? (isKo ? "생성 중…" : "Creating…")
              : tossRewardGateBusy
                ? (isKo ? "대기 중…" : "Please wait…")
                : tossUi
                  ? isKo
                    ? "광고 시청 후 방 만들기"
                    : "Create room after ad"
                  : isKo
                    ? "방 만들기"
                    : "Create room"}
          </button>

          <div className="mt-4 text-left space-y-2">
            <label
              className={`block text-sm font-medium flex items-center gap-2 ${
                tossSkin ? tossSkin.label : "text-slate-300"
              }`}
            >
              <Play className="w-4 h-4 shrink-0" />
              {isKo ? "방 번호로 입장" : "Join by room code"}
            </label>
            {tossUi ? (
              <p className={`mb-1 text-left text-xs leading-snug ${tossSkin ? "text-slate-600" : "text-slate-500"}`}>
                {isKo
                  ? "해당 방을 이 기기에서 처음 열 때만 광고가 나와요. (목록의 입장 버튼 문구를 참고해 주세요.)"
                  : "An ad plays only the first time you open that room on this device. See the list button label for whether an ad is needed."}
              </p>
            ) : null}
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value={roomCodeInput}
                onChange={(e) => {
                  setRoomCodeInput(e.target.value);
                  setRoomCodeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !isJoiningByCode && !tossRewardGateBusy) void handleJoinByRoomCode();
                }}
                disabled={isJoiningByCode || tossRewardGateBusy}
                placeholder={isKo ? "6자 코드 또는 방 ID" : "6-letter code or room ID"}
                className={`min-w-0 flex-1 rounded-xl p-3 text-sm focus:outline-none ${
                  tossSkin
                    ? tossSkin.input
                    : "bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:border-indigo-500"
                }`}
              />
              <button
                type="button"
                onClick={() => void handleJoinByRoomCode()}
                disabled={isJoiningByCode || tossRewardGateBusy}
                className={`shrink-0 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  tossSkin
                    ? `${tossSkin.primaryBtn} disabled:bg-slate-200 disabled:text-slate-400`
                    : "bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-800 disabled:text-slate-500 text-white"
                }`}
              >
                {isJoiningByCode
                  ? (isKo ? "확인 중…" : "Checking…")
                  : tossRewardGateBusy
                    ? (isKo ? "대기 중…" : "Wait…")
                    : tossUi
                      ? isKo
                        ? "방 확인 후 입장"
                        : "Look up & join"
                      : isKo
                        ? "입장"
                        : "Join"}
              </button>
            </div>
            {roomCodeError ? (
              <p className={`text-sm ${tossSkin ? "text-red-600" : "text-red-400"}`} role="alert">
                {roomCodeError}
              </p>
            ) : null}
          </div>
        </div>

        {/* Middle Column: Active Rooms Gallery */}
        <div
          className="flex flex-col h-[600px]"
        >
          <div
            className={`mb-3 pb-3 border-b ${
              tossSkin ? "border-[#D9E8FF]" : "border-slate-800/80"
            }`}
          >
            <div className="flex items-center justify-between gap-2 min-h-[40px]">
              <h2
                className={`text-xl font-bold flex items-center gap-2 min-w-0 ${
                  tossSkin ? tossSkin.heading : "text-white"
                }`}
              >
                <Grid className={`w-5 h-5 shrink-0 ${tossSkin ? tossSkin.subtleIcon : "text-indigo-400"}`} />
                {isKo ? "진행 중인 퍼즐방" : "Active Puzzle Rooms"}
              </h2>
              <button
                type="button"
                onClick={() => void fetchRooms({ background: true })}
                disabled={isRoomsRefreshing}
                className={`shrink-0 transition-colors p-2 rounded-lg disabled:opacity-60 ${
                  tossSkin
                    ? "text-slate-500 hover:text-[#2F6FE4] hover:bg-[#EAF2FF]"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
                title={isKo ? "목록 새로고침" : "Refresh room list"}
                aria-busy={isRoomsRefreshing}
              >
                <RefreshCw size={18} className={isRoomsRefreshing ? "animate-spin" : undefined} />
              </button>
            </div>
            {tossUi ? (
              <p className={`mt-2 text-left text-xs leading-snug ${tossSkin ? "text-slate-600" : "text-slate-500"}`}>
                {isKo
                  ? "입장 버튼에 ‘광고 시청 후 입장’이 보이면, 시청 후 방으로 들어가요."
                  : 'If the button says “Join after ad”, you’ll watch a short ad before entering.'}
              </p>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
            {showActiveRoomsLoading ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <div className={`w-8 h-8 rounded-full border-2 animate-spin ${
                  tossSkin ? "border-[#D9E8FF] border-t-[#2F6FE4]" : "border-slate-700 border-t-indigo-400"
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
            ) : (() => {
              let localContinueIds: number[] = [];
              try {
                const raw = localStorage.getItem("puzzle_recent_rooms");
                const parsed = raw ? JSON.parse(raw) : [];
                localContinueIds = Array.isArray(parsed)
                  ? parsed.filter((x: unknown): x is number => typeof x === "number")
                  : [];
              } catch {
                localContinueIds = [];
              }
              const continueRoomOrder = mergeContinueRoomOrder(continueRoomIdsServer, localContinueIds);
              const continueSet = new Set(continueRoomOrder);
              const displayActiveRooms = sortActiveRoomsForLobby(
                activeRooms,
                user,
                continueRoomOrder,
                serverVisitAtMs
              );
              return displayActiveRooms.map((room) => (
                <div
                  key={room.id}
                  className={`group h-[224px] rounded-2xl overflow-hidden transition-all duration-300 border flex flex-col ${
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
                      className={`pointer-events-none absolute inset-0 bg-gradient-to-t ${
                        tossSkin ? "from-[#F4F8FF] via-transparent to-transparent" : "from-slate-950 to-transparent"
                      }`}
                    />
                    <div className="pointer-events-none absolute top-2 left-2 z-10 flex flex-col gap-1 items-start max-w-[calc(100%-1rem)]">
                      {roomIsMine(room, user) && (
                        <span
                          className={`backdrop-blur-sm text-[10px] font-semibold px-2 py-0.5 rounded-md border leading-tight ${
                            tossSkin
                              ? "bg-white/95 text-[#2F6FE4] border-[#D9E8FF]"
                              : "bg-slate-900/90 text-indigo-300 border-slate-600"
                          }`}
                        >
                          {isKo ? "내 방" : "My room"}
                        </span>
                      )}
                      {!roomIsMine(room, user) && continueSet.has(room.id) && (
                        <span
                          className={`backdrop-blur-sm text-[10px] font-semibold px-2 py-0.5 rounded-md border leading-tight ${
                            tossSkin
                              ? "bg-white/95 text-slate-800 border-[#D9E8FF]"
                              : "bg-slate-900/90 text-slate-200 border-slate-600"
                          }`}
                        >
                          {isKo ? "이어하기" : "Continue"}
                        </span>
                      )}
                    </div>
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
                    className={`p-3 h-[88px] flex items-center justify-between ${
                      tossSkin ? "bg-white" : ""
                    }`}
                  >
                    <div className="text-left flex-1 min-w-0">
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
                      type="button"
                      onClick={() => void handleJoinSpecificRoom(room)}
                      disabled={tossRewardGateBusy}
                      className={`max-w-[min(11rem,46%)] h-9 px-3 rounded-xl text-sm font-medium transition-colors leading-tight whitespace-nowrap shrink-0 ${
                        tossSkin ? tossSkin.joinBtn : "bg-indigo-500/10 hover:bg-indigo-500 text-indigo-400 hover:text-white"
                      } disabled:opacity-50 disabled:pointer-events-none`}
                    >
                      {tossJoinCtaLabel(room.id)}
                    </button>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Right Column: Completed Rooms Gallery */}
        <div
          className="flex flex-col h-[600px] md:col-span-2 lg:col-span-1"
        >
          <div
            className={`mb-3 pb-3 border-b ${
              tossSkin ? "border-[#D9E8FF]" : "border-slate-800/80"
            }`}
          >
            <div className="flex items-center justify-between gap-2 min-h-[40px]">
              <h2
                className={`text-xl font-bold flex items-center gap-2 min-w-0 ${
                  tossSkin ? tossSkin.heading : "text-white"
                }`}
              >
                <Trophy className={`w-5 h-5 ${tossSkin ? tossSkin.subtleIcon : "text-amber-400"}`} />
                {isKo ? "완료된 퍼즐방" : "Completed Puzzles"}
              </h2>
              {/* Height/spacing parity with left header refresh button */}
              <span className="w-[34px] h-[34px] shrink-0" aria-hidden="true" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {showCompletedRoomsLoading ? (
              <div
                className={`h-full flex flex-col items-center justify-center ${
                  tossSkin ? tossSkin.empty : "text-slate-500"
                }`}
              >
                <div className={`w-8 h-8 rounded-full border-2 animate-spin ${
                  tossSkin ? "border-[#D9E8FF] border-t-[#2F6FE4]" : "border-slate-700 border-t-amber-400"
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
                    className={`group h-[224px] rounded-2xl overflow-hidden transition-all duration-300 border flex flex-col ${
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
                    <div className={`p-3 h-[88px] flex items-center justify-between ${tossSkin ? "bg-white" : ""}`}>
                      <div className="text-left flex-1 min-w-0">
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
                          {new Date(room.completed_at || room.created_at).toLocaleDateString()}
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
                        type="button"
                        onClick={() => void handleJoinSpecificRoom(room, { skipTossRewardedAd: true })}
                        disabled={tossRewardGateBusy}
                        className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                          tossSkin ? tossSkin.viewBtn : "bg-amber-500/10 hover:bg-amber-500 text-amber-400 hover:text-white"
                        } disabled:opacity-50 disabled:pointer-events-none`}
                      >
                        {tossRewardGateBusy ? (isKo ? "대기 중…" : "Wait…") : isKo ? "보기" : "View"}
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
      {tossUi ? (
        <TossLobbyBottomBanner
          safeAreaBottom={tossUi.safeArea.bottom}
          safeAreaLeft={tossUi.safeArea.left}
          safeAreaRight={tossUi.safeArea.right}
        />
      ) : null}
    </div>
  );
};

export default Lobby;


