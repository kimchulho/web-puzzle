import React, {
  type CSSProperties,
  type MutableRefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import * as PIXI from 'pixi.js';
import { throttle } from 'lodash';
import { Clock, Users, Trophy, ChevronLeft, X, Palette, LayoutGrid, Zap, Heart, Image as ImageIcon, Bot, Maximize, Minimize, RotateCcw, Share2, Check, Plus, Minus } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { ROOM_EVENTS, SyncTimePayload } from "@contracts/realtime";
import { REALTIME_CHANNEL_STATES } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { encodeRoomId } from '../lib/roomCode';
import { recordUserRoomVisit } from '../lib/recordUserRoomVisit';

const SNAP_THRESHOLD = 30;
/** 와이드 툴바–퍼즐 사이 빈 줄(측정·라운딩·DP) 보정: 퍼즐 inset 을 살짝 줄임 */
const TOSS_WIDE_PUZZLE_INSET_TRIM_PX = 3;
const TOSS_WIDE_TOOLBAR_WIDTH_FALLBACK_PX = 44;
const MINI_PAD_VISIBLE_STORAGE_KEY = 'puzzle_show_mini_pad';
const TOSS_WIDE_MODE_STORAGE_KEY = 'puzzle_toss_wide_mode';
const readStoredBool = (key: string, fallback: boolean) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // Ignore storage access errors.
  }
  return fallback;
};
const isBotLikeUser = (name: unknown) =>
  typeof name === 'string' && /(bot|봇)/i.test(name.trim());

/** Pixi `RendererType.CANVAS` (pixi.js `rendering/renderers/types.d.ts`) */
const PIXI_RENDERER_TYPE_CANVAS = 4;

const PUZZLE_LOADING_STAGES_KO = [
  "종이 가져오는 중",
  "인쇄하는 중",
  "합지 하는 중",
  "목형 만드는 중",
  "프레스로 찍는 중",
  "퍼즐 조각 터는 중",
  "퍼즐 배송중",
] as const;

const PUZZLE_LOADING_STAGES_EN = [
  "Fetching paper…",
  "Printing…",
  "Mounting sheets…",
  "Cutting the die…",
  "Running the press…",
  "Punching pieces…",
  "Out for delivery…",
] as const;

function puzzleLoadingStageIndex(progress: number, stageCount: number) {
  if (progress >= 100) return stageCount - 1;
  return Math.min(stageCount - 1, Math.floor((progress / 100) * stageCount));
}

function PuzzleLoadingSpinner({ toss }: { toss: boolean }) {
  const track = toss ? "#EAF2FF" : "rgba(148, 163, 184, 0.4)";
  const head = toss ? "#3182F6" : "#6366f1";
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={{ display: "block" }} aria-hidden>
      <circle cx="20" cy="20" r="16" fill="none" stroke={track} strokeWidth="3" />
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 20 20"
          to="360 20 20"
          dur="0.85s"
          repeatCount="indefinite"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={head}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="25 100"
        />
      </g>
    </svg>
  );
}

export default function PuzzleBoard({
  roomId,
  imageUrl,
  pieceCount,
  onBack,
  user,
  setUser,
  /** 앱인토스 WebView 등: `setDeviceOrientation`으로 대체 (기본 HTML API는 WebView에서 실패하는 경우가 많음) */
  onToggleOrientation,
  /** 앱인토스: SafeAreaInsets + 우측 네이티브 …/닫기 영역 — 상단바 겹침 완화 */
  hostWebViewPadding,
  /**
   * 앱인토스: 네비 액세서리 탭 시 리더보드 토글. 넘기면 인앱 트로피 버튼은 숨김(중복 방지).
   */
  hostLeaderboardToggleRef,
  locale = 'ko',
}: {
  roomId: number;
  imageUrl: string;
  pieceCount: number;
  onBack: () => void;
  user: any;
  setUser: (user: any) => void;
  onToggleOrientation?: () => void | Promise<void>;
  hostWebViewPadding?: { top: number; right: number; left: number };
  hostLeaderboardToggleRef?: MutableRefObject<(() => void) | null>;
  locale?: 'ko' | 'en';
}) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const app = useRef<PIXI.Application | null>(null);
  const pieces = useRef<Map<number, PIXI.Container>>(new Map());
  const channelRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const mainTextureRef = useRef<PIXI.Texture | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const gatherBordersRef = useRef<(() => void) | null>(null);
  const gatherByColorRef = useRef<((quick?: boolean) => void) | null>(null);
  const createMosaicFromImageRef = useRef<((imageUrl: string, quick?: boolean, gapMultiplier?: number) => Promise<void>) | null>(null);
  const initialPositionsRef = useRef<{x: number, y: number}[]>([]);
  const isBotRunningRef = useRef(false);
  const isColorBotRunningRef = useRef(false);
  const isCompletedRef = useRef(false);
  const worldRef = useRef<PIXI.Container | null>(null);
  const miniPadDragRef = useRef<{ x: number, y: number, isDragging: boolean, moved: boolean } | null>(null);
  const zoomPadDragRef = useRef<{ x: number, isDragging: boolean } | null>(null);

  const [placedPieces, setPlacedPieces] = useState(0);
  const [totalPieces, setTotalPieces] = useState(pieceCount);
  const [playerCount, setPlayerCount] = useState(1);
  const [playTime, setPlayTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  /** 0–100, 휴리스틱(실제 시간과 다를 수 있음) */
  const [loadProgress, setLoadProgress] = useState(0);
  const [imageLoadError, setImageLoadError] = useState<string | null>(null);
  const [isColorBotLoading, setIsColorBotLoading] = useState(false);
  const [scores, setScores] = useState<{username: string, score: number}[]>([]);
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set());
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showBotMenu, setShowBotMenu] = useState(false);
  const [showMosaicModal, setShowMosaicModal] = useState(false);
  const [mosaicError, setMosaicError] = useState<string | null>(null);
  const [showFullImage, setShowFullImage] = useState(false);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [showMiniPad, setShowMiniPad] = useState(() => readStoredBool(MINI_PAD_VISIBLE_STORAGE_KEY, true));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mosaicUrl, setMosaicUrl] = useState("https://ewbjogsolylcbfmpmyfa.supabase.co/storage/v1/object/public/checki/2.jpg");
  const [mosaicQuick, setMosaicQuick] = useState(false);
  const [mosaicGap, setMosaicGap] = useState(1.6);
  const [bgColor, setBgColor] = useState('#1e293b'); // default slate-800
  const [maxPlayers, setMaxPlayers] = useState(8);
  const isKo = locale === 'ko';
  const [isCopied, setIsCopied] = useState(false);
  const [isTossWideMode, setIsTossWideMode] = useState(false);
  const tossWidePrefHydratedRef = useRef(false);
  const skipNextTossWideSaveRef = useRef(false);
  /** 가로(와이드) 툴바 getBoundingClientRect().width (회전 후 화면상 두께, CSS px). 0 = 아직 측정 전 */
  const [tossWideToolbarWidth, setTossWideToolbarWidth] = useState(0);
  const tossWideToolbarMeasureRef = useRef<HTMLDivElement | null>(null);

  const handleShareLink = () => {
    const url = `${window.location.origin}/?room=${encodeRoomId(roomId)}`;
    navigator.clipboard.writeText(url).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const PRESET_COLORS = [
    '#0f172a', // slate-900
    '#1e293b', // slate-800
    '#475569', // slate-600
    '#94a3b8', // slate-400
    '#171717', // neutral-900
    '#1c1917', // stone-900
    '#020617', // slate-950
    '#3b0764', // purple-900
    '#064e3b', // emerald-900
    '#7f1d1d', // red-900
    '#1e3a8a', // blue-900
    '#ffffff', // white
  ];

  // 로컬 타이머 보간을 위한 Ref
  const accumulatedTimeRef = useRef(0);
  const isRunningRef = useRef(false);
  const localStartTimeRef = useRef(0);

  const activeUsersRef = useRef<Set<string>>(new Set());
  const isTossMode = Boolean(hostWebViewPadding);
  useEffect(() => {
    activeUsersRef.current = activeUsers;
  }, [activeUsers]);

  useEffect(() => {
    if (!hostLeaderboardToggleRef) return;
    const ref = hostLeaderboardToggleRef;
    ref.current = () => setShowLeaderboard((v) => !v);
    return () => {
      ref.current = null;
    };
  }, [hostLeaderboardToggleRef]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MINI_PAD_VISIBLE_STORAGE_KEY, showMiniPad ? '1' : '0');
    } catch {
      // noop
    }
  }, [showMiniPad]);

  useEffect(() => {
    if (!isTossMode) {
      tossWidePrefHydratedRef.current = false;
      skipNextTossWideSaveRef.current = false;
      return;
    }
    skipNextTossWideSaveRef.current = true;
    setIsTossWideMode(readStoredBool(TOSS_WIDE_MODE_STORAGE_KEY, false));
    tossWidePrefHydratedRef.current = true;
  }, [isTossMode]);

  useEffect(() => {
    if (!isTossMode || !tossWidePrefHydratedRef.current) return;
    if (skipNextTossWideSaveRef.current) {
      skipNextTossWideSaveRef.current = false;
      return;
    }
    try {
      localStorage.setItem(TOSS_WIDE_MODE_STORAGE_KEY, isTossWideMode ? '1' : '0');
    } catch {
      // noop
    }
  }, [isTossMode, isTossWideMode]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Error attempting to toggle fullscreen:", err);
    }
  };

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

  const handleOrientationButton = async () => {
    if (onToggleOrientation) {
      await onToggleOrientation();
      return;
    }
    await toggleOrientation();
  };

  const hostToolbarPadding = hostWebViewPadding
    ? {
        paddingTop: hostWebViewPadding.top,
        paddingRight: hostWebViewPadding.right,
        paddingLeft: hostWebViewPadding.left,
      }
    : undefined;
  const tossToolbarPadding = hostWebViewPadding
    ? {
        // Keep horizontal inset perfectly symmetric in Toss mode.
        paddingInline: Math.max(
          hostWebViewPadding.left + 4,
          Math.max(0, hostWebViewPadding.right - 28),
        ),
        // Top gap felt too large under Toss native bar; pull toolbar closer.
        paddingTop: isTossWideMode ? 0 : Math.max(0, hostWebViewPadding.top - 20),
      }
    : undefined;

  useLayoutEffect(() => {
    if (!isTossMode || !isTossWideMode) return;
    const el = tossWideToolbarMeasureRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setTossWideToolbarWidth(w);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el, { box: "border-box" });
    update();
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [isTossMode, isTossWideMode]);

  /** 리더보드 패널 위치: 토스 세로는 툴바 아래(배경색 팝업과 유사한 Y), 웹은 기존 오프셋 사용 */
  const leaderboardOffset = isTossMode
    ? (isTossWideMode
        ? undefined
        : {
            top: 88 + (hostWebViewPadding?.top ?? 0),
            right: 0,
          })
    : (hostWebViewPadding
        ? {
            top: 88 + hostWebViewPadding.top,
            right: 16 + hostWebViewPadding.right,
          }
        : undefined);

  useEffect(() => {
    // Fetch room creation time and initial scores
    const fetchRoomData = async () => {
      const { data: roomData } = await supabase.from('pixi_rooms').select('total_play_time_seconds, max_players, piece_count').eq('id', roomId).single();
      if (roomData) {
        setPlayTime(roomData.total_play_time_seconds || 0);
        accumulatedTimeRef.current = roomData.total_play_time_seconds || 0;
        if (roomData.max_players) setMaxPlayers(roomData.max_players);
        if (roomData.piece_count) setTotalPieces(roomData.piece_count);
      }

      const { data: scoreData } = await supabase.from('pixi_scores').select('*').eq('room_id', roomId).order('score', { ascending: false });
      if (scoreData) {
        setScores(scoreData);
      }
    };
    fetchRoomData();
  }, [roomId]);

  useEffect(() => {
    // Socket.io 연결 및 플레이 타임 동기화 (기준 시간만 받음)
    const backendUrl = import.meta.env.VITE_BACKEND_URL;
    const socket = backendUrl ? io(backendUrl) : io();
    socketRef.current = socket;

    socket.emit(ROOM_EVENTS.JoinRoom, roomId);

    socket.on(ROOM_EVENTS.SyncTime, (data: SyncTimePayload) => {
      accumulatedTimeRef.current = data.accumulatedTime;
      isRunningRef.current = data.isRunning;
      localStartTimeRef.current = Date.now();
      setPlayTime(Math.floor(data.accumulatedTime));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  useEffect(() => {
    // 클라이언트 로컬 타이머 (네트워크 통신 없이 화면만 갱신)
    const timer = setInterval(() => {
      if (isRunningRef.current) {
        const elapsed = (Date.now() - localStartTimeRef.current) / 1000;
        setPlayTime(Math.floor(accumulatedTimeRef.current + elapsed));
      }
    }, 500); // 0.5초마다 갱신하여 부드럽게 표시
    
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    if (h > 0) return `${h}:${m}:${s}`;
    return `${m}:${s}`;
  };

  useEffect(() => {
    const readLocalPuzzleUsername = (): string => {
      try {
        const raw = localStorage.getItem("puzzle_user");
        if (raw) {
          const o = JSON.parse(raw) as { username?: string };
          if (o?.username != null && String(o.username) !== "") return String(o.username);
        }
      } catch {
        /* noop */
      }
      const g = localStorage.getItem("puzzle_guest_name");
      if (g != null && g !== "") return String(g);
      return "guest";
    };
    /** playerLeft 수신 후 presence 유령이 남아 있어도 순위표에서 접속 해제로 표시 */
    const offlineAfterByeRef = { current: new Set<string>() };

    let isMounted = true;
    /** initPixi 안에서 할당: 방 나가기 시 스티키/드래그 중 lock 브로드캐스트 해제 */
    let releaseOwnedPieceLocks: (() => void) | null = null;
    let deferredBevelRafId: number | null = null;
    let appInstance: PIXI.Application | null = null;
    let deviceMotionHandler: ((event: DeviceMotionEvent) => void) | null = null;
    let easterTicker: (() => void) | null = null;
    /** true: 조각은 벡터+베벨(조각당 generateTexture 생략)·자물쇠 텍스처 1회 공유. false: 기존 래스터 조각+자물쇠. */
    const FAST_PIECE_INIT = true;
    /** FAST로 벡터만 올린 뒤, 로딩 이후 rAF로 조각마다 베벨 래스터를 점진 적용 */
    const DEFER_PIECE_BEVEL_UPGRADE = true;
    const BEVEL_UPGRADE_PIECES_PER_FRAME = 2;
    let sharedLockTexture: PIXI.Texture | null = null;
    /** Supabase Realtime: canPush 전 send()는 REST 폴백·경고 유발 → 구독 후에만 전송, 이전은 큐 */
    let realtimeBroadcastReady = false;
    const realtimeBroadcastQueue: { event: string; payload: unknown }[] = [];
    let enqueueRealtimeBroadcast: (event: string, payload: unknown) => void = () => {};
    let realtimeHealthTimer: ReturnType<typeof setInterval> | null = null;

    // 1. Pixi Application 초기화
    const initPixi = async () => {
      try {
        setIsLoading(true);
        setLoadProgress(0);

        let progRaf: number | null = null;
        let progPending = 0;
        const bumpProgress = (p: number) => {
          progPending = Math.max(progPending, Math.min(100, p));
          if (progRaf != null) return;
          progRaf = requestAnimationFrame(() => {
            progRaf = null;
            if (isMounted) setLoadProgress(progPending);
          });
        };
        bumpProgress(2);

        // Update last active time when entering a room
        if (user && user.id) {
          supabase.from('pixi_users').update({ last_active_at: new Date().toISOString() }).eq('id', user.id).then();
          void recordUserRoomVisit(roomId);
        }
        
        const app = new PIXI.Application();
        try {
          await app.init({ 
            resizeTo: pixiContainer.current ?? window, 
            backgroundAlpha: 0,
            antialias: true,
            resolution: window.devicePixelRatio || 1,
            autoDensity: true,
            preference: 'webgl'
          });
        } catch (e) {
          console.warn("WebGL failed, trying Canvas renderer", e);
          await app.init({
            resizeTo: pixiContainer.current ?? window,
            backgroundAlpha: 0,
            antialias: true,
            /** Canvas 폴백: 기본 DPR 대비 절반(저해상도) */
            resolution: (window.devicePixelRatio || 1) * 0.5,
            autoDensity: true,
            preference: 'canvas',
          });
        }

        if (!isMounted) {
          app.destroy(true);
          return;
        }

        appInstance = app;
        bumpProgress(14);
        // 별도 캔버스의 WebGL 프로브와 실제 PIXI 렌더러가 다를 수 있음(예: WebGL 실패 후 Canvas).
        // 떨어지는 인트로는 alpha=0에서 시작하므로, Canvas일 때는 즉시 보이게 한다.
        const isCanvasRenderer = app.renderer.type === PIXI_RENDERER_TYPE_CANVAS;
        const useFallingPieceIntro = !isCanvasRenderer;
        /** Canvas(저사양)에서는 지연 베벨(generateTexture) 경로를 쓰지 않음 */
        const deferBevelUpgrade =
          DEFER_PIECE_BEVEL_UPGRADE && FAST_PIECE_INIT && !isCanvasRenderer;
        /** Canvas: 조각·판 외곽선 두께 등을 WebGL 대비 절반으로 */
        const canvasOutlineScale = isCanvasRenderer ? 0.5 : 1;

        app.stage.eventMode = 'static';
        app.stage.hitArea = new PIXI.Rectangle(-10000, -10000, 20000, 20000);
        
        const world = new PIXI.Container();
        world.sortableChildren = true;
        app.stage.addChild(world);
        worldRef.current = world;

        let lastWidth = app.screen.width;
        let lastHeight = app.screen.height;

        app.renderer.on('resize', (width, height) => {
          if (worldRef.current) {
            const dx = (width - lastWidth) / 2;
            const dy = (height - lastHeight) / 2;
            worldRef.current.x += dx;
            worldRef.current.y += dy;
          }
          lastWidth = width;
          lastHeight = height;
        });

        const cursorsContainer = new PIXI.Container();
        cursorsContainer.zIndex = 2000;
        world.addChild(cursorsContainer);
        const cursors = new Map<string, { container: PIXI.Container, targetX: number, targetY: number }>();
        const remoteLockedPieces = new Map<string, Set<number>>();
        /** presence에 실어 신규 입장자가 선점 상태를 동기화할 수 있게 함 */
        const localPresenceLockIds = new Set<number>();

        // 배경 패닝 로직
        let isPanning = false;
        let panStart = { x: 0, y: 0 };
        let worldStart = { x: 0, y: 0 };
        let activeTouches = 0;

        let initialDistance = 0;
        let initialScale = 1;
        let initialWorldPos = { x: 0, y: 0 };

        let lastTapTime = 0;
        let isDoubleTapZooming = false;
        let doubleTapZoomStartY = 0;
        let doubleTapInitialScale = 1;
        let doubleTapWorldPos = { x: 0, y: 0 };

        let selectedCluster: Set<number> | null = null;
        let selectedOffsets = new Map<number, {x: number, y: number}>();
        let isDraggingSelected = false;
        let selectedMoved = false;
        let selectedTouchStartPos = { x: 0, y: 0 };
        let topZIndex = 1;

        // Global drag state for pieces
        let isDragging = false;
        let dragCluster = new Set<number>();
        let dragOffsets = new Map<number, {x: number, y: number}>();
        /** 터치 팻핑거: 로컬 -Y로 살짝 띄움(월드가 -90°여도 조각 좌표는 퍼즐 판 기준이라 화면에서는 세로 방향 이동). */
        let currentShiftY = 0;
        let touchStartPos = { x: 0, y: 0 };
        let isTouchDraggingPiece = false;
        let pointerGlobalPos = { x: 0, y: 0 };
        let dragStartPieceId = -1;
        
        const targetPositions = new Map<number, {x: number, y: number}>();
        const fallingPieces: { id: number, container: PIXI.Container, targetX: number, targetY: number, progress: number, delay: number }[] = [];
        type PieceEasterAnim = {
          id: number;
          fromX: number;
          fromY: number;
          toX: number;
          toY: number;
          fromScaleX: number;
          fromScaleY: number;
          toScaleX: number;
          toScaleY: number;
          fromRotation: number;
          toRotation: number;
          fromAlpha: number;
          toAlpha: number;
          fromTint: number;
          toTint: number;
          fromSpriteAlpha: number;
          toSpriteAlpha: number;
          progress: number;
          speed: number;
          delayFrames: number;
          hideOnFinish?: boolean;
          keepEndTransform?: boolean;
          /** true면 앞면 스프라이트 대신 조각 윤곽 단색 회색 뒷면 */
          solidGrayBackOnFinish?: boolean;
        };
        const pieceEasterAnims = new Map<number, PieceEasterAnim>();
        const easterState = {
          spilled: false,
          animating: false,
          smoothedZ: null as number | null,
          lastSwitchAt: 0,
        };
        const getPieceSprite = (piece: PIXI.Container): PIXI.Sprite | PIXI.Container | null => {
          const node = piece.getChildByLabel('pieceSprite');
          if (!node) return null;
          if (node instanceof PIXI.Sprite) return node;
          if (node instanceof PIXI.Container) return node;
          return null;
        };
        /** 퍼즐 뒷면(이스터 에그): 흰색·검정 중간 단색 회색 */
        const EASTER_SOLID_BACK_HEX = 0x9ca3af;
        const clearEasterSolidBack = (piece: PIXI.Container) => {
          const g = piece.getChildByLabel('easterSolidBack');
          if (g) {
            piece.removeChild(g);
            g.destroy();
          }
        };
        const setEasterSolidBack = (piece: PIXI.Container, on: boolean) => {
          const sprite = getPieceSprite(piece);
          clearEasterSolidBack(piece);
          const lockIcon = piece.getChildByLabel('lockIcon');
          if (!on) {
            if (sprite) {
              sprite.visible = true;
              sprite.tint = 0xffffff;
              sprite.alpha = 1;
            }
            if (lockIcon) lockIcon.visible = false;
            return;
          }
          if (sprite) sprite.visible = false;
          const make = (piece as any).__makeEasterSolidBack as (() => PIXI.Graphics) | undefined;
          if (make) {
            piece.addChildAt(make(), 0);
          }
          if (lockIcon) lockIcon.visible = false;
        };
        const lerpColor = (from: number, to: number, t: number) => {
          const fr = (from >> 16) & 0xff;
          const fg = (from >> 8) & 0xff;
          const fb = from & 0xff;
          const tr = (to >> 16) & 0xff;
          const tg = (to >> 8) & 0xff;
          const tb = to & 0xff;
          const r = Math.round(fr + (tr - fr) * t);
          const g = Math.round(fg + (tg - fg) * t);
          const b = Math.round(fb + (tb - fb) * t);
          return (r << 16) | (g << 8) | b;
        };

        const updateTouches = (e: TouchEvent) => {
          activeTouches = e.touches.length;
          if (activeTouches === 0) {
            isDoubleTapZooming = false;
          }
        };

        app.stage.on('pointerdown', (e) => {
          if (activeTouches > 1 || isDoubleTapZooming) return;
          
          if (selectedCluster) {
            if (e.pointerType === 'mouse') {
              const snapped = snapCluster(selectedCluster);
              sendUnlockBatch(Array.from(selectedCluster));
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel('lockIcon');
                if (lockIcon) lockIcon.visible = false;
              });
              selectedCluster = null;
              return;
            }

            if (isClusterHeldRemotely(selectedCluster)) {
              sendUnlockBatch(Array.from(selectedCluster));
              selectedCluster.forEach((id) => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel("lockIcon");
                if (lockIcon) lockIcon.visible = false;
              });
              selectedCluster = null;
              return;
            }
            
            isDraggingSelected = true;
            selectedMoved = false;
            selectedTouchStartPos = { x: e.global.x, y: e.global.y };
            const localPos = e.getLocalPosition(world);
            
            // Bring selected cluster to top immediately on touch down
            topZIndex++;
            
            selectedCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              p.zIndex = topZIndex;
              selectedOffsets.set(id, { x: localPos.x - p.x, y: localPos.y - p.y });
              targetPositions.delete(id);
            });
            return;
          }

          isPanning = true;
          panStart = { x: e.global.x, y: e.global.y };
          worldStart = { x: world.x, y: world.y };
        });

        let lastCursorBroadcast = 0;
        app.stage.on('globalpointermove', (e) => {
          pointerGlobalPos = { x: e.global.x, y: e.global.y };
          
          const isPadDragging =
            Boolean(miniPadDragRef.current?.isDragging) || Boolean(zoomPadDragRef.current?.isDragging);
          if (activeTouches <= 1 && !isPadDragging) {
            const now = Date.now();
            if (now - lastCursorBroadcast > 100) {
              lastCursorBroadcast = now;
              let broadcastX = 0;
              let broadcastY = 0;

              const activeCluster = isDraggingSelected ? selectedCluster : (isDragging && isTouchDraggingPiece ? dragCluster : null);
              
              if (activeCluster && activeCluster.size > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                activeCluster.forEach(id => {
                  const p = pieces.current.get(id);
                  if (p) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x + pieceWidth);
                    maxY = Math.max(maxY, p.y + pieceHeight);
                  }
                });
                broadcastX = (minX + maxX) / 2;
                broadcastY = (minY + maxY) / 2;
              } else {
                const localPos = e.getLocalPosition(world);
                broadcastX = localPos.x;
                broadcastY = localPos.y;
              }

              enqueueRealtimeBroadcast('cursorMove', {
                username: user?.username ?? localStorage.getItem('puzzle_guest_name') ?? 'guest',
                x: broadcastX,
                y: broadcastY,
              });
            }
          }

          if (selectedCluster && e.pointerType === 'mouse' && !isDraggingSelected && !isDragging) {
            if (isClusterHeldRemotely(selectedCluster)) {
              sendUnlockBatch(Array.from(selectedCluster));
              selectedCluster.forEach((id) => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel("lockIcon");
                if (lockIcon) lockIcon.visible = false;
              });
              selectedCluster = null;
              return;
            }
            const localPos = e.getLocalPosition(world);
            const updates: any[] = [];
            
            selectedCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              const offset = selectedOffsets.get(id)!;
              p.x = localPos.x - offset.x;
              p.y = localPos.y - offset.y;
              updates.push({ pieceId: id, x: p.x, y: p.y });
            });
            
            sendMoveBatch(updates);
            return;
          }

          if (isDraggingSelected && selectedCluster) {
            if (isClusterHeldRemotely(selectedCluster)) {
              sendUnlockBatch(Array.from(selectedCluster));
              selectedCluster.forEach((id) => {
                const p = pieces.current.get(id);
                if (!p) return;
                const lockIcon = p.getChildByLabel("lockIcon");
                if (lockIcon) lockIcon.visible = false;
              });
              selectedCluster = null;
              isDraggingSelected = false;
              selectedMoved = false;
              return;
            }
            if (activeTouches > 1) {
              isDraggingSelected = false;
              return;
            }
            if (!selectedMoved) {
              const dx = e.global.x - selectedTouchStartPos.x;
              const dy = e.global.y - selectedTouchStartPos.y;
              if (Math.sqrt(dx * dx + dy * dy) > 10) {
                selectedMoved = true;
                topZIndex++;
                const currentLocalPos = e.getLocalPosition(world);
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  p.zIndex = 999999;
                  // Update offset so the piece starts moving smoothly from its current position without jumping
                  selectedOffsets.set(id, { x: currentLocalPos.x - p.x, y: currentLocalPos.y - p.y });
                });
              } else {
                return;
              }
            }
            const localPos = e.getLocalPosition(world);
            const updates: any[] = [];
            
            selectedCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              const offset = selectedOffsets.get(id)!;
              p.x = localPos.x - offset.x;
              p.y = localPos.y - offset.y;
              updates.push({ pieceId: id, x: p.x, y: p.y });
            });
            
            sendMoveBatch(updates);
            return;
          }

          if (isDragging) {
            if (activeTouches > 1) {
              if (dragCluster.size > 0) {
                sendUnlockBatch(Array.from(dragCluster));
                dragCluster = new Set();
              }
              isDragging = false;
              isTouchDraggingPiece = false;
              currentShiftY = 0;
              return;
            }
            
            const dx = e.global.x - touchStartPos.x;
            const dy = e.global.y - touchStartPos.y;
            
            if (!isTouchDraggingPiece && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
              isTouchDraggingPiece = true;
              topZIndex++;
              if (e.pointerType === 'touch') {
                /** 화면 위로 ~8mm(표준 96dpi CSS px 가정); 글로벌 Y 감소량에 맞춰 월드 좌표로 환산(줌·월드 회전 반영) */
                const liftCssPx = (8 / 25.4) * 96;
                const canvasEl = app.canvas as HTMLCanvasElement;
                const cssToRenderer =
                  canvasEl && canvasEl.clientWidth > 0
                    ? canvasEl.width / canvasEl.clientWidth
                    : (app.renderer as { resolution?: number }).resolution ??
                      (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
                const targetGlobalPx = liftCssPx * cssToRenderer;
                const anchorId =
                  dragStartPieceId >= 0 && dragCluster.has(dragStartPieceId)
                    ? dragStartPieceId
                    : Array.from(dragCluster)[0];
                const ap = pieces.current.get(anchorId);
                if (ap) {
                  const p0 = new PIXI.Point(ap.x, ap.y);
                  const p1 = new PIXI.Point(ap.x, ap.y - 1);
                  world.toGlobal(p0, p0);
                  world.toGlobal(p1, p1);
                  const rate = p1.y - p0.y;
                  currentShiftY = Math.abs(rate) < 1e-4 ? pieceHeight * 1.6 : -targetGlobalPx / rate;
                } else {
                  currentShiftY = pieceHeight * 1.6;
                }
              } else {
                currentShiftY = 0;
              }

              if (selectedCluster) {
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  const lockIcon = p.getChildByLabel('lockIcon');
                  if (lockIcon) lockIcon.visible = false;
                });
                selectedCluster = null;
              }
              
              const updates: any[] = [];
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                p.zIndex = 999999;
                p.y -= currentShiftY;
                updates.push({ pieceId: id, x: p.x, y: p.y });
              });
              
              sendLockBatch(Array.from(dragCluster));
              sendMoveBatch(updates);
            }
            
            if (isTouchDraggingPiece) {
              const localPos = e.getLocalPosition(world);
              const updates: any[] = [];
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const offset = dragOffsets.get(id)!;
                p.x = localPos.x - offset.x;
                p.y = localPos.y - offset.y - currentShiftY;
                updates.push({ pieceId: id, x: p.x, y: p.y });
              });
              sendMoveBatch(updates);
            }
            return;
          }

          if (isPanning) {
            if (activeTouches > 1) {
              isPanning = false;
              return;
            }
            world.x = worldStart.x + (e.global.x - panStart.x);
            world.y = worldStart.y + (e.global.y - panStart.y);
          }
        });

        const stopPanning = (e: PIXI.FederatedPointerEvent) => {
          if (isDragging) {
            isDragging = false;
            
            if (!isTouchDraggingPiece) {
              // Tap to select
              if (isClusterHeldRemotely(dragCluster)) {
                dragCluster = new Set();
                isDragging = false;
                return;
              }
              selectedCluster = dragCluster;
              topZIndex++;
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel('lockIcon');
                if (lockIcon) lockIcon.visible = true;
                p.zIndex = topZIndex;
                selectedOffsets.set(id, dragOffsets.get(id)!);
              });
              
              sendLockBatch(Array.from(selectedCluster));
              return;
            }
            
            isTouchDraggingPiece = false;
            sendUnlockBatch(Array.from(dragCluster));
            
            topZIndex++;
            dragCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              p.zIndex = topZIndex;
            });

            const snapped = snapCluster(dragCluster);
            if (snapped && selectedCluster && dragCluster.has(Array.from(selectedCluster)[0])) {
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel('lockIcon');
                if (lockIcon) lockIcon.visible = false;
              });
              selectedCluster = null;
            } else if (!selectedCluster || !dragCluster.has(Array.from(selectedCluster)[0])) {
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const lockIcon = p.getChildByLabel('lockIcon');
                if (lockIcon) lockIcon.visible = false;
              });
            }
            currentShiftY = 0;
            return;
          }

          if (isDraggingSelected) {
            isDraggingSelected = false;
            
            if (selectedCluster) {
              topZIndex++;
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                p.zIndex = topZIndex;
              });
            }

            if (!selectedMoved) {
              // It was just a tap -> deselect
              if (selectedCluster) {
                sendUnlockBatch(Array.from(selectedCluster));
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  const lockIcon = p.getChildByLabel('lockIcon');
                  if (lockIcon) lockIcon.visible = false;
                });
                selectedCluster = null;
              }
            } else {
              // Drag ended -> snap but KEEP selected
              if (selectedCluster) {
                const snapped = snapCluster(selectedCluster);
                let anyLocked = false;
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  if (p.eventMode === 'none') anyLocked = true;
                });
                if (anyLocked) {
                  sendUnlockBatch(Array.from(selectedCluster));
                  selectedCluster.forEach(id => {
                    const p = pieces.current.get(id)!;
                    const lockIcon = p.getChildByLabel('lockIcon');
                    if (lockIcon) lockIcon.visible = false;
                  });
                  selectedCluster = null;
                } else if (snapped) {
                  // Re-evaluate the cluster to see if it grew
                  const firstId = Array.from(selectedCluster)[0];
                  const newCluster = getConnectedCluster(firstId);
                  
                  if (newCluster.size > selectedCluster.size) {
                    const newPieces = Array.from(newCluster).filter(id => {
                      if (selectedCluster!.has(id)) return false;
                      const p = pieces.current.get(id);
                      return p && p.eventMode !== 'none';
                    });
                    
                    if (newPieces.length > 0) {
                      sendLockBatch(newPieces);
                      newPieces.forEach(id => {
                        const p = pieces.current.get(id)!;
                        const lockIcon = p.getChildByLabel('lockIcon');
                        if (lockIcon) lockIcon.visible = true;
                        selectedCluster!.add(id);
                      });
                    }
                  }
                }
              }
            }
            return;
          }
          isPanning = false;
        };
        app.stage.on('pointerup', stopPanning);
        app.stage.on('pointerupoutside', stopPanning);

        app.ticker.add(() => {
          cursors.forEach((cursorData, username) => {
            cursorData.container.scale.set(1 / world.scale.x);
            
            let isHoldingPiece = false;
            const lockedPieces = remoteLockedPieces.get(username);
            if (lockedPieces && lockedPieces.size > 0) {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              lockedPieces.forEach(id => {
                const p = pieces.current.get(id);
                if (p) {
                  minX = Math.min(minX, p.x);
                  minY = Math.min(minY, p.y);
                  maxX = Math.max(maxX, p.x + pieceWidth);
                  maxY = Math.max(maxY, p.y + pieceHeight);
                }
              });
              if (minX !== Infinity) {
                cursorData.targetX = (minX + maxX) / 2;
                cursorData.targetY = (minY + maxY) / 2;
                isHoldingPiece = true;
              }
            }

            const dx = cursorData.targetX - cursorData.container.x;
            const dy = cursorData.targetY - cursorData.container.y;
            
            if (isHoldingPiece) {
              cursorData.container.x = cursorData.targetX;
              cursorData.container.y = cursorData.targetY;
            } else if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
              cursorData.container.x += dx * 0.3;
              cursorData.container.y += dy * 0.3;
            }
          });

          targetPositions.forEach((target, id) => {
            const p = pieces.current.get(id);
            if (p) {
              const dx = target.x - p.x;
              const dy = target.y - p.y;
              
              if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
                p.x = target.x;
                p.y = target.y;
                targetPositions.delete(id);
                checkCompletion();
              } else {
                p.x += dx * 0.3;
                p.y += dy * 0.3;
              }
            }
          });
        });

        // Edge scrolling ticker
        app.ticker.add(() => {
          if (isTossMode && isTossWideMode) return;
          if (!isDragging && !isDraggingSelected) return;
          if (isDraggingSelected && !selectedMoved) return;
          if (isDragging && !isTouchDraggingPiece) return;
          
          const edgeMargin = 20;
          const scrollSpeed = 2.5;
          let scrollX = 0;
          let scrollY = 0;
          
          let minGlobalX = pointerGlobalPos.x;
          let maxGlobalX = pointerGlobalPos.x;
          let minGlobalY = pointerGlobalPos.y;
          let maxGlobalY = pointerGlobalPos.y;

          const activeCluster = isDraggingSelected ? selectedCluster : (isDragging ? dragCluster : null);
          
          if (activeCluster) {
            activeCluster.forEach(id => {
              const p = pieces.current.get(id);
              if (p) {
                const px = world.x + p.x * world.scale.x;
                const py = world.y + p.y * world.scale.y;
                const pRight = px + p.width * world.scale.x;
                const pBottom = py + p.height * world.scale.y;
                
                minGlobalX = Math.min(minGlobalX, px);
                maxGlobalX = Math.max(maxGlobalX, pRight);
                minGlobalY = Math.min(minGlobalY, py);
                maxGlobalY = Math.max(maxGlobalY, pBottom);
              }
            });
          }
          
          const isWider = (maxGlobalX - minGlobalX) > (app.screen.width - 2 * edgeMargin);
          const isTaller = (maxGlobalY - minGlobalY) > (app.screen.height - 2 * edgeMargin);

          if (pointerGlobalPos.x < edgeMargin) scrollX = scrollSpeed;
          else if (pointerGlobalPos.x > app.screen.width - edgeMargin) scrollX = -scrollSpeed;
          else if (!isWider) {
            if (minGlobalX < edgeMargin) scrollX = scrollSpeed;
            else if (maxGlobalX > app.screen.width - edgeMargin) scrollX = -scrollSpeed;
          }
          
          if (pointerGlobalPos.y < edgeMargin) scrollY = scrollSpeed;
          else if (pointerGlobalPos.y > app.screen.height - edgeMargin) scrollY = -scrollSpeed;
          else if (!isTaller) {
            if (minGlobalY < edgeMargin) scrollY = scrollSpeed;
            else if (maxGlobalY > app.screen.height - edgeMargin) scrollY = -scrollSpeed;
          }
          
          if (scrollX !== 0 || scrollY !== 0) {
            world.x += scrollX;
            world.y += scrollY;
            
            const localX = (pointerGlobalPos.x - world.x) / world.scale.x;
            const localY = (pointerGlobalPos.y - world.y) / world.scale.y;
            const updates: any[] = [];
            
            if (isDraggingSelected && selectedMoved && selectedCluster) {
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const offset = selectedOffsets.get(id)!;
                p.x = localX - offset.x;
                p.y = localY - offset.y;
                updates.push({ pieceId: id, x: p.x, y: p.y });
              });
            } else if (isDragging && isTouchDraggingPiece && dragCluster) {
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const offset = dragOffsets.get(id)!;
                p.x = localX - offset.x;
                p.y = localY - offset.y - currentShiftY;
                updates.push({ pieceId: id, x: p.x, y: p.y });
              });
            }
            
            if (updates.length > 0) {
              sendMoveBatch(updates);
            }
          }
        });

        pixiContainer.current?.appendChild(app.canvas);

        const canvas = app.canvas as HTMLCanvasElement;

        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const zoomFactor = 1.1;
          const direction = e.deltaY < 0 ? 1 : -1;
          const scaleMultiplier = direction > 0 ? zoomFactor : 1 / zoomFactor;

          const rect = canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          const worldX = (x - world.x) / world.scale.x;
          const worldY = (y - world.y) / world.scale.y;

          const newScale = Math.max(0.05, Math.min(world.scale.x * scaleMultiplier, 1));
          world.scale.set(newScale);

          world.x = x - worldX * world.scale.x;
          world.y = y - worldY * world.scale.y;
        };

        const getDistance = (touches: TouchList) => {
          const dx = touches[0].clientX - touches[1].clientX;
          const dy = touches[0].clientY - touches[1].clientY;
          return Math.sqrt(dx * dx + dy * dy);
        };

        const getCenter = (touches: TouchList) => {
          return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
          };
        };

        const onTouchStart = (e: TouchEvent) => {
          if (miniPadDragRef.current?.isDragging || zoomPadDragRef.current?.isDragging) {
            return;
          }
          activeTouches = e.touches.length;
          const currentTime = Date.now();
          
          if (e.touches.length === 1) {
            const timeDiff = currentTime - lastTapTime;
            if (timeDiff > 0 && timeDiff < 300) {
              isDoubleTapZooming = true;
              doubleTapZoomStartY = e.touches[0].clientY;
              doubleTapInitialScale = world.scale.x;
              
              const rect = canvas.getBoundingClientRect();
              const centerX = e.touches[0].clientX - rect.left;
              const centerY = e.touches[0].clientY - rect.top;
              doubleTapWorldPos = {
                x: (centerX - world.x) / world.scale.x,
                y: (centerY - world.y) / world.scale.y
              };
              e.preventDefault();
            }
            lastTapTime = currentTime;
          } else if (e.touches.length >= 2) {
            isDoubleTapZooming = false;
            e.preventDefault();
            initialDistance = getDistance(e.touches);
            initialScale = world.scale.x;
            const center = getCenter(e.touches);
            const rect = canvas.getBoundingClientRect();
            const centerX = center.x - rect.left;
            const centerY = center.y - rect.top;
            
            initialWorldPos = {
              x: (centerX - world.x) / world.scale.x,
              y: (centerY - world.y) / world.scale.y
            };
          }
        };

        const onTouchMove = (e: TouchEvent) => {
          if (miniPadDragRef.current?.isDragging || zoomPadDragRef.current?.isDragging) {
            return;
          }
          if (isDoubleTapZooming && e.touches.length === 1) {
            e.preventDefault();
            const currentY = e.touches[0].clientY;
            const deltaY = currentY - doubleTapZoomStartY;
            
            // 위로 드래그하면 축소, 아래로 드래그하면 확대
            const scaleMultiplier = Math.exp(deltaY * 0.01);
            const newScale = Math.max(0.05, Math.min(doubleTapInitialScale * scaleMultiplier, 1));
            world.scale.set(newScale);

            const rect = canvas.getBoundingClientRect();
            const centerX = e.touches[0].clientX - rect.left;
            const centerY = e.touches[0].clientY - rect.top;

            world.x = centerX - doubleTapWorldPos.x * world.scale.x;
            world.y = centerY - doubleTapWorldPos.y * world.scale.y;
          } else if (e.touches.length === 2) {
            e.preventDefault();
            const currentDistance = getDistance(e.touches);
            const scaleMultiplier = currentDistance / initialDistance;
            const newScale = Math.max(0.05, Math.min(initialScale * scaleMultiplier, 1));
            
            world.scale.set(newScale);

            const center = getCenter(e.touches);
            const rect = canvas.getBoundingClientRect();
            const centerX = center.x - rect.left;
            const centerY = center.y - rect.top;

            world.x = centerX - initialWorldPos.x * world.scale.x;
            world.y = centerY - initialWorldPos.y * world.scale.y;
          }
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', updateTouches, { passive: false });
        canvas.addEventListener('touchcancel', updateTouches, { passive: false });

        // 2. 이미지 로드 및 조각 생성
        let objectUrl = '';
        let img: HTMLImageElement | null = null;
        
        const tryLoadImage = async (url: string): Promise<{ objectUrl: string, img: HTMLImageElement }> => {
          const response = await fetch(url, { mode: 'cors' });
          if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
          const blob = await response.blob();
          if (!blob.type.startsWith('image/')) {
            console.warn(`Response type is ${blob.type}, attempting to load anyway...`);
          }
          const objUrl = URL.createObjectURL(blob);
          
          const testImg = new Image();
          testImg.src = objUrl;
          await new Promise((resolve, reject) => {
            testImg.onload = resolve;
            testImg.onerror = () => reject(new Error('Image failed to load from object URL'));
          });
          return { objectUrl: objUrl, img: testImg };
        };

        const tryLoadImageAllOriginsGet = async (url: string): Promise<{ objectUrl: string, img: HTMLImageElement }> => {
          const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
          const response = await fetch(proxyUrl, { mode: 'cors' });
          if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
          const data = await response.json();
          if (!data.contents) throw new Error('No contents in allorigins response');
          
          const res = await fetch(data.contents);
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          
          const testImg = new Image();
          testImg.src = objUrl;
          await new Promise((resolve, reject) => {
            testImg.onload = resolve;
            testImg.onerror = () => reject(new Error('Image failed to load from object URL'));
          });
          return { objectUrl: objUrl, img: testImg };
        };

        try {
          const result = await tryLoadImage(imageUrl);
          objectUrl = result.objectUrl;
          img = result.img;
        } catch (e) {
          console.error('Error fetching image directly, trying proxy 1:', e);
          try {
            const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(imageUrl)}`;
            const result = await tryLoadImage(proxyUrl);
            objectUrl = result.objectUrl;
            img = result.img;
          } catch (e2) {
            console.error('Error fetching image via codetabs, trying proxy 2:', e2);
            try {
              const proxyUrl2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}`;
              const result = await tryLoadImage(proxyUrl2);
              objectUrl = result.objectUrl;
              img = result.img;
            } catch (e3) {
              console.error('Error fetching image via allorigins, trying proxy 3:', e3);
              try {
                const proxyUrl3 = `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`;
                const result = await tryLoadImage(proxyUrl3);
                objectUrl = result.objectUrl;
                img = result.img;
              } catch (e4) {
                console.error('Error fetching image via corsproxy.io, trying proxy 4:', e4);
                try {
                  const proxyUrl4 = `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}`;
                  const result = await tryLoadImage(proxyUrl4);
                  objectUrl = result.objectUrl;
                  img = result.img;
                } catch (e5) {
                  console.error('Error fetching image via wsrv.nl, trying proxy 5:', e5);
                  try {
                    const result = await tryLoadImageAllOriginsGet(imageUrl);
                    objectUrl = result.objectUrl;
                    img = result.img;
                  } catch (e6) {
                    console.error('Error fetching image via allorigins get:', e6);
                  }
                }
              }
            }
          }
        }

        if (!isMounted) return;
        if (!objectUrl || !img) {
          console.error('Failed to load texture');
          setImageLoadError('Failed to load image. The image URL might be invalid or blocking access.');
          setIsLoading(false);
          return;
        }
        
        objectUrlRef.current = objectUrl;
        bumpProgress(22);

        let texture;
        try {
          texture = PIXI.Texture.from(img);
          mainTextureRef.current = texture;
        } catch (e) {
          console.error('Error loading texture into PIXI:', e);
        }
        
        if (!isMounted) return;
        if (!texture) {
          console.error('Failed to load texture');
          setImageLoadError('Failed to create texture from image.');
          setIsLoading(false);
          return;
        }

        // Calculate optimal background color based on image brightness
        try {
          const colorCanvas = document.createElement('canvas');
          colorCanvas.width = 50;
          colorCanvas.height = 50;
          const colorCtx = colorCanvas.getContext('2d');
          if (colorCtx) {
            colorCtx.drawImage(img, 0, 0, 50, 50);
            const imgData = colorCtx.getImageData(0, 0, 50, 50).data;
            let r = 0, g = 0, b = 0;
            for (let i = 0; i < imgData.length; i += 4) {
              r += imgData[i];
              g += imgData[i + 1];
              b += imgData[i + 2];
            }
            const pixelCount = imgData.length / 4;
            r /= pixelCount;
            g /= pixelCount;
            b /= pixelCount;
            
            const brightness = (r * 299 + g * 587 + b * 114) / 1000;
            
            // For eye comfort and piece distinction:
            // If image is bright, use a very dark slate
            // If image is dark, use a lighter slate
            // If mid-tone, use the default slate-800
            let newBgColor = '#1e293b'; // default slate-800
            if (brightness > 180) {
              newBgColor = '#0f172a'; // slate-900 (very dark)
            } else if (brightness < 80) {
              newBgColor = '#475569'; // slate-600 (lighter)
            }
            setBgColor(newBgColor);
          }
        } catch (e) {
          console.error('Failed to calculate average color', e);
        }
        bumpProgress(30);

        let TARGET_PIECE_COUNT = Math.min(1000, pieceCount);
        const aspectRatio = texture.width / texture.height;
        let GRID_ROWS = Math.max(1, Math.round(Math.sqrt(TARGET_PIECE_COUNT / Math.max(0.1, aspectRatio))));
        let GRID_COLS = Math.max(1, Math.round(aspectRatio * GRID_ROWS));
        
        while (GRID_ROWS * GRID_COLS > 1000) {
          TARGET_PIECE_COUNT -= 10;
          if (TARGET_PIECE_COUNT <= 10) {
            GRID_ROWS = Math.max(1, Math.floor(Math.sqrt(10 / Math.max(0.1, aspectRatio))));
            GRID_COLS = Math.max(1, Math.floor(aspectRatio * GRID_ROWS));
            break;
          }
          GRID_ROWS = Math.max(1, Math.round(Math.sqrt(TARGET_PIECE_COUNT / Math.max(0.1, aspectRatio))));
          GRID_COLS = Math.max(1, Math.round(aspectRatio * GRID_ROWS));
        }
        
        const PIECE_COUNT = GRID_COLS * GRID_ROWS;
        setTotalPieces(PIECE_COUNT);

        // 화면 해상도는 유지하고, 퍼즐 소스 이미지만 미리 축소해 조각/베벨 생성 비용을 낮춘다.
        const PREPROCESS_SOURCE_PX_PER_PIECE = 100;
        const preprocessTargetWidth = Math.max(1, Math.round(GRID_COLS * PREPROCESS_SOURCE_PX_PER_PIECE));
        const preprocessTargetHeight = Math.max(1, Math.round(GRID_ROWS * PREPROCESS_SOURCE_PX_PER_PIECE));
        const preprocessScale = Math.min(
          1,
          preprocessTargetWidth / Math.max(1, img.width),
          preprocessTargetHeight / Math.max(1, img.height),
        );
        if (preprocessScale < 0.999) {
          const resizedWidth = Math.max(1, Math.round(img.width * preprocessScale));
          const resizedHeight = Math.max(1, Math.round(img.height * preprocessScale));
          const preprocessCanvas = document.createElement('canvas');
          preprocessCanvas.width = resizedWidth;
          preprocessCanvas.height = resizedHeight;
          const preprocessCtx = preprocessCanvas.getContext('2d');
          if (preprocessCtx) {
            preprocessCtx.imageSmoothingEnabled = true;
            preprocessCtx.imageSmoothingQuality = 'high';
            preprocessCtx.drawImage(img, 0, 0, resizedWidth, resizedHeight);
            const oldTexture = texture;
            texture = PIXI.Texture.from(preprocessCanvas);
            mainTextureRef.current = texture;
            oldTexture.destroy(true);
            if (import.meta.env.DEV) {
              console.info('[Puzzle preprocess]', {
                original: `${img.width}x${img.height}`,
                preprocessed: `${resizedWidth}x${resizedHeight}`,
                pxPerPiece: PREPROCESS_SOURCE_PX_PER_PIECE,
              });
            }
          }
        }
        bumpProgress(34);

        const TARGET_PIECE_SIZE = 100;
        const pieceWidth = TARGET_PIECE_SIZE;
        const boardWidth = pieceWidth * GRID_COLS;
        const boardHeight = boardWidth / aspectRatio;
        const pieceHeight = boardHeight / GRID_ROWS;
        
        const tabDepth = Math.min(pieceWidth, pieceHeight) * 0.2;
        const boardStartX = 0;
        const boardStartY = 0;

        // 화면 중앙에 오도록 world 컨테이너 위치 조정 및 축소 (퍼즐판과 주변 조각이 모두 보이도록)
        const spacingX = pieceWidth * (isTossMode && isTossWideMode ? 2.2 : 1.6);
        const spacingY = pieceHeight * (isTossMode && isTossWideMode ? 1.25 : 1.6);
        let placeLayer = 1;
        let positionsCount = 0;
        
        while (positionsCount < PIECE_COUNT) {
          const minX = -placeLayer * spacingX;
          const maxX = boardWidth - pieceWidth + placeLayer * spacingX;
          const minY = 0;
          const maxY = boardHeight - pieceHeight + placeLayer * spacingY;

          const countX = Math.ceil((maxX - minX) / spacingX);
          const countY = Math.ceil((maxY - minY) / spacingY);

          const layerCount = (countY + 1) * 2 + (countX - 1);
          positionsCount += layerCount;
          
          if (positionsCount < PIECE_COUNT) {
            placeLayer++;
          }
        }
        
        const minX = -placeLayer * spacingX;
        const maxX = boardWidth + placeLayer * spacingX;
        const minY = 0;
        const maxY = boardHeight + placeLayer * spacingY;
        
        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;
        
        // Add some padding
        const paddingX = Math.max(pieceWidth, pieceHeight) * 1.5;
        const paddingY = Math.max(pieceWidth, pieceHeight) * 1.5;
        
        // Add extra padding at the top for the menu bar
        const topMenuHeight = isTossMode ? 52 : 60;

        // "Wide mode" uses a landscape-like logical viewport for initial layout calculation.
        const layoutWidth = isTossMode && isTossWideMode ? app.screen.height : app.screen.width;
        const layoutHeight = isTossMode && isTossWideMode ? app.screen.width : app.screen.height;
        
        const paddedWidth = contentWidth + paddingX * 2;
        const paddedHeight = contentHeight + paddingY * 2 + (topMenuHeight / (app.screen.height / contentHeight));
        
        const initialFitScale = Math.min(layoutWidth / paddedWidth, layoutHeight / paddedHeight, 1);
        world.scale.set(initialFitScale);

        // Center the content, shifting down slightly to account for the top menu
        if (isTossMode && isTossWideMode) {
          // Pixi-native rotation mode: rotate world around content center.
          const localCenterX = minX + contentWidth / 2;
          const localCenterY = minY + contentHeight / 2;
          world.pivot.set(localCenterX, localCenterY);
          world.position.set(app.screen.width / 2, app.screen.height / 2);
          world.rotation = -Math.PI / 2;
        } else {
          world.rotation = 0;
          world.pivot.set(0, 0);
          world.x = (layoutWidth - contentWidth * initialFitScale) / 2 - minX * initialFitScale;
          world.y = (layoutHeight - contentHeight * initialFitScale) / 2 - minY * initialFitScale + (topMenuHeight / 2);
        }

        // 퍼즐 판 배경 그리기
        const boardBg = new PIXI.Graphics();
        boardBg.rect(boardStartX, boardStartY, boardWidth, boardHeight);
        boardBg.fill({ color: 0x000000, alpha: 0.1 });
        boardBg.stroke({ width: 2 * canvasOutlineScale, color: 0x000000, alpha: 0.5 });
        boardBg.zIndex = -1;
        world.addChild(boardBg);
        bumpProgress(38);

        // 탭(돌기) 방향 미리 계산
        const horizontalTabs: number[][] = [];
        for (let r = 0; r < GRID_ROWS - 1; r++) {
          const rowTabs = [];
          for (let c = 0; c < GRID_COLS; c++) {
            rowTabs.push(Math.random() > 0.5 ? 1 : -1);
          }
          horizontalTabs.push(rowTabs);
        }

        const verticalTabs: number[][] = [];
        for (let r = 0; r < GRID_ROWS; r++) {
          const rowTabs = [];
          for (let c = 0; c < GRID_COLS - 1; c++) {
            rowTabs.push(Math.random() > 0.5 ? 1 : -1);
          }
          verticalTabs.push(rowTabs);
        }
        bumpProgress(42);

        const drawEdge = (g: PIXI.Graphics, x1: number, y1: number, x2: number, y2: number, tabType: number, tabDepth: number) => {
          if (tabType === 0) {
            g.lineTo(x2, y2);
            return;
          }
          
          const dx = x2 - x1;
          const dy = y2 - y1;
          const L = Math.sqrt(dx * dx + dy * dy);
          
          const nx = dy / L;
          const ny = -dx / L;
          
          const p = (t: number, d: number) => {
            const px = x1 + t * dx + tabType * (d / 0.2) * tabDepth * nx;
            const py = y1 + t * dy + tabType * (d / 0.2) * tabDepth * ny;
            return { x: px, y: py };
          };

          const drawC = (p1: any, p2: any, p3: any) => {
            g.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
          };

          drawC(p(0.193, 0), p(0.390, -0.127), p(0.393, -0.045));
          drawC(p(0.396, 0.038), p(0.329, 0.066), p(0.329, 0.118));
          drawC(p(0.329, 0.171), p(0.373, 0.195), p(0.500, 0.195));
          drawC(p(0.627, 0.195), p(0.671, 0.171), p(0.671, 0.118));
          drawC(p(0.671, 0.066), p(0.604, 0.038), p(0.607, -0.045));
          drawC(p(0.610, -0.127), p(0.807, 0), p(1.000, 0));
        };

        const sendMoveBatch = throttle((updates: {pieceId: number, x: number, y: number}[]) => {
          enqueueRealtimeBroadcast('moveBatch', { updates });
        }, 80);

        const sendBotCursorMove = throttle((username: string, x: number, y: number) => {
          enqueueRealtimeBroadcast('cursorMove', { username, x, y });
        }, 100);

        const sendLockBatch = (pieceIds: number[], userId?: string) => {
          const ch = channelRef.current;
          if (!ch) return;
          const currentUsername = user ? user.username : localStorage.getItem('puzzle_guest_name');
          const me = currentUsername != null && currentUsername !== '' ? String(currentUsername) : 'guest';
          const uid = userId != null ? String(userId) : me;
          enqueueRealtimeBroadcast('lock', { pieceIds, userId: uid });
          if (uid === me) {
            pieceIds.forEach((id) => localPresenceLockIds.add(id));
            if (realtimeBroadcastReady) {
              void ch.track({
                user: me,
                lockedPieceIds: Array.from(localPresenceLockIds),
              });
            }
          }
        };

        const sendUnlockBatch = (pieceIds: number[], userId?: string) => {
          const ch = channelRef.current;
          if (!ch) return;
          const currentUsername = user ? user.username : localStorage.getItem('puzzle_guest_name');
          const me = currentUsername != null && currentUsername !== '' ? String(currentUsername) : 'guest';
          const uid = userId != null ? String(userId) : me;
          enqueueRealtimeBroadcast('unlock', { pieceIds, userId: uid });
          if (uid === me) {
            pieceIds.forEach((id) => localPresenceLockIds.delete(id));
            if (realtimeBroadcastReady) {
              void ch.track({
                user: me,
                lockedPieceIds: Array.from(localPresenceLockIds),
              });
            }
          }
        };

        releaseOwnedPieceLocks = () => {
          try {
            if (selectedCluster && selectedCluster.size > 0) {
              sendUnlockBatch(Array.from(selectedCluster));
            }
            if (isDragging && dragCluster.size > 0) {
              sendUnlockBatch(Array.from(dragCluster));
            }
          } catch {
            /* noop */
          }
        };

        const getLocalUsername = (): string => {
          const u = user ? user.username : localStorage.getItem("puzzle_guest_name");
          return u != null && u !== "" ? String(u) : "guest";
        };

        /** 다른 클라이언트가 이미 lock / presence로 점유한 단일 조각인지 */
        const isPieceIdHeldRemotely = (pieceId: number): boolean => {
          const me = getLocalUsername();
          for (const [uid, set] of remoteLockedPieces) {
            if (String(uid) === me) continue;
            if (set.has(pieceId)) return true;
          }
          return false;
        };

        /** 다른 클라이언트가 이미 lock 브로드캐스트로 점유한 조각이 클러스터에 포함되는지 */
        const isClusterHeldRemotely = (cluster: Set<number>): boolean => {
          for (const id of cluster) {
            if (isPieceIdHeldRemotely(id)) return true;
          }
          return false;
        };

        /** 원격 유저의 lock이 우선 — 겹치면 로컬 스티키/드래그를 즉시 해제하고 unlock 브로드캐스트 */
        const abortLocalInteractionForRemoteClaim = (remoteUserId: string, incomingPieceIds: number[]) => {
          if (String(remoteUserId) === getLocalUsername()) return;
          const incoming = new Set(incomingPieceIds);
          const hitsSelected = Boolean(selectedCluster && [...selectedCluster].some((id) => incoming.has(id)));
          const hitsDrag = Boolean(isDragging && [...dragCluster].some((id) => incoming.has(id)));
          if (!hitsSelected && !hitsDrag) return;

          if (selectedCluster && selectedCluster.size > 0) {
            sendUnlockBatch(Array.from(selectedCluster));
            selectedCluster.forEach((id) => {
              const p = pieces.current.get(id);
              if (!p) return;
              const lockIcon = p.getChildByLabel("lockIcon");
              if (lockIcon) lockIcon.visible = false;
            });
            selectedCluster = null;
          }
          if (isDragging && dragCluster.size > 0) {
            sendUnlockBatch(Array.from(dragCluster));
            dragCluster.forEach((id) => {
              const p = pieces.current.get(id);
              if (!p) return;
              const lockIcon = p.getChildByLabel("lockIcon");
              if (lockIcon) lockIcon.visible = false;
            });
            dragCluster = new Set();
          }
          isDragging = false;
          isTouchDraggingPiece = false;
          isDraggingSelected = false;
          selectedMoved = false;
          currentShiftY = 0;
        };

        /** remoteLockedPieces 기준으로 조각 흐림·입력 가능 여부 일괄 반영 (로컬 드래그/선택은 유지) */
        const refreshRemoteLockVisuals = () => {
          const me = getLocalUsername();
          const fallingActive = new Set<number>();
          if (useFallingPieceIntro) {
            for (const fp of fallingPieces) {
              if (fp.progress < 1) fallingActive.add(fp.id);
            }
          }
          for (let id = 0; id < PIECE_COUNT; id++) {
            if (fallingActive.has(id)) {
              continue;
            }
            const pieceContainer = pieces.current.get(id);
            if (!pieceContainer) continue;
            const col = id % GRID_COLS;
            const row = Math.floor(id / GRID_COLS);
            const targetX = boardStartX + col * pieceWidth;
            const targetY = boardStartY + row * pieceHeight;
            const snapped =
              Math.abs(pieceContainer.x - targetX) < 1 && Math.abs(pieceContainer.y - targetY) < 1;

            if (snapped) {
              pieceContainer.alpha = 1;
              pieceContainer.eventMode = 'none';
              continue;
            }

            let heldRemote = false;
            for (const [uid, set] of remoteLockedPieces) {
              if (String(uid) === me) continue;
              if (set.has(id)) {
                heldRemote = true;
                break;
              }
            }

            if (heldRemote) {
              pieceContainer.alpha = 0.5;
              pieceContainer.eventMode = 'none';
              continue;
            }

            if ((isDragging && dragCluster.has(id)) || (selectedCluster && selectedCluster.has(id))) {
              pieceContainer.alpha = 1;
              pieceContainer.eventMode = 'static';
              continue;
            }

            pieceContainer.alpha = 1;
            pieceContainer.eventMode = 'static';
          }
        };

        const savePiecesState = async (updates: {piece_index: number, x: number, y: number, is_locked: boolean}[]) => {
          if (updates.length === 0) return;
          try {
            const payload = updates.map(u => ({
              room_id: roomId,
              piece_index: u.piece_index,
              x: u.x,
              y: u.y,
              is_locked: u.is_locked
            }));
            const { error } = await supabase.from('pixi_pieces').upsert(payload, { onConflict: 'room_id, piece_index' });
            if (error) {
              console.error('Failed to save piece state', error);
            }
          } catch (err) {
            console.error('Exception saving piece state', err);
          }
        };

        const zoomToCompletedPuzzle = (animate = true) => {
          const maxDim = Math.max(boardWidth, boardHeight);
          const boundingBoxSize = maxDim * 1.1; // 웹·토스 와이드 공통 완성 줌 (가로 긴 퍼즐도 동일 기준)
          const targetScale = Math.min(
            app.screen.width / boundingBoxSize,
            app.screen.height / boundingBoxSize,
            1,
          );

          // 토스 와이드: pivot + rotation(-90°). targetX/Y(피벗 0 가정) 대신 보드 중심 = 캔버스 중심.
          if (isTossMode && isTossWideMode) {
            const boardCx = boardStartX + boardWidth / 2;
            const boardCy = boardStartY + boardHeight / 2;
            world.pivot.set(boardCx, boardCy);
            world.position.set(app.screen.width / 2, app.screen.height / 2);
            world.rotation = -Math.PI / 2;

            if (!animate) {
              world.scale.set(targetScale);
              return;
            }

            const startScale = world.scale.x;
            let progress = 0;
            const animateZoomWide = () => {
              progress += 0.02;
              if (progress >= 1) {
                world.scale.set(targetScale);
                app.ticker.remove(animateZoomWide);
                return;
              }
              const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
              world.scale.set(startScale + (targetScale - startScale) * ease);
            };
            app.ticker.add(animateZoomWide);
            return;
          }
          const targetX = (app.screen.width - boardWidth * targetScale) / 2;
          const targetY = (app.screen.height - boardHeight * targetScale) / 2;

          if (!animate) {
            world.scale.set(targetScale);
            world.x = targetX;
            world.y = targetY;
            return;
          }

          const startScale = world.scale.x;
          const startX = world.x;
          const startY = world.y;
          
          let progress = 0;
          const animateZoom = () => {
            progress += 0.02;
            if (progress >= 1) {
              world.scale.set(targetScale);
              world.x = targetX;
              world.y = targetY;
              app.ticker.remove(animateZoom);
              return;
            }
            const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            world.scale.set(startScale + (targetScale - startScale) * ease);
            world.x = startX + (targetX - startX) * ease;
            world.y = startY + (targetY - startY) * ease;
          };
          app.ticker.add(animateZoom);
        };

        const playShineEffect = () => {
          const shineContainer = new PIXI.Container();
          shineContainer.zIndex = 1000;
          
          const thickShine = new PIXI.Graphics();
          thickShine.rect(0, -boardHeight * 2, boardWidth * 0.15, boardHeight * 4);
          thickShine.fill({ color: 0xffffff, alpha: 0.3 });
          thickShine.blendMode = 'add';
          
          const thinShine = new PIXI.Graphics();
          thinShine.rect(boardWidth * 0.18, -boardHeight * 2, boardWidth * 0.03, boardHeight * 4);
          thinShine.fill({ color: 0xffffff, alpha: 0.4 });
          thinShine.blendMode = 'add';
          
          shineContainer.addChild(thickShine);
          shineContainer.addChild(thinShine);
          shineContainer.rotation = Math.PI / 6; // 30도 회전
          
          const mask = new PIXI.Graphics();
          mask.rect(0, 0, boardWidth, boardHeight);
          mask.fill(0xffffff);
          
          shineContainer.mask = mask;
          
          world.addChild(mask);
          world.addChild(shineContainer);
          
          const startX = -boardHeight;
          const endX = boardWidth + boardHeight;
          shineContainer.x = startX;
          shineContainer.y = 0;
          
          let progress = 0;
          const animateShine = () => {
            progress += 0.015; // 애니메이션 속도
            shineContainer.x = startX + (endX - startX) * progress;
            if (progress >= 1) {
              app.ticker.remove(animateShine);
              world.removeChild(shineContainer);
              world.removeChild(mask);
              shineContainer.destroy({ children: true });
              mask.destroy();
            }
          };
          
          // 약간의 딜레이 후 실행 (줌인 애니메이션과 어우러지도록)
          setTimeout(() => {
            app.ticker.add(animateShine);
          }, 500);
        };

        const checkCompletion = async () => {
          if (isCompletedRef.current) return;
          
          let lockedCount = 0;
          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (p) {
              const col = i % GRID_COLS;
              const row = Math.floor(i / GRID_COLS);
              const targetX = boardStartX + col * pieceWidth;
              const targetY = boardStartY + row * pieceHeight;
              if (Math.abs(p.x - targetX) < 1 && Math.abs(p.y - targetY) < 1) {
                lockedCount++;
              }
            }
          }
          setPlacedPieces(lockedCount);
          
          if (lockedCount === PIECE_COUNT) {
            isCompletedRef.current = true;
            
            // Lock all pieces visually
            for (let i = 0; i < PIECE_COUNT; i++) {
              const p = pieces.current.get(i);
              if (p) {
                p.eventMode = 'none';
                p.zIndex = 0;
                p.alpha = 1;
              }
            }

            // Check if we are the first to complete it
            const { data: roomData } = await supabase.from('pixi_rooms').select('status').eq('id', roomId).single();
            
            if (roomData && roomData.status !== 'completed') {
              const { error } = await supabase.from('pixi_rooms').update({ status: 'completed' }).eq('id', roomId);
              if (error) {
                console.error("Failed to update room status to completed:", error);
              } else {
                // Distribute rewards to all participants based on their actual placed pieces
                const { data: roomScores } = await supabase.from('pixi_scores').select('*').eq('room_id', roomId);
                if (roomScores) {
                  for (const rs of roomScores) {
                    // Find user by username (guests will safely fail this check)
                    const { data: uData } = await supabase.from('pixi_users').select('id, completed_puzzles, placed_pieces').eq('username', rs.username).maybeSingle();
                    if (uData) {
                      const newCompleted = (uData.completed_puzzles || 0) + 1;
                      const newPlaced = (uData.placed_pieces || 0) + rs.score;
                      
                      await supabase.from('pixi_users').update({
                        completed_puzzles: newCompleted,
                        placed_pieces: newPlaced
                      }).eq('id', uData.id);

                      // If this is the current user, update local state
                      if (user && user.username === rs.username) {
                        const updatedUser = { ...user, completed_puzzles: newCompleted, placed_pieces: newPlaced };
                        localStorage.setItem('puzzle_user', JSON.stringify(updatedUser));
                        setUser(updatedUser);
                      }
                    }
                  }
                }
              }
            } else if (user && user.id) {
              // Room was already completed, just sync our local user state
              const { data: uData } = await supabase.from('pixi_users').select('completed_puzzles, placed_pieces').eq('id', user.id).maybeSingle();
              if (uData) {
                const updatedUser = { ...user, completed_puzzles: uData.completed_puzzles, placed_pieces: uData.placed_pieces };
                localStorage.setItem('puzzle_user', JSON.stringify(updatedUser));
                setUser(updatedUser);
              }
            }

            if (socketRef.current) {
              socketRef.current.emit(ROOM_EVENTS.PuzzleCompleted, roomId);
            }
            triggerFireworks();
            zoomToCompletedPuzzle(true);
            playShineEffect();
          }
        };

        const triggerFireworks = () => {
          const duration = 3 * 1000;
          const animationEnd = Date.now() + duration;
          const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

          const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

          const interval: any = setInterval(function() {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
              return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({
              ...defaults, particleCount,
              origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
            });
            confetti({
              ...defaults, particleCount,
              origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
            });
          }, 250);
        };

        const updateScore = async (points: number) => {
          if (points <= 0) return;
          const username = user ? user.username : localStorage.getItem('puzzle_guest_name');
          
          // Optimistic UI update
          setScores(prev => {
            const existing = prev.find(s => s.username === username);
            if (existing) {
              return prev.map(s => s.username === username ? { ...s, score: s.score + points } : s).sort((a, b) => b.score - a.score);
            } else {
              return [...prev, { username, score: points }].sort((a, b) => b.score - a.score);
            }
          });

          // DB update
          const { data } = await supabase.from('pixi_scores').select('score').eq('room_id', roomId).eq('username', username).maybeSingle();
          const newScore = (data?.score || 0) + points;
          await supabase.from('pixi_scores').upsert({ room_id: roomId, username, score: newScore }, { onConflict: 'room_id, username' });
          
          // Broadcast score update
          enqueueRealtimeBroadcast('scoreUpdate', { username, score: newScore });
        };

        const getConnectedCluster = (startId: number) => {
          const cluster = new Set<number>([startId]);
          const queue = [startId];
          while (queue.length > 0) {
            const curr = queue.shift()!;
            const c1 = curr % GRID_COLS;
            const r1 = Math.floor(curr / GRID_COLS);
            const p1 = pieces.current.get(curr)!;

            const neighbors = [
              curr - 1,
              curr + 1,
              curr - GRID_COLS,
              curr + GRID_COLS
            ];

            for (const i of neighbors) {
              if (i >= 0 && i < PIECE_COUNT && !cluster.has(i)) {
                const c2 = i % GRID_COLS;
                const r2 = Math.floor(i / GRID_COLS);
                
                const isLogicallyAdjacent = (Math.abs(c1 - c2) === 1 && r1 === r2) || (Math.abs(r1 - r2) === 1 && c1 === c2);
                if (isLogicallyAdjacent) {
                  const p2 = pieces.current.get(i)!;
                  const expectedX = p1.x + (c2 - c1) * pieceWidth;
                  const expectedY = p1.y + (r2 - r1) * pieceHeight;
                  if (Math.abs(p2.x - expectedX) < 1 && Math.abs(p2.y - expectedY) < 1) {
                    cluster.add(i);
                    queue.push(i);
                  }
                }
              }
            }
          }
          return cluster;
        };

        const snapCluster = (cluster: Set<number>) => {
          let snapped = false;
          let offsetX = 0;
          let offsetY = 0;

          // 1. Check piece-to-piece snapping
          for (const id of cluster) {
            if (snapped) break;
            const c1 = id % GRID_COLS;
            const r1 = Math.floor(id / GRID_COLS);
            const p1 = pieces.current.get(id)!;

            const neighbors = [
              id - 1,
              id + 1,
              id - GRID_COLS,
              id + GRID_COLS
            ];

            for (const otherId of neighbors) {
              if (otherId >= 0 && otherId < PIECE_COUNT && !cluster.has(otherId)) {
                const c2 = otherId % GRID_COLS;
                const r2 = Math.floor(otherId / GRID_COLS);
                const isLogicallyAdjacent = (Math.abs(c1 - c2) === 1 && r1 === r2) || (Math.abs(r1 - r2) === 1 && c1 === c2);
                
                if (isLogicallyAdjacent) {
                  const p2 = pieces.current.get(otherId)!;
                  const expectedX = p2.x + (c1 - c2) * pieceWidth;
                  const expectedY = p2.y + (r1 - r2) * pieceHeight;
                  
                  if (Math.abs(p1.x - expectedX) < SNAP_THRESHOLD && Math.abs(p1.y - expectedY) < SNAP_THRESHOLD) {
                    offsetX = expectedX - p1.x;
                    offsetY = expectedY - p1.y;
                    snapped = true;
                    break;
                  }
                }
              }
            }
          }

          // 2. Check board snapping if not snapped to a piece
          if (!snapped) {
            // If the cluster contains all pieces, automatically snap it to the board
            if (cluster.size === PIECE_COUNT) {
              const firstId = Array.from(cluster)[0];
              const c1 = firstId % GRID_COLS;
              const r1 = Math.floor(firstId / GRID_COLS);
              const p1 = pieces.current.get(firstId)!;
              
              const targetX = boardStartX + c1 * pieceWidth;
              const targetY = boardStartY + r1 * pieceHeight;
              
              offsetX = targetX - p1.x;
              offsetY = targetY - p1.y;
              snapped = true;
            } else {
              for (const id of cluster) {
                const c1 = id % GRID_COLS;
                const r1 = Math.floor(id / GRID_COLS);
                const p1 = pieces.current.get(id)!;
                
                const targetX = boardStartX + c1 * pieceWidth;
                const targetY = boardStartY + r1 * pieceHeight;
                
                if (Math.abs(p1.x - targetX) < SNAP_THRESHOLD && Math.abs(p1.y - targetY) < SNAP_THRESHOLD) {
                  offsetX = targetX - p1.x;
                  offsetY = targetY - p1.y;
                  snapped = true;
                  break;
                }
              }
            }
          }

          const updates: any[] = [];
          const dbUpdates: any[] = [];
          if (snapped) {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(25);
            }
            
            cluster.forEach(id => {
              const p = pieces.current.get(id)!;
              p.x += offsetX;
              p.y += offsetY;
              updates.push({ pieceId: id, x: p.x, y: p.y });
            });
          } else {
            cluster.forEach(id => {
              const p = pieces.current.get(id)!;
              updates.push({ pieceId: id, x: p.x, y: p.y });
            });
          }

          // Check if any piece is in the absolute correct position to lock it
          cluster.forEach(id => {
            const p = pieces.current.get(id)!;
            const c = id % GRID_COLS;
            const r = Math.floor(id / GRID_COLS);
            const targetX = boardStartX + c * pieceWidth;
            const targetY = boardStartY + r * pieceHeight;
            
            let isLocked = false;
            if (Math.abs(p.x - targetX) < 1 && Math.abs(p.y - targetY) < 1) {
              p.eventMode = 'none';
              p.zIndex = 0;
              const lockIcon = p.getChildByLabel('lockIcon');
              if (lockIcon) lockIcon.visible = false;
              isLocked = true;
            }
            dbUpdates.push({ piece_index: id, x: p.x, y: p.y, is_locked: isLocked });
          });

          if (updates.length > 0) {
            sendMoveBatch(updates);
          }
          if (dbUpdates.length > 0) {
            savePiecesState(dbUpdates).then(() => {
              checkCompletion();
            });
          }
          
          if (snapped) {
            updateScore(1);
          }
          
          return snapped;
        };

        const dropSelectedCluster = () => {
          if (!selectedCluster) return;
          
          sendUnlockBatch(Array.from(selectedCluster));
          selectedCluster.forEach(id => {
            const p = pieces.current.get(id)!;
            const lockIcon = p.getChildByLabel('lockIcon');
            if (lockIcon) lockIcon.visible = false;
          });

          snapCluster(selectedCluster);
          
          selectedCluster = null;
          isDraggingSelected = false;
        };

        const gatherBorders = async () => {
          if (isBotRunningRef.current) {
            isBotRunningRef.current = false;
            return;
          }
          isBotRunningRef.current = true;
          isColorBotRunningRef.current = false;

          const corners: number[] = [];
          const topPieces: number[] = [];
          const bottomPieces: number[] = [];
          const leftPieces: number[] = [];
          const rightPieces: number[] = [];
          const nonBorderPieces: number[] = [];

          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (p && p.eventMode !== 'none') {
              // Exclude pieces that are inside the puzzle board area
              const centerX = p.x + pieceWidth / 2;
              const centerY = p.y + pieceHeight / 2;
              const isOnBoard = centerX >= boardStartX && centerX <= boardStartX + boardWidth && centerY >= boardStartY && centerY <= boardStartY + boardHeight;
              if (isOnBoard) continue;

              // Exclude pieces that are already combined with others
              if (getConnectedCluster(i).size > 1) continue;

              const col = i % GRID_COLS;
              const row = Math.floor(i / GRID_COLS);
              
              const isTop = row === 0;
              const isBottom = row === GRID_ROWS - 1;
              const isLeft = col === 0;
              const isRight = col === GRID_COLS - 1;

              if ((isTop && isLeft) || (isTop && isRight) || (isBottom && isLeft) || (isBottom && isRight)) {
                corners.push(i);
              } else if (isTop) {
                topPieces.push(i);
              } else if (isBottom) {
                bottomPieces.push(i);
              } else if (isLeft) {
                leftPieces.push(i);
              } else if (isRight) {
                rightPieces.push(i);
              } else {
                nonBorderPieces.push(i);
              }
            }
          }

          const allBorderPieces = [...corners, ...topPieces, ...bottomPieces, ...leftPieces, ...rightPieces];
          if (allBorderPieces.length === 0) {
            isBotRunningRef.current = false;
            return;
          }

          const botTargets = new Map<number, {x: number, y: number}>();
          const claimedSpots: {x: number, y: number}[] = [];
          
          const isSpotFree = (x: number, y: number) => {
            const minDistance = Math.min(pieceWidth, pieceHeight) * 1.2;
            for (const spot of claimedSpots) {
              if (Math.hypot(spot.x - x, spot.y - y) < minDistance) return false;
            }
            for (let i = 0; i < PIECE_COUNT; i++) {
              const p = pieces.current.get(i);
              if (p) {
                if (allBorderPieces.includes(i)) continue; // Ignore pieces that the bot will move anyway
                if (Math.hypot(p.x - x, p.y - y) < minDistance) return false;
              }
            }
            return true;
          };

          const findSpot = (startX: number, startY: number, primaryStepX: number, primaryStepY: number, primaryCount: number, secondaryStepX: number, secondaryStepY: number) => {
            let layer = 0;
            while (layer < 15) {
              for (let i = 0; i < primaryCount; i++) {
                const tx = startX + i * primaryStepX + layer * secondaryStepX;
                const ty = startY + i * primaryStepY + layer * secondaryStepY;
                if (isSpotFree(tx, ty)) {
                  claimedSpots.push({x: tx, y: ty});
                  return {x: tx, y: ty};
                }
              }
              layer++;
            }
            return {x: startX, y: startY};
          };

          const marginX = pieceWidth * 1.6;
          const marginY = pieceHeight * 1.6;
          const spacingX = pieceWidth * 1.6;
          const spacingY = pieceHeight * 1.6;
          
          const startX_left = boardStartX + marginX;
          const startX_right = boardStartX + boardWidth - marginX - pieceWidth;
          const startY_top = boardStartY + marginY;
          const startY_bottom = boardStartY + boardHeight - marginY - pieceHeight;

          const yellowStartX = startX_left + spacingX;
          const yellowCountX = Math.max(1, Math.floor((startX_right - yellowStartX) / spacingX));
          
          const yellowStartY = startY_top + spacingY;
          const yellowCountY = Math.max(1, Math.floor((startY_bottom - yellowStartY) / spacingY));

          // Shuffle each group
          corners.sort(() => Math.random() - 0.5);
          topPieces.sort(() => Math.random() - 0.5);
          bottomPieces.sort(() => Math.random() - 0.5);
          leftPieces.sort(() => Math.random() - 0.5);
          rightPieces.sort(() => Math.random() - 0.5);

          // Assign targets
          corners.forEach(id => {
            const col = id % GRID_COLS;
            const row = Math.floor(id / GRID_COLS);
            let tx, ty, secX, secY;
            if (row === 0 && col === 0) {
              tx = startX_left; ty = startY_top; secX = spacingX; secY = spacingY;
            } else if (row === 0 && col === GRID_COLS - 1) {
              tx = startX_right; ty = startY_top; secX = -spacingX; secY = spacingY;
            } else if (row === GRID_ROWS - 1 && col === 0) {
              tx = startX_left; ty = startY_bottom; secX = spacingX; secY = -spacingY;
            } else {
              tx = startX_right; ty = startY_bottom; secX = -spacingX; secY = -spacingY;
            }
            botTargets.set(id, findSpot(tx, ty, 0, 0, 1, secX, secY));
          });

          topPieces.forEach(id => {
            botTargets.set(id, findSpot(yellowStartX, startY_top, spacingX, 0, yellowCountX, 0, spacingY));
          });

          bottomPieces.forEach(id => {
            botTargets.set(id, findSpot(yellowStartX, startY_bottom, spacingX, 0, yellowCountX, 0, -spacingY));
          });

          leftPieces.forEach(id => {
            botTargets.set(id, findSpot(startX_left, yellowStartY, 0, spacingY, yellowCountY, spacingX, 0));
          });

          rightPieces.forEach(id => {
            botTargets.set(id, findSpot(startX_right, yellowStartY, 0, spacingY, yellowCountY, -spacingX, 0));
          });

          let remainingBorderPieces = [...allBorderPieces];

          const botUsername = 'bot';
          let cursorData = cursors.get(botUsername);
          if (!cursorData) {
            const container = new PIXI.Container();
            const graphics = new PIXI.Graphics();
            graphics.circle(0, 0, 4).fill(0xffffff);
            
            const text = new PIXI.Text({
              text: 'bot',
              style: {
                fontFamily: 'Arial',
                fontSize: 12,
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 2 },
              }
            });
            text.x = 8;
            text.y = 8;
            
            container.addChild(graphics);
            container.addChild(text);
            
            container.x = boardStartX + boardWidth / 2;
            container.y = boardStartY + boardHeight / 2;
            
            cursorsContainer.addChild(container);
            cursorData = { container, targetX: container.x, targetY: container.y };
            cursors.set(botUsername, cursorData);
          }

          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          
          const moveCursorTo = async (tx: number, ty: number, duration: number) => {
            if (!cursorData) return;
            const startX = cursorData.container.x;
            const startY = cursorData.container.y;
            const startTime = Date.now();
            
            return new Promise<void>(resolve => {
              const animate = () => {
                const now = Date.now();
                const progress = Math.min(1, (now - startTime) / duration);
                const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                
                const currentX = startX + (tx - startX) * ease;
                const currentY = startY + (ty - startY) * ease;
                
                cursorData!.container.x = currentX;
                cursorData!.container.y = currentY;
                cursorData!.targetX = currentX;
                cursorData!.targetY = currentY;
                
                sendBotCursorMove(botUsername, currentX, currentY);
                
                if (progress < 1) {
                  requestAnimationFrame(animate);
                } else {
                  resolve();
                }
              };
              requestAnimationFrame(animate);
            });
          };

          let batchedDbUpdates: any[] = [];

          while (remainingBorderPieces.length > 0) {
            if (!isBotRunningRef.current) break;
            
            const currentCursorX = cursorData!.container.x;
            const currentCursorY = cursorData!.container.y;
            
            // Find the closest pieces to the cursor
            const sortedBorderPieces = remainingBorderPieces.map(id => {
              const p = pieces.current.get(id);
              const dist = p ? Math.hypot(p.x - currentCursorX, p.y - currentCursorY) : Infinity;
              return { id, dist };
            }).sort((a, b) => a.dist - b.dist);
            
            // Pick from the top 3 closest to add slight human imperfection
            const poolSize = Math.min(3, sortedBorderPieces.length);
            const selectedIdx = Math.floor(Math.random() * poolSize);
            const id = sortedBorderPieces[selectedIdx].id;
            
            remainingBorderPieces = remainingBorderPieces.filter(pid => pid !== id);
            
            const p = pieces.current.get(id);
            const target = botTargets.get(id);
            if (!p || !target || p.eventMode === 'none') continue;

            // Fake searching behavior (look at nearby non-border pieces)
            if (Math.random() < 0.6 && nonBorderPieces.length > 0) {
              const inspectCount = Math.floor(Math.random() * 2) + 1; // 1 or 2
              for (let k = 0; k < inspectCount; k++) {
                if (!isBotRunningRef.current) break;
                
                const cursorX = cursorData!.container.x;
                const cursorY = cursorData!.container.y;
                
                const sortedNonBorder = [...nonBorderPieces].sort((a, b) => {
                  const pa = pieces.current.get(a);
                  const pb = pieces.current.get(b);
                  if (!pa || !pb) return 0;
                  const distA = Math.hypot(pa.x - cursorX, pa.y - cursorY);
                  const distB = Math.hypot(pb.x - cursorX, pb.y - cursorY);
                  return distA - distB;
                });
                
                const candidates = sortedNonBorder.slice(0, 5);
                const randomNonBorderId = candidates[Math.floor(Math.random() * candidates.length)];
                
                const fakeP = pieces.current.get(randomNonBorderId);
                if (fakeP && fakeP.eventMode !== 'none') {
                  // Move to fake piece
                  await moveCursorTo(fakeP.x, fakeP.y, 400 + Math.random() * 200);
                  // Pause to "inspect"
                  await delay(150 + Math.random() * 150);
                  // Wiggle slightly
                  await moveCursorTo(fakeP.x + 10, fakeP.y + 10, 100);
                  await moveCursorTo(fakeP.x - 5, fakeP.y - 5, 100);
                  await delay(100);
                }
              }
            }

            // Move cursor to actual piece
            await moveCursorTo(p.x, p.y, 500 + Math.random() * 300);
            await delay(200); // grab delay
            
            // Grab piece
            topZIndex++;
            p.zIndex = topZIndex;
            sendLockBatch([id], botUsername);
            
            // Move cursor and piece to target
            const startX = p.x;
            const startY = p.y;
            const tx = target.x;
            const ty = target.y;
            const duration = 600 + Math.random() * 300;
            const startTime = Date.now();
            
            await new Promise<void>(resolve => {
              const animate = () => {
                const now = Date.now();
                const progress = Math.min(1, (now - startTime) / duration);
                const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                
                const currentX = startX + (tx - startX) * ease;
                const currentY = startY + (ty - startY) * ease;
                
                p.x = currentX;
                p.y = currentY;
                
                cursorData!.container.x = currentX;
                cursorData!.container.y = currentY;
                cursorData!.targetX = currentX;
                cursorData!.targetY = currentY;
                
                sendMoveBatch([{ pieceId: id, x: currentX, y: currentY }]);
                
                if (progress < 1) {
                  requestAnimationFrame(animate);
                } else {
                  resolve();
                }
              };
              requestAnimationFrame(animate);
            });
            
            // Drop piece
            const updates = [{ pieceId: id, x: p.x, y: p.y }];
            sendMoveBatch(updates);
            sendUnlockBatch([id], botUsername);
            batchedDbUpdates.push({ piece_index: id, x: p.x, y: p.y, is_locked: false });
            
            if (batchedDbUpdates.length >= 10) {
              savePiecesState([...batchedDbUpdates]); // Fire and forget
              batchedDbUpdates = [];
            }
            
            await delay(100 + Math.random() * 200);
          }

          if (batchedDbUpdates.length > 0) {
            savePiecesState([...batchedDbUpdates]);
            batchedDbUpdates = [];
          }

          if (cursorData) {
            cursorData.container.destroy();
            cursors.delete(botUsername);
            enqueueRealtimeBroadcast('cursorMove', {
              username: botUsername,
              x: -9999,
              y: -9999,
            });
          }

          isBotRunningRef.current = false;
        };

        const extractPieceColors = async () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;

          const img = new Image();
          img.src = objectUrlRef.current || imageUrl;
          try {
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
            });
          } catch (e) {
            console.error('Failed to load image for color analysis', e);
            return null;
          }

          canvas.width = boardWidth;
          canvas.height = boardHeight;
          ctx.drawImage(img, 0, 0, boardWidth, boardHeight);

          const getAverageColor = (x: number, y: number, w: number, h: number) => {
            try {
              const imgData = ctx.getImageData(x, y, w, h);
              const data = imgData.data;
              let r = 0, g = 0, b = 0;
              let count = 0;
              for (let i = 0; i < data.length; i += 16) {
                r += data[i];
                g += data[i+1];
                b += data[i+2];
                count++;
              }
              return { r: r/count, g: g/count, b: b/count };
            } catch (e) {
              return { r: 128, g: 128, b: 128 };
            }
          };

          const rgbToHsl = (r: number, g: number, b: number) => {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h = 0, s = 0, l = (max + min) / 2;
            if (max !== min) {
              const d = max - min;
              s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
              switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
              }
              h /= 6;
            }
            return { h: h * 360, s, l };
          };

          const getColorGroup = (h: number, s: number, l: number) => {
            if (l < 0.15) return 'black';
            if (l > 0.85) return 'white';
            if (s < 0.15) return 'gray';
            if (h < 30 || h >= 330) return 'red';
            if (h < 90) return 'yellow';
            if (h < 150) return 'green';
            if (h < 210) return 'cyan';
            if (h < 270) return 'blue';
            return 'purple';
          };

          const pieceColorData = new Map<number, { group: string, h: number, s: number, l: number }>();
          const pieceColorsRGB = new Map<number, { r: number, g: number, b: number }>();
          const nonLockedPieces: number[] = [];

          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (p && p.eventMode !== 'none') {
              // Exclude pieces that are inside the puzzle board area
              const centerX = p.x + pieceWidth / 2;
              const centerY = p.y + pieceHeight / 2;
              const isOnBoard = centerX >= boardStartX && centerX <= boardStartX + boardWidth && centerY >= boardStartY && centerY <= boardStartY + boardHeight;
              if (isOnBoard) continue;

              // Exclude pieces that are already combined with others
              if (getConnectedCluster(i).size > 1) continue;

              nonLockedPieces.push(i);
              const col = i % GRID_COLS;
              const row = Math.floor(i / GRID_COLS);
              const x = col * pieceWidth;
              const y = row * pieceHeight;
              const { r, g, b } = getAverageColor(x, y, pieceWidth, pieceHeight);
              pieceColorsRGB.set(i, { r, g, b });
              const { h, s, l } = rgbToHsl(r, g, b);
              const group = getColorGroup(h, s, l);
              pieceColorData.set(i, { group, h, s, l });
            }
          }

          return { nonLockedPieces, pieceColorData, pieceColorsRGB };
        };

        const executeBotMoves = async (botTargets: Map<number, {x: number, y: number}>, quick: boolean) => {
          if (quick) {
            const updates: {pieceId: number, x: number, y: number}[] = [];
            const dbUpdates: any[] = [];
            
            for (const [id, target] of botTargets.entries()) {
              const p = pieces.current.get(id);
              if (p && p.eventMode !== 'none') {
                p.x = target.x;
                p.y = target.y;
                topZIndex++;
                p.zIndex = topZIndex;
                updates.push({ pieceId: id, x: target.x, y: target.y });
                dbUpdates.push({ piece_index: id, x: target.x, y: target.y, is_locked: false });
              }
            }
            
            if (updates.length > 0) {
              sendMoveBatch(updates);
              await savePiecesState(dbUpdates);
            }
            
            isColorBotRunningRef.current = false;
            return;
          }

          let remainingPieces = Array.from(botTargets.keys()).filter(id => {
            const p = pieces.current.get(id);
            const target = botTargets.get(id);
            if (!p || !target) return false;
            return Math.hypot(p.x - target.x, p.y - target.y) > 10;
          });
          
          const botUsername = 'bot';
          let cursorData = cursors.get(botUsername);
          if (!cursorData) {
            const container = new PIXI.Container();
            const graphics = new PIXI.Graphics();
            graphics.circle(0, 0, 4).fill(0xffffff);
            
            const text = new PIXI.Text({
              text: 'bot',
              style: {
                fontFamily: 'Arial',
                fontSize: 12,
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 2 }
              }
            });
            text.x = 8;
            text.y = 8;
            
            container.addChild(graphics);
            container.addChild(text);
            
            container.x = boardStartX + boardWidth / 2;
            container.y = boardStartY + boardHeight / 2;
            
            cursorsContainer.addChild(container);
            cursorData = { container, targetX: container.x, targetY: container.y };
            cursors.set(botUsername, cursorData);
          }

          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          
          const moveCursorTo = async (tx: number, ty: number, duration: number) => {
            if (!cursorData) return;
            const startX = cursorData.container.x;
            const startY = cursorData.container.y;
            const startTime = Date.now();
            
            return new Promise<void>(resolve => {
              const animate = () => {
                const now = Date.now();
                const progress = Math.min(1, (now - startTime) / duration);
                const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                
                const currentX = startX + (tx - startX) * ease;
                const currentY = startY + (ty - startY) * ease;
                
                cursorData!.container.x = currentX;
                cursorData!.container.y = currentY;
                cursorData!.targetX = currentX;
                cursorData!.targetY = currentY;
                
                sendBotCursorMove(botUsername, currentX, currentY);
                
                if (progress < 1 && isColorBotRunningRef.current) {
                  requestAnimationFrame(animate);
                } else {
                  resolve();
                }
              };
              requestAnimationFrame(animate);
            });
          };

          let nextPieceToMove: number | null = null;
          let batchedDbUpdates: any[] = [];

          while (remainingPieces.length > 0) {
            if (!isColorBotRunningRef.current) break;
            
            let targetPieceId: number;

            if (nextPieceToMove !== null && remainingPieces.includes(nextPieceToMove)) {
              targetPieceId = nextPieceToMove;
            } else {
              const currentCursorX = cursorData!.container.x;
              const currentCursorY = cursorData!.container.y;
              
              const sortedPieces = remainingPieces.map(id => {
                const p = pieces.current.get(id);
                const dist = p ? Math.hypot(p.x - currentCursorX, p.y - currentCursorY) : Infinity;
                return { id, dist };
              }).sort((a, b) => a.dist - b.dist);
              
              const poolSize = Math.min(3, sortedPieces.length);
              const randomIndex = Math.floor(Math.random() * poolSize);
              targetPieceId = sortedPieces[randomIndex].id;
            }
            
            remainingPieces = remainingPieces.filter(id => id !== targetPieceId);
            nextPieceToMove = null;
            
            const p = pieces.current.get(targetPieceId);
            const target = botTargets.get(targetPieceId);
            if (!p || !target || p.eventMode === 'none') continue;
            if (dragCluster.has(targetPieceId) || (selectedCluster && selectedCluster.has(targetPieceId))) continue;

            const distToPiece = Math.hypot(p.x - cursorData!.container.x, p.y - cursorData!.container.y);
            await moveCursorTo(p.x, p.y, Math.max(200, distToPiece * 0.5));
            if (!isColorBotRunningRef.current) break;

            topZIndex++;
            p.zIndex = topZIndex;
            sendLockBatch([targetPieceId], botUsername);
            
            const distToTarget = Math.hypot(target.x - p.x, target.y - p.y);
            const startX = cursorData!.container.x;
            const startY = cursorData!.container.y;
            const startTime = Date.now();
            const duration = Math.max(300, distToTarget * 0.6);
            
            await new Promise<void>(resolve => {
              const animate = () => {
                if (!isColorBotRunningRef.current) {
                  resolve();
                  return;
                }
                const now = Date.now();
                const progress = Math.min(1, (now - startTime) / duration);
                const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
                
                const currentX = startX + (target.x - startX) * ease;
                const currentY = startY + (target.y - startY) * ease;
                
                p.x = currentX;
                p.y = currentY;
                
                cursorData!.container.x = currentX;
                cursorData!.container.y = currentY;
                cursorData!.targetX = currentX;
                cursorData!.targetY = currentY;
                
                sendMoveBatch([{ pieceId: targetPieceId, x: currentX, y: currentY }]);
                
                if (progress < 1) {
                  requestAnimationFrame(animate);
                } else {
                  resolve();
                }
              };
              requestAnimationFrame(animate);
            });
            
            const updates = [{ pieceId: targetPieceId, x: p.x, y: p.y }];
            sendMoveBatch(updates);
            sendUnlockBatch([targetPieceId], botUsername);
            batchedDbUpdates.push({ piece_index: targetPieceId, x: p.x, y: p.y, is_locked: false });
            
            if (batchedDbUpdates.length >= 10) {
              savePiecesState([...batchedDbUpdates]); // Fire and forget to avoid blocking animation
              batchedDbUpdates = [];
            }
            
            const overlappingPiece = remainingPieces.find(id => {
               const otherP = pieces.current.get(id);
               if (!otherP) return false;
               return Math.hypot(otherP.x - target.x, otherP.y - target.y) < 20;
            });

            if (overlappingPiece !== undefined) {
               nextPieceToMove = overlappingPiece;
            }

            await delay(100 + Math.random() * 200);
          }

          if (batchedDbUpdates.length > 0) {
            savePiecesState([...batchedDbUpdates]);
            batchedDbUpdates = [];
          }

          if (cursorData) {
            cursorData.container.destroy();
            cursors.delete(botUsername);
            enqueueRealtimeBroadcast('cursorMove', {
              username: botUsername,
              x: -9999,
              y: -9999,
            });
          }

          isColorBotRunningRef.current = false;
        };

        const gatherByColor = async (quick: boolean = false) => {
          if (isColorBotRunningRef.current) {
            isColorBotRunningRef.current = false;
            return;
          }
          isColorBotRunningRef.current = true;
          isBotRunningRef.current = false;
          setIsColorBotLoading(true);

          const colorData = await extractPieceColors();
          if (!colorData) {
            setIsColorBotLoading(false);
            isColorBotRunningRef.current = false;
            return;
          }

          const { nonLockedPieces, pieceColorData } = colorData;

          if (!isColorBotRunningRef.current) return;

          const colorOrder = ['red', 'yellow', 'green', 'cyan', 'blue', 'purple', 'black', 'white', 'gray'];
          
          nonLockedPieces.sort((a, b) => {
            const colorA = pieceColorData.get(a)!;
            const colorB = pieceColorData.get(b)!;
            
            const groupDiff = colorOrder.indexOf(colorA.group) - colorOrder.indexOf(colorB.group);
            if (groupDiff !== 0) return groupDiff;
            
            if (colorA.group === 'gray' || colorA.group === 'black' || colorA.group === 'white') {
              return colorB.l - colorA.l; // Sort by lightness
            }
            return colorA.h - colorB.h; // Sort by hue
          });

          const uShapedPositions = [...initialPositionsRef.current].sort((a, b) => {
            const angleA = Math.atan2(a.y + boardHeight * 2, a.x - boardWidth / 2);
            const angleB = Math.atan2(b.y + boardHeight * 2, b.x - boardWidth / 2);
            return angleB - angleA;
          });

          const botTargets = new Map<number, {x: number, y: number}>();
          for (let i = 0; i < nonLockedPieces.length; i++) {
            const id = nonLockedPieces[i];
            const targetPos = uShapedPositions[i];
            if (targetPos) {
              botTargets.set(id, { x: targetPos.x, y: targetPos.y });
            }
          }

          setIsColorBotLoading(false);
          await executeBotMoves(botTargets, quick);
        };

        const createMosaicFromImage = async (targetImageUrl: string, quick: boolean = false, gapMultiplier: number = 1.6) => {
          if (isColorBotRunningRef.current) {
            isColorBotRunningRef.current = false;
            return;
          }
          isColorBotRunningRef.current = true;
          isBotRunningRef.current = false;
          setIsColorBotLoading(true);

          const colorData = await extractPieceColors();
          if (!colorData) {
            setIsColorBotLoading(false);
            isColorBotRunningRef.current = false;
            return;
          }

          const { nonLockedPieces, pieceColorsRGB } = colorData;

          if (!isColorBotRunningRef.current) return;

          let tempObjectUrl = '';
          try {
            let img: HTMLImageElement | null = null;
            
            const tryLoadMosaicImage = async (url: string): Promise<{ objectUrl: string, img: HTMLImageElement }> => {
              const response = await fetch(url, { mode: 'cors' });
              if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);
              const blob = await response.blob();
              const objUrl = URL.createObjectURL(blob);
              
              const testImg = new Image();
              testImg.src = objUrl;
              await new Promise((resolve, reject) => {
                testImg.onload = resolve;
                testImg.onerror = () => reject(new Error('Image failed to load from object URL'));
              });
              return { objectUrl: objUrl, img: testImg };
            };

            try {
              const result = await tryLoadMosaicImage(targetImageUrl);
              tempObjectUrl = result.objectUrl;
              img = result.img;
            } catch (e) {
              console.error('Error fetching mosaic image directly, trying proxy 1:', e);
              try {
                const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetImageUrl)}`;
                const result = await tryLoadMosaicImage(proxyUrl);
                tempObjectUrl = result.objectUrl;
                img = result.img;
              } catch (e2) {
                console.error('Error fetching mosaic image via codetabs, trying proxy 2:', e2);
                try {
                  const proxyUrl2 = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetImageUrl)}`;
                  const result = await tryLoadMosaicImage(proxyUrl2);
                  tempObjectUrl = result.objectUrl;
                  img = result.img;
                } catch (e3) {
                  console.error('Error fetching mosaic image via allorigins, trying proxy 3:', e3);
                  try {
                    const proxyUrl3 = `https://corsproxy.io/?${encodeURIComponent(targetImageUrl)}`;
                    const result = await tryLoadMosaicImage(proxyUrl3);
                    tempObjectUrl = result.objectUrl;
                    img = result.img;
                  } catch (e4) {
                    console.error('Error fetching mosaic image via corsproxy.io, trying proxy 4:', e4);
                    try {
                      const proxyUrl4 = `https://wsrv.nl/?url=${encodeURIComponent(targetImageUrl)}`;
                      const result = await tryLoadMosaicImage(proxyUrl4);
                      tempObjectUrl = result.objectUrl;
                      img = result.img;
                    } catch (e5) {
                      console.error('Error fetching mosaic image via wsrv.nl, trying proxy 5:', e5);
                      try {
                        const result = await tryLoadImageAllOriginsGet(targetImageUrl);
                        tempObjectUrl = result.objectUrl;
                        img = result.img;
                      } catch (e6) {
                        console.error('Error fetching mosaic image via allorigins get:', e6);
                        throw e6;
                      }
                    }
                  }
                }
              }
            }

            if (!isColorBotRunningRef.current) {
              if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
              return;
            }

            const imgW = img.width;
            const imgH = img.height;
            const ar = imgW / imgH;

            let cols = Math.floor(Math.sqrt(nonLockedPieces.length * ar));
            let rows = Math.floor(cols / ar);
            
            if (cols * rows > nonLockedPieces.length) {
              while (cols * rows > nonLockedPieces.length) {
                if (cols / rows > ar) cols--;
                else rows--;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = cols;
            canvas.height = rows;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0, cols, rows);
            const imgData = ctx.getImageData(0, 0, cols, rows).data;

            const pixels: {x: number, y: number, r: number, g: number, b: number}[] = [];
            for (let y = 0; y < rows; y++) {
              for (let x = 0; x < cols; x++) {
                const i = (y * cols + x) * 4;
                pixels.push({
                  x, y,
                  r: imgData[i],
                  g: imgData[i+1],
                  b: imgData[i+2]
                });
              }
            }

            const availablePieces = [...nonLockedPieces];
            const botTargets = new Map<number, {x: number, y: number}>();

            const mosaicWidth = cols > 0 ? (cols - 1) * (pieceWidth * gapMultiplier) + pieceWidth : 0;
            
            const startX = (boardWidth - mosaicWidth) / 2;
            const startY = boardHeight + pieceHeight * 2;

            // Sort pixels by color intensity (distance from gray) descending.
            // This ensures that the most colorful and distinct parts of the image get the best matching pieces first,
            // while the duller/grayer areas get the leftover pieces, which acts like noise/dithering.
            const sortedPixels = [...pixels].sort((a, b) => {
              const distA = Math.pow(a.r - 128, 2) + Math.pow(a.g - 128, 2) + Math.pow(a.b - 128, 2);
              const distB = Math.pow(b.r - 128, 2) + Math.pow(b.g - 128, 2) + Math.pow(b.b - 128, 2);
              return distB - distA;
            });

            for (const pixel of sortedPixels) {
              let bestPieceIdx = -1;
              let minDistance = Infinity;

              for (let i = 0; i < availablePieces.length; i++) {
                const pieceId = availablePieces[i];
                const color = pieceColorsRGB.get(pieceId)!;
                const dist = Math.pow(color.r - pixel.r, 2) + 
                             Math.pow(color.g - pixel.g, 2) + 
                             Math.pow(color.b - pixel.b, 2);
                
                if (dist < minDistance) {
                  minDistance = dist;
                  bestPieceIdx = i;
                }
              }

              if (bestPieceIdx !== -1) {
                const pieceId = availablePieces[bestPieceIdx];
                availablePieces.splice(bestPieceIdx, 1);
                
                botTargets.set(pieceId, {
                  x: startX + pixel.x * (pieceWidth * gapMultiplier),
                  y: startY + pixel.y * (pieceHeight * gapMultiplier)
                });
              }
            }

            // --- Heart shape logic for leftover pieces ---
            const leftoverCount = availablePieces.length;
            if (leftoverCount > 0) {
              const leftCount = Math.floor(leftoverCount / 2);
              const rightCount = Math.ceil(leftoverCount / 2);

              const getHeartPoints = (count: number) => {
                if (count === 0) return [];
                let low = 0.1;
                let high = 50.0;
                let bestPoints: {x: number, y: number, val: number}[] = [];
                for (let iter = 0; iter < 30; iter++) {
                  let mid = (low + high) / 2;
                  let currentPoints: {x: number, y: number, val: number}[] = [];
                  let bound = Math.ceil(mid * 1.5);
                  for (let y = -bound; y <= bound; y++) {
                    for (let x = -bound; x <= bound; x++) {
                      let nx = x / mid;
                      let ny = -y / mid;
                      // Heart equation: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
                      let val = Math.pow(nx*nx + ny*ny - 1, 3) - nx*nx * ny*ny*ny;
                      if (val <= 0) {
                        currentPoints.push({x, y, val});
                      }
                    }
                  }
                  if (currentPoints.length >= count) {
                    bestPoints = currentPoints;
                    high = mid;
                  } else {
                    low = mid;
                  }
                }
                // Sort by val ascending (most negative first, which means deepest inside the heart)
                bestPoints.sort((a, b) => a.val - b.val);
                return bestPoints.slice(0, count);
              };

              const leftHeart = getHeartPoints(leftCount);
              const rightHeart = getHeartPoints(rightCount);

              const getBounds = (pts: {x: number, y: number}[]) => {
                if (pts.length === 0) return {minX: 0, maxX: 0, minY: 0, maxY: 0};
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (let p of pts) {
                  if (p.x < minX) minX = p.x;
                  if (p.x > maxX) maxX = p.x;
                  if (p.y < minY) minY = p.y;
                  if (p.y > maxY) maxY = p.y;
                }
                return {minX, maxX, minY, maxY};
              };

              const leftBounds = getBounds(leftHeart);
              const rightBounds = getBounds(rightHeart);

              const mosaicHeight = rows > 0 ? (rows - 1) * (pieceHeight * gapMultiplier) + pieceHeight : 0;
              const centerY = startY + mosaicHeight / 2;
              
              const padding = pieceWidth * gapMultiplier * 2;
              const scaleX = pieceWidth * gapMultiplier;
              const scaleY = pieceHeight * gapMultiplier;

              const leftHeartCenterX = startX - padding - leftBounds.maxX * scaleX;
              const leftHeartCenterY = centerY - ((leftBounds.minY + leftBounds.maxY) / 2) * scaleY;

              const rightHeartCenterX = startX + mosaicWidth + padding - rightBounds.minX * scaleX;
              const rightHeartCenterY = centerY - ((rightBounds.minY + rightBounds.maxY) / 2) * scaleY;

              // Sort remaining pieces so the most "red" ones are at the end (to be popped first)
              // This makes the center of the hearts red!
              availablePieces.sort((a, b) => {
                const cA = pieceColorsRGB.get(a)!;
                const cB = pieceColorsRGB.get(b)!;
                const redA = cA.r - cA.g - cA.b;
                const redB = cB.r - cB.g - cB.b;
                return redA - redB; // Least red first
              });

              for (let i = 0; i < Math.max(leftHeart.length, rightHeart.length); i++) {
                if (i < leftHeart.length && availablePieces.length > 0) {
                  const pieceId = availablePieces.pop()!;
                  botTargets.set(pieceId, {
                    x: leftHeartCenterX + leftHeart[i].x * scaleX,
                    y: leftHeartCenterY + leftHeart[i].y * scaleY
                  });
                }
                if (i < rightHeart.length && availablePieces.length > 0) {
                  const pieceId = availablePieces.pop()!;
                  botTargets.set(pieceId, {
                    x: rightHeartCenterX + rightHeart[i].x * scaleX,
                    y: rightHeartCenterY + rightHeart[i].y * scaleY
                  });
                }
              }

              // Place any remaining pieces at the bottom
              if (availablePieces.length > 0) {
                const bottomY = startY + mosaicHeight + pieceHeight * 4;
                const piecesPerRow = Math.max(1, Math.floor(boardWidth / (pieceWidth * gapMultiplier)));
                
                for (let i = 0; i < availablePieces.length; i++) {
                  const pieceId = availablePieces[i];
                  const row = Math.floor(i / piecesPerRow);
                  const col = i % piecesPerRow;
                  
                  // Calculate row width for centering
                  const piecesInThisRow = row === Math.floor(availablePieces.length / piecesPerRow) 
                    ? availablePieces.length % piecesPerRow 
                    : piecesPerRow;
                  const rowWidth = (piecesInThisRow > 0 ? piecesInThisRow : piecesPerRow) * pieceWidth * gapMultiplier;
                  
                  botTargets.set(pieceId, {
                    x: (boardWidth - rowWidth) / 2 + col * pieceWidth * gapMultiplier,
                    y: bottomY + row * pieceHeight * gapMultiplier
                  });
                }
              }
            }

            setIsColorBotLoading(false);
            if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
            await executeBotMoves(botTargets, quick);
          } catch (error) {
            console.error("Failed to load image for mosaic:", error);
            setIsColorBotLoading(false);
            isColorBotRunningRef.current = false;
            setMosaicError("Failed to load image for mosaic. The URL might be invalid or blocking access.");
            if (tempObjectUrl) URL.revokeObjectURL(tempObjectUrl);
            throw error;
          }
        };

        gatherBordersRef.current = gatherBorders;
        gatherByColorRef.current = gatherByColor;
        createMosaicFromImageRef.current = createMosaicFromImage;

        bumpProgress(46);
        const { data: existingPieces } = await supabase.from('pixi_pieces').select('*').eq('room_id', roomId);
        const hasExistingState = existingPieces && existingPieces.length > 0;
        const pieceStates = new Map<number, any>();
        if (hasExistingState) {
          existingPieces.forEach(p => pieceStates.set(p.piece_index, p));
        }

        const initialPositions: {x: number, y: number}[] = [];
        placeLayer = 1;
        
        while (initialPositions.length < PIECE_COUNT) {
          const minX = -placeLayer * spacingX;
          // Adjust maxX and maxY by pieceWidth/pieceHeight so the visual gap is symmetric
          // (since piece coordinates represent their top-left corner)
          const maxX = boardWidth - pieceWidth + placeLayer * spacingX;
          const minY = 0; // Start from the top edge of the board
          const maxY = boardHeight - pieceHeight + placeLayer * spacingY;

          const countX = Math.ceil((maxX - minX) / spacingX);
          const countY = Math.ceil((maxY - minY) / spacingY);

          const layerPositions: {x: number, y: number}[] = [];

          // 1. Left and Right edges (from top to bottom)
          for (let stepY = 0; stepY <= countY; stepY++) {
            const py = minY + stepY * ((maxY - minY) / countY);
            layerPositions.push({ x: minX, y: py });
            layerPositions.push({ x: maxX, y: py });
          }

          // 2. Bottom edge (from outside to inside)
          let leftStep = 1;
          let rightStep = countX - 1;
          while (leftStep <= rightStep) {
            const pxLeft = minX + leftStep * ((maxX - minX) / countX);
            layerPositions.push({ x: pxLeft, y: maxY });
            if (leftStep !== rightStep) {
              const pxRight = minX + rightStep * ((maxX - minX) / countX);
              layerPositions.push({ x: pxRight, y: maxY });
            }
            leftStep++;
            rightStep--;
          }

          // Add to initialPositions until we reach PIECE_COUNT
          // To ensure symmetry, we add in pairs (left/right) when possible
          for (let i = 0; i < layerPositions.length; i++) {
            if (initialPositions.length < PIECE_COUNT) {
              initialPositions.push(layerPositions[i]);
            } else {
              break;
            }
          }

          placeLayer++;
        }
        
        initialPositionsRef.current = [...initialPositions];
        
        if (!hasExistingState) {
          // Shuffle positions
          for (let i = initialPositions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [initialPositions[i], initialPositions[j]] = [initialPositions[j], initialPositions[i]];
          }
          
          const inserts = initialPositions.map((pos, i) => ({
            room_id: roomId,
            piece_index: i,
            x: pos.x,
            y: pos.y,
            is_locked: false
          }));
          
          for (let i = 0; i < inserts.length; i += 500) {
             const { error } = await supabase.from('pixi_pieces').insert(inserts.slice(i, i + 500));
             if (error) {
               console.error('Error inserting pieces:', error);
               alert(`Error inserting pieces: ${error.message}`);
             }
          }
          
          // Update the room's piece_count to the actual generated count
          await supabase.from('pixi_rooms').update({ piece_count: PIECE_COUNT }).eq('id', roomId);
        } else if (existingPieces && existingPieces.length < PIECE_COUNT) {
          // Handle missing pieces
          const missingIndices = [];
          for (let i = 0; i < PIECE_COUNT; i++) {
            if (!pieceStates.has(i)) {
              missingIndices.push(i);
            }
          }
          
          if (missingIndices.length > 0) {
            // Shuffle available initial positions for missing pieces
            const availablePositions = [...initialPositions];
            for (let i = availablePositions.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [availablePositions[i], availablePositions[j]] = [availablePositions[j], availablePositions[i]];
            }
            
            const inserts = missingIndices.map((index, i) => {
              const pos = availablePositions[i % availablePositions.length];
              const state = {
                room_id: roomId,
                piece_index: index,
                x: pos.x,
                y: pos.y,
                is_locked: false
              };
              pieceStates.set(index, state);
              return state;
            });
            
            for (let i = 0; i < inserts.length; i += 500) {
               const { error } = await supabase.from('pixi_pieces').insert(inserts.slice(i, i + 500));
               if (error) {
                 console.error('Error inserting missing pieces:', error);
               }
            }
          }
        }

        bumpProgress(50);

        if (FAST_PIECE_INIT) {
          const lockBorderColorOnce = isTossMode ? 0x3182f6 : 0x9333ea;
          const lockOutlineWOnce = 3.5;
          const lockIconGraphicsOnce = new PIXI.Graphics();
          lockIconGraphicsOnce.roundRect(-7.5, -19.5, 15, 12, 4);
          const lockStrokeWOnce = lockOutlineWOnce * canvasOutlineScale;
          lockIconGraphicsOnce.stroke({ width: lockStrokeWOnce, color: lockBorderColorOnce, alpha: 1, alignment: 0 });
          lockIconGraphicsOnce.roundRect(-12, -11, 24, 19, 4);
          lockIconGraphicsOnce.stroke({ width: lockStrokeWOnce, color: lockBorderColorOnce, alpha: 1, alignment: 0 });
          lockIconGraphicsOnce.roundRect(-12, -11, 24, 19, 4);
          lockIconGraphicsOnce.fill({ color: 0xffffff, alpha: 1 });
          lockIconGraphicsOnce.roundRect(-7.5, -19.5, 15, 12, 4);
          lockIconGraphicsOnce.stroke({ width: lockStrokeWOnce, color: 0xffffff, alpha: 1, alignment: 1 });
          let lockResOnce = Math.min(window.devicePixelRatio || 1, 2);
          if (PIECE_COUNT > 500) lockResOnce = Math.min(lockResOnce, 1);
          if (isCanvasRenderer) lockResOnce *= 0.25;
          sharedLockTexture = app.renderer.generateTexture({
            target: lockIconGraphicsOnce,
            resolution: lockResOnce,
          });
          lockIconGraphicsOnce.destroy();
        }

        let initialPlacedCount = 0;
        for (let i = 0; i < PIECE_COUNT; i++) {
          if (FAST_PIECE_INIT) {
            if (i > 0 && i % 30 === 0) {
              bumpProgress(50 + (49 * i) / Math.max(1, PIECE_COUNT));
            }
          } else {
            if (i > 0 && i % 5 === 0) {
              bumpProgress(50 + (49 * i) / Math.max(1, PIECE_COUNT));
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }
          }

          const col = i % GRID_COLS;
          const row = Math.floor(i / GRID_COLS);

          const topTab = row === 0 ? 0 : -horizontalTabs[row - 1][col];
          const rightTab = col === GRID_COLS - 1 ? 0 : verticalTabs[row][col];
          const bottomTab = row === GRID_ROWS - 1 ? 0 : horizontalTabs[row][col];
          const leftTab = col === 0 ? 0 : -verticalTabs[row][col - 1];

          const pieceContainer = new PIXI.Container();

          const applyPieceShape = (g: PIXI.Graphics) => {
            g.moveTo(0, 0);
            drawEdge(g, 0, 0, pieceWidth, 0, topTab, tabDepth);
            drawEdge(g, pieceWidth, 0, pieceWidth, pieceHeight, rightTab, tabDepth);
            drawEdge(g, pieceWidth, pieceHeight, 0, pieceHeight, bottomTab, tabDepth);
            drawEdge(g, 0, pieceHeight, 0, 0, leftTab, tabDepth);
            g.closePath();
          };

          const pieceGraphics = new PIXI.Graphics();
          applyPieceShape(pieceGraphics);

          const matrix = new PIXI.Matrix();
          matrix.scale(boardWidth / texture.width, boardHeight / texture.height);
          matrix.translate(-col * pieceWidth, -row * pieceHeight);

          const strokeWidth = 1 * canvasOutlineScale;

          pieceGraphics.fill({ texture: texture, matrix: matrix, textureSpace: 'global' });
          pieceGraphics.stroke({ color: 0x000000, alpha: 0.2, width: strokeWidth });

          const ENABLE_BEVEL = false;
          let renderTarget: PIXI.Container | PIXI.Graphics = pieceGraphics;

          if (ENABLE_BEVEL) {
            const bevelContainer = new PIXI.Container();
            bevelContainer.addChild(pieceGraphics);

            const whiteLine = new PIXI.Graphics();
            applyPieceShape(whiteLine);
            whiteLine.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
            whiteLine.x = 1;
            whiteLine.y = 1;
            const blurWhite = new PIXI.BlurFilter();
            blurWhite.strength = 1;
            whiteLine.filters = [blurWhite];

            const blackLine = new PIXI.Graphics();
            applyPieceShape(blackLine);
            blackLine.stroke({ width: 1, color: 0x000000, alpha: 0.6 });
            blackLine.x = -1;
            blackLine.y = -1;
            const blurBlack = new PIXI.BlurFilter();
            blurBlack.strength = 1;
            blackLine.filters = [blurBlack];

            const maskGraphics = new PIXI.Graphics();
            applyPieceShape(maskGraphics);
            maskGraphics.fill({ color: 0xffffff });

            bevelContainer.addChild(whiteLine);
            bevelContainer.addChild(blackLine);
            bevelContainer.addChild(maskGraphics);

            whiteLine.mask = maskGraphics;
            blackLine.mask = maskGraphics;

            renderTarget = bevelContainer;
          }

          const bounds = pieceGraphics.getLocalBounds();
          const minX = bounds.minX !== undefined ? bounds.minX : bounds.x;
          const minY = bounds.minY !== undefined ? bounds.minY : bounds.y;
          const maxX = bounds.maxX !== undefined ? bounds.maxX : bounds.x + bounds.width;
          const maxY = bounds.maxY !== undefined ? bounds.maxY : bounds.y + bounds.height;

          let lockIconSprite: PIXI.Sprite;

          if (FAST_PIECE_INIT) {
            pieceContainer.interactiveChildren = false;
            renderTarget.label = 'pieceSprite';
            renderTarget.eventMode = 'none';
            pieceContainer.addChild(renderTarget);

            lockIconSprite = new PIXI.Sprite(sharedLockTexture!);
            lockIconSprite.anchor.set(0.5);
            lockIconSprite.x = pieceWidth / 2;
            lockIconSprite.y = pieceHeight / 2;
            lockIconSprite.scale.set(1.08);
            lockIconSprite.visible = false;
            lockIconSprite.label = 'lockIcon';
            lockIconSprite.eventMode = 'none';
            pieceContainer.addChild(lockIconSprite);
          } else {
            const lockBorderColor = isTossMode ? 0x3182f6 : 0x9333ea;
            const lockOutlineW = 3.5 * canvasOutlineScale;
            const lockIconGraphics = new PIXI.Graphics();
            lockIconGraphics.roundRect(-7.5, -19.5, 15, 12, 4);
            lockIconGraphics.stroke({ width: lockOutlineW, color: lockBorderColor, alpha: 1, alignment: 0 });
            lockIconGraphics.roundRect(-12, -11, 24, 19, 4);
            lockIconGraphics.stroke({ width: lockOutlineW, color: lockBorderColor, alpha: 1, alignment: 0 });
            lockIconGraphics.roundRect(-12, -11, 24, 19, 4);
            lockIconGraphics.fill({ color: 0xffffff, alpha: 1 });
            lockIconGraphics.roundRect(-7.5, -19.5, 15, 12, 4);
            lockIconGraphics.stroke({ width: lockOutlineW, color: 0xffffff, alpha: 1, alignment: 1 });

            let maxRes = 2;
            if (PIECE_COUNT > 500) maxRes = 1;
            else if (PIECE_COUNT > 200) maxRes = 1.5;

            let targetResolution = Math.min(window.devicePixelRatio || 1, maxRes);
            if (isCanvasRenderer) {
              targetResolution *= 0.25;
            }

            const padding = 40;
            const frame = new PIXI.Rectangle(
              minX - padding,
              minY - padding,
              maxX - minX + padding * 2,
              maxY - minY + padding * 2,
            );

            const pieceTexture = app.renderer.generateTexture({
              target: renderTarget,
              resolution: targetResolution,
              frame: frame,
            });
            const pieceSprite = new PIXI.Sprite(pieceTexture);
            pieceSprite.label = 'pieceSprite';

            const lockIconTexture = app.renderer.generateTexture({
              target: lockIconGraphics,
              resolution: targetResolution,
            });
            lockIconSprite = new PIXI.Sprite(lockIconTexture);

            pieceSprite.x = frame.x;
            pieceSprite.y = frame.y;

            lockIconSprite.anchor.set(0.5);
            lockIconSprite.x = pieceWidth / 2;
            lockIconSprite.y = pieceHeight / 2;
            lockIconSprite.scale.set(1.08);
            lockIconSprite.visible = false;
            lockIconSprite.label = 'lockIcon';

            pieceContainer.addChild(pieceSprite);
            pieceContainer.addChild(lockIconSprite);

            if (ENABLE_BEVEL) {
              (renderTarget as PIXI.Container).destroy({ children: true });
            } else {
              pieceGraphics.destroy();
            }
            lockIconGraphics.destroy();
          }

          pieceContainer.hitArea = new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY);

          (pieceContainer as any).__makeEasterSolidBack = () => {
            const g = new PIXI.Graphics();
            applyPieceShape(g);
            g.fill({ color: EASTER_SOLID_BACK_HEX });
            g.stroke({ color: 0x475569, alpha: 0.92, width: 1.5 * canvasOutlineScale });
            g.label = 'easterSolidBack';
            return g;
          };

          pieceContainer.cullable = true;

          // 퍼즐판 바깥에 겹치지 않게 배치
          let state = pieceStates.get(i);
          let targetX = 0;
          let targetY = 0;
          let isLocked = false;

          if (hasExistingState && state) {
            targetX = state.x;
            targetY = state.y;
            isLocked = state.is_locked;
          } else {
            const pos = initialPositions[i];
            targetX = pos.x;
            targetY = pos.y;
          }

          if (isLocked) {
            pieceContainer.x = targetX;
            pieceContainer.y = targetY;
            pieceContainer.eventMode = 'none';
            pieceContainer.zIndex = 0;
            initialPlacedCount++;
          } else {
            pieceContainer.eventMode = 'static';
            pieceContainer.cursor = 'pointer';
            pieceContainer.zIndex = 1;
            
            if (useFallingPieceIntro) {
              // Set initial falling state
              pieceContainer.alpha = 0;
              pieceContainer.scale.set(3);
              pieceContainer.x = targetX - pieceWidth; // (3-1)/2 = 1, so 1 * pieceWidth
              pieceContainer.y = targetY - 800 - pieceHeight;

              fallingPieces.push({
                id: i,
                container: pieceContainer,
                targetX,
                targetY,
                progress: 0,
                delay: Math.random() * 40,
              });
            } else {
              // WebGL 프로브와 실제 렌더러 불일치·Canvas 폴백 시 즉시 표시
              pieceContainer.alpha = 1;
              pieceContainer.scale.set(1);
              pieceContainer.x = targetX;
              pieceContainer.y = targetY;
            }
          }

          // 드래그 로직
          pieceContainer.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
            if (activeTouches > 1 || isDoubleTapZooming) return; // 핀치 줌/더블탭 줌 중에는 드래그 시작 방지
            
            if (selectedCluster) {
              if (e.pointerType === 'mouse') {
                const snapped = snapCluster(selectedCluster);
                sendUnlockBatch(Array.from(selectedCluster));
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  const lockIcon = p.getChildByLabel('lockIcon');
                  if (lockIcon) lockIcon.visible = false;
                });
                selectedCluster = null;
                e.stopPropagation();
                return;
              }
              
              // 선택된 조각이 있을 때는 무조건 배경(stage)으로 이벤트를 넘겨서
              // 아무 곳이나 드래그/터치 시 선택된 조각이 제어되도록 함
              
              // Bring selected cluster to top immediately on touch down
              topZIndex++;
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                p.zIndex = topZIndex;
              });
              
              return;
            }
            
            e.stopPropagation(); // 조각 클릭 시 배경 패닝 이벤트 방지

            if (isPieceIdHeldRemotely(i)) {
              return;
            }
            const startCluster = getConnectedCluster(i);
            if (isClusterHeldRemotely(startCluster)) {
              return;
            }

            touchStartPos = { x: e.global.x, y: e.global.y };
            isTouchDraggingPiece = false;
            isDragging = true;
            dragStartPieceId = i;

            dragCluster = startCluster;
            const localPos = e.getLocalPosition(world);
            dragOffsets.clear();
            dragCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              dragOffsets.set(id, { x: localPos.x - p.x, y: localPos.y - p.y });
              targetPositions.delete(id);
            });
            currentShiftY = 0;

            sendLockBatch(Array.from(dragCluster));

            // On both touch and mouse, we don't start dragging immediately.
            // We wait for movement to distinguish between tap and drag.
            topZIndex++;
            dragCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              p.zIndex = topZIndex;
            });
          });

          world.addChild(pieceContainer);
          pieces.current.set(i, pieceContainer);
        }

        bumpProgress(99);

        if (fallingPieces.length > 0) {
          const fallTicker = () => {
            let allDone = true;
            for (let i = 0; i < fallingPieces.length; i++) {
              const fp = fallingPieces[i];
              if (fp.progress >= 1) continue;
              
              // If piece is currently being dragged or selected, skip animation and snap to target
              if ((isDragging && dragCluster.has(fp.id)) || (selectedCluster && selectedCluster.has(fp.id))) {
                fp.progress = 1;
                fp.container.scale.set(1);
                fp.container.alpha = 1;
                continue;
              }
              
              if (fp.delay > 0) {
                fp.delay--;
                allDone = false;
                continue;
              }
              
              // If remote movement happened while falling, update the fall target
              if (targetPositions.has(fp.id)) {
                const target = targetPositions.get(fp.id)!;
                fp.targetX = target.x;
                fp.targetY = target.y;
                targetPositions.delete(fp.id);
              }

              allDone = false;
              fp.progress += 0.04; // Animation speed
              if (fp.progress > 1) fp.progress = 1;
              
              // easeOutCubic
              const ease = 1 - Math.pow(1 - fp.progress, 3);
              const currentScale = 3 - 2 * ease;
              
              fp.container.scale.set(currentScale);
              fp.container.x = fp.targetX - (pieceWidth * (currentScale - 1)) / 2;
              fp.container.y = (fp.targetY - 800) + 800 * ease - (pieceHeight * (currentScale - 1)) / 2;
              /** 스케일이 큰 구간에서 알파를 올리면 첫 가시 프레임에 거대 조각으로 보임(presence/락 갱신과 겹치면 더 튐) */
              const alphaStartScale = 1.72;
              fp.container.alpha =
                currentScale > alphaStartScale
                  ? 0
                  : Math.min(1, (alphaStartScale - currentScale) / (alphaStartScale - 1));
            }
            
            if (allDone) {
              app.ticker.remove(fallTicker);
            }
          };
          app.ticker.add(fallTicker);
          // 일부 WebView에서 ticker가 멈추면 alpha=0인 채로 남을 수 있음
          const fallFallbackMs = 4000;
          setTimeout(() => {
            if (!isMounted) return;
            const ticker = app.ticker;
            if (!ticker) return;
            let anyStuck = false;
            for (const fp of fallingPieces) {
              if (fp.progress < 1) {
                anyStuck = true;
                fp.progress = 1;
                fp.container.scale.set(1);
                fp.container.alpha = 1;
                fp.container.x = fp.targetX;
                fp.container.y = fp.targetY;
              }
            }
            if (anyStuck) {
              ticker.remove(fallTicker);
            }
          }, fallFallbackMs);
        }

        const runEasterAnimation = () => {
          if (pieceEasterAnims.size === 0) {
            easterState.animating = false;
            if (easterTicker) app.ticker.remove(easterTicker);
            easterTicker = null;
            return;
          }

          pieceEasterAnims.forEach((anim, id) => {
            const p = pieces.current.get(id);
            if (!p) {
              pieceEasterAnims.delete(id);
              return;
            }
            if (anim.delayFrames > 0) {
              anim.delayFrames--;
              return;
            }
            anim.progress = Math.min(1, anim.progress + anim.speed);
            const t = 1 - Math.pow(1 - anim.progress, 3); // easeOutCubic
            const scaleX = anim.fromScaleX + (anim.toScaleX - anim.fromScaleX) * t;
            const scaleY = anim.fromScaleY + (anim.toScaleY - anim.fromScaleY) * t;
            p.x = anim.fromX + (anim.toX - anim.fromX) * t;
            p.y = anim.fromY + (anim.toY - anim.fromY) * t;
            p.scale.set(scaleX, scaleY);
            p.rotation = anim.fromRotation + (anim.toRotation - anim.fromRotation) * t;
            p.alpha = anim.fromAlpha + (anim.toAlpha - anim.fromAlpha) * t;
            const sprite = getPieceSprite(p);
            if (sprite?.visible) {
              sprite.tint = lerpColor(anim.fromTint, anim.toTint, t);
              sprite.alpha = anim.fromSpriteAlpha + (anim.toSpriteAlpha - anim.fromSpriteAlpha) * t;
            }
            if (anim.progress >= 1) {
              if (anim.hideOnFinish) p.visible = false;
              if (!anim.keepEndTransform) {
                p.scale.set(1, 1);
                p.rotation = 0;
                p.zIndex = 0;
                if (sprite) {
                  sprite.tint = 0xffffff;
                  sprite.alpha = 1;
                }
                clearEasterSolidBack(p);
              } else {
                p.zIndex = 0;
                if (anim.solidGrayBackOnFinish) {
                  setEasterSolidBack(p, true);
                } else {
                  setEasterSolidBack(p, false);
                }
              }
              pieceEasterAnims.delete(id);
            }
          });
        };

        const startSpillEffect = () => {
          if (!isCompletedRef.current || easterState.animating || easterState.spilled) return;
          easterState.animating = true;
          easterState.spilled = true;
          pieceEasterAnims.clear();
          const yMax = boardStartY + boardHeight + pieceHeight * 2.5;
          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (!p) continue;
            setEasterSolidBack(p, false);
            p.visible = true;
            p.eventMode = 'none';
            p.zIndex = 3500 + i;
            p.scale.set(1, 1);
            p.rotation = 0;
            // 화면 위(정수리 방향)로 쏠리지 않게: 주로 좌우 퍼짐 + 약간 아래(손·얼굴 쪽)로
            const spread = pieceWidth * (1.4 + Math.random() * 4.2);
            const toX = p.x + (Math.random() < 0.5 ? -1 : 1) * spread + (Math.random() - 0.5) * pieceWidth * 1.2;
            let toY = p.y + pieceHeight * (0.08 + Math.random() * 0.95);
            toY = Math.min(toY, yMax);
            toY = Math.max(toY, p.y - pieceHeight * 0.2);
            const endScale = 2.2 + Math.random() * 1.8;
            const endRotation = (Math.random() < 0.5 ? -1 : 1) * (Math.PI * (0.5 + Math.random() * 1.2));
            const sprite = getPieceSprite(p);
            pieceEasterAnims.set(i, {
              id: i,
              fromX: p.x,
              fromY: p.y,
              toX,
              toY,
              fromScaleX: p.scale.x,
              fromScaleY: p.scale.y,
              toScaleX: endScale,
              toScaleY: endScale,
              fromRotation: p.rotation,
              toRotation: endRotation,
              fromAlpha: p.alpha,
              toAlpha: 0,
              fromTint: sprite?.tint ?? 0xffffff,
              toTint: 0xffffff,
              fromSpriteAlpha: sprite?.alpha ?? 1,
              toSpriteAlpha: 1,
              progress: 0,
              speed: 0.04 + Math.random() * 0.025,
              delayFrames: Math.floor(Math.random() * 16),
              hideOnFinish: true,
            });
          }
          if (!easterTicker) {
            easterTicker = runEasterAnimation;
            app.ticker.add(easterTicker);
          }
        };

        const startRestoreEffect = () => {
          if (!isCompletedRef.current || easterState.animating || !easterState.spilled) return;
          easterState.animating = true;
          easterState.spilled = false;
          pieceEasterAnims.clear();
          const spreadX = boardWidth * 1.4;
          const yMaxSpawn = boardStartY + boardHeight + pieceHeight * 6;
          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (!p) continue;
            const targetX = boardStartX - boardWidth * 0.2 + Math.random() * spreadX;
            const targetY = boardStartY - pieceHeight * 0.5 + Math.random() * (boardHeight + pieceHeight * 1.4);
            const startScale = 2.1 + Math.random() * 1.2;
            const spinTurns = (Math.random() < 0.5 ? -1 : 1) * (Math.PI * (0.7 + Math.random() * 1.3));
            const startRotation = spinTurns + (Math.random() - 0.5) * 0.4;
            const finalRotation = Math.random() * Math.PI * 2; // 0~360도 랜덤 고정
            const finalFlipped = Math.random() < 0.2;
            const sprite = getPieceSprite(p);
            // 보이는 순간부터 바로 낙하(지연 없음 — 멈춘 것처럼 보이는 현상 방지)
            const delayFrames = 0;
            // 위에서 떨어지지 않게: 목표보다 아래(화면 좌표 +Y)에서 시작해 올라오듯 보임
            let fromY = targetY + pieceHeight * (2 + Math.random() * 5);
            fromY = Math.min(fromY, yMaxSpawn);
            fromY = Math.max(fromY, targetY + pieceHeight * 1.1);
            const fromX = targetX + (Math.random() - 0.5) * pieceWidth * 3.2;

            p.visible = true;
            p.eventMode = 'none';
            // 이미 놓인 조각(zIndex 0)보다 앞에; 인덱스가 클수록 약간 더 위(겹침 시)
            p.zIndex = 5000 + i;

            if (finalFlipped) {
              setEasterSolidBack(p, true);
            } else {
              setEasterSolidBack(p, false);
              if (sprite) {
                sprite.alpha = 1;
                sprite.tint = 0xffffff;
              }
            }
            p.x = fromX;
            p.y = fromY;
            p.scale.set(startScale, startScale);
            p.rotation = startRotation;
            p.alpha = 1;

            pieceEasterAnims.set(i, {
              id: i,
              fromX,
              fromY,
              toX: targetX,
              toY: targetY,
              fromScaleX: startScale,
              fromScaleY: startScale,
              toScaleX: 1,
              toScaleY: 1,
              fromRotation: startRotation,
              toRotation: finalRotation,
              fromAlpha: 1,
              toAlpha: 1,
              fromTint: sprite?.tint ?? 0xffffff,
              toTint: 0xffffff,
              fromSpriteAlpha: sprite?.alpha ?? 1,
              toSpriteAlpha: 1,
              progress: 0,
              speed: 0.018 + Math.random() * 0.02,
              delayFrames,
              keepEndTransform: true,
              solidGrayBackOnFinish: finalFlipped,
            });
          }
          if (!easterTicker) {
            easterTicker = runEasterAnimation;
            app.ticker.add(easterTicker);
          }
        };

        deviceMotionHandler = (event: DeviceMotionEvent) => {
          if (!isCompletedRef.current) return;
          const z = event.accelerationIncludingGravity?.z;
          if (typeof z !== 'number' || Number.isNaN(z)) return;

          const prev = easterState.smoothedZ;
          easterState.smoothedZ = prev == null ? z : prev * 0.8 + z * 0.2;
          const filteredZ = easterState.smoothedZ;
          const now = Date.now();
          if (now - easterState.lastSwitchAt < 1200) return;

          if (!easterState.spilled && filteredZ < -6.5) {
            easterState.lastSwitchAt = now;
            startSpillEffect();
          } else if (easterState.spilled && filteredZ > 6.5) {
            easterState.lastSwitchAt = now;
            startRestoreEffect();
          }
        };
        window.addEventListener('devicemotion', deviceMotionHandler);

        const upgradeOnePieceDeferredBevel = (pieceId: number) => {
          if (!isMounted) return;
          const pieceContainer = pieces.current.get(pieceId);
          if (!pieceContainer || pieceContainer.destroyed) return;
          const oldNode = pieceContainer.getChildByLabel('pieceSprite');
          if (!oldNode || !(oldNode instanceof PIXI.Graphics)) return;

          const col = pieceId % GRID_COLS;
          const row = Math.floor(pieceId / GRID_COLS);
          const topTab = row === 0 ? 0 : -horizontalTabs[row - 1][col];
          const rightTab = col === GRID_COLS - 1 ? 0 : verticalTabs[row][col];
          const bottomTab = row === GRID_ROWS - 1 ? 0 : horizontalTabs[row][col];
          const leftTab = col === 0 ? 0 : -verticalTabs[row][col - 1];

          const applyPieceShapeLocal = (g: PIXI.Graphics) => {
            g.moveTo(0, 0);
            drawEdge(g, 0, 0, pieceWidth, 0, topTab, tabDepth);
            drawEdge(g, pieceWidth, 0, pieceWidth, pieceHeight, rightTab, tabDepth);
            drawEdge(g, pieceWidth, pieceHeight, 0, pieceHeight, bottomTab, tabDepth);
            drawEdge(g, 0, pieceHeight, 0, 0, leftTab, tabDepth);
            g.closePath();
          };

          const pieceGraphics = new PIXI.Graphics();
          applyPieceShapeLocal(pieceGraphics);
          const matrix = new PIXI.Matrix();
          matrix.scale(boardWidth / texture.width, boardHeight / texture.height);
          matrix.translate(-col * pieceWidth, -row * pieceHeight);
          pieceGraphics.fill({ texture: texture, matrix: matrix, textureSpace: 'global' });
          pieceGraphics.stroke({ color: 0x000000, alpha: 0.2, width: 1 });

          const bevelContainer = new PIXI.Container();
          bevelContainer.addChild(pieceGraphics);

          const whiteLine = new PIXI.Graphics();
          applyPieceShapeLocal(whiteLine);
          whiteLine.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
          whiteLine.x = 1;
          whiteLine.y = 1;
          const blurWhite = new PIXI.BlurFilter();
          blurWhite.strength = 1;
          whiteLine.filters = [blurWhite];

          const blackLine = new PIXI.Graphics();
          applyPieceShapeLocal(blackLine);
          blackLine.stroke({ width: 1, color: 0x000000, alpha: 0.6 });
          blackLine.x = -1;
          blackLine.y = -1;
          const blurBlack = new PIXI.BlurFilter();
          blurBlack.strength = 1;
          blackLine.filters = [blurBlack];

          const maskGraphics = new PIXI.Graphics();
          applyPieceShapeLocal(maskGraphics);
          maskGraphics.fill({ color: 0xffffff });

          bevelContainer.addChild(whiteLine);
          bevelContainer.addChild(blackLine);
          bevelContainer.addChild(maskGraphics);
          whiteLine.mask = maskGraphics;
          blackLine.mask = maskGraphics;

          const bounds = pieceGraphics.getLocalBounds();
          const minX = bounds.minX !== undefined ? bounds.minX : bounds.x;
          const minY = bounds.minY !== undefined ? bounds.minY : bounds.y;
          const maxX = bounds.maxX !== undefined ? bounds.maxX : bounds.x + bounds.width;
          const maxY = bounds.maxY !== undefined ? bounds.maxY : bounds.y + bounds.height;

          let maxRes = 2;
          if (PIECE_COUNT > 500) maxRes = 1;
          else if (PIECE_COUNT > 200) maxRes = 1.5;
          let targetResolution = Math.min(window.devicePixelRatio || 1, maxRes);
          if (isCanvasRenderer) targetResolution *= 0.25;

          const padding = 40;
          const frame = new PIXI.Rectangle(
            minX - padding,
            minY - padding,
            maxX - minX + padding * 2,
            maxY - minY + padding * 2,
          );

          let pieceTex: PIXI.Texture;
          try {
            pieceTex = app.renderer.generateTexture({
              target: bevelContainer,
              resolution: targetResolution,
              frame: frame,
            });
          } catch (e) {
            console.warn('[PuzzleBoard] deferred bevel failed', pieceId, e);
            bevelContainer.destroy({ children: true });
            return;
          }

          const pieceSprite = new PIXI.Sprite(pieceTex);
          pieceSprite.label = 'pieceSprite';
          pieceSprite.eventMode = 'none';
          pieceSprite.x = frame.x;
          pieceSprite.y = frame.y;

          bevelContainer.destroy({ children: true });

          pieceContainer.removeChild(oldNode);
          oldNode.destroy();
          pieceContainer.addChildAt(pieceSprite, 0);
        };

        const scheduleDeferredBevelUpgrades = () => {
          if (!deferBevelUpgrade) return;
          let nextId = 0;
          const step = () => {
            deferredBevelRafId = null;
            if (!isMounted) return;
            if (useFallingPieceIntro && fallingPieces.some((fp) => fp.progress < 1)) {
              deferredBevelRafId = requestAnimationFrame(step);
              return;
            }
            let budget = BEVEL_UPGRADE_PIECES_PER_FRAME;
            while (budget > 0 && nextId < PIECE_COUNT) {
              upgradeOnePieceDeferredBevel(nextId);
              nextId++;
              budget--;
            }
            if (nextId < PIECE_COUNT && isMounted) {
              deferredBevelRafId = requestAnimationFrame(step);
            }
          };
          deferredBevelRafId = requestAnimationFrame(step);
        };

        setPlacedPieces(initialPlacedCount);

        if (initialPlacedCount === PIECE_COUNT) {
          isCompletedRef.current = true;
          zoomToCompletedPuzzle(false);
          triggerFireworks();
          playShineEffect();
          if (socketRef.current) {
            socketRef.current.emit(ROOM_EVENTS.PuzzleCompleted, roomId);
          }
          supabase.from('pixi_rooms').update({ status: 'completed' }).eq('id', roomId).then(({error}) => {
            if (error) console.error("Failed to update room status:", error);
          });
        } else {
          // Even if not all are marked as locked in DB, check if their positions are correct
          checkCompletion();
        }

        bumpProgress(100);
        setIsLoading(false);

        if (deferBevelUpgrade) {
          requestAnimationFrame(() => {
            if (isMounted) scheduleDeferredBevelUpgrades();
          });
        }

        /** 퇴장 등으로 unlock 브로드캐스트가 없을 때: 맵만 지우면 alpha=0.5가 남으므로 피스 UI까지 복구 */
        const releaseVisualLocksForDepartedUser = (username: string) => {
          const lockedSet = remoteLockedPieces.get(username);
          if (lockedSet) {
            lockedSet.forEach((id: number) => {
              const pieceContainer = pieces.current.get(id);
              if (pieceContainer) {
                pieceContainer.alpha = 1;
                const col = id % GRID_COLS;
                const row = Math.floor(id / GRID_COLS);
                const targetX = boardStartX + col * pieceWidth;
                const targetY = boardStartY + row * pieceHeight;
                if (Math.abs(pieceContainer.x - targetX) >= 1 || Math.abs(pieceContainer.y - targetY) >= 1) {
                  pieceContainer.eventMode = "static";
                }
              }
            });
          }
          remoteLockedPieces.delete(username);
        };

        // 3. Supabase Realtime 수신
        const channel = supabase.channel(`room_${roomId}`);
        channelRef.current = channel;
        let prevPresenceUsers = new Set<string>();
        let presenceInitialSyncDone = false;

        enqueueRealtimeBroadcast = (event: string, payload: unknown) => {
          const ch = channelRef.current;
          if (!ch) return;
          if (realtimeBroadcastReady) {
            void ch.send({ type: 'broadcast', event, payload });
          } else {
            if (event === 'moveBatch' && realtimeBroadcastQueue.length > 0) {
              const last = realtimeBroadcastQueue[realtimeBroadcastQueue.length - 1];
              if (last.event === 'moveBatch') {
                const a = (last.payload as { updates?: { pieceId: number; x: number; y: number }[] }).updates ?? [];
                const b = (payload as { updates?: { pieceId: number; x: number; y: number }[] }).updates ?? [];
                const byId = new Map<number, { pieceId: number; x: number; y: number }>();
                for (const u of a) byId.set(u.pieceId, u);
                for (const u of b) byId.set(u.pieceId, u);
                last.payload = { updates: Array.from(byId.values()) };
                return;
              }
            }
            realtimeBroadcastQueue.push({ event, payload });
            if (realtimeBroadcastQueue.length > 250) {
              realtimeBroadcastQueue.splice(0, realtimeBroadcastQueue.length - 250);
            }
          }
        };

        const applyPresenceSync = () => {
          const state = channel.presenceState();
          const stillInPresence = (uname: string): boolean => {
            for (const key in state) {
              const arr = state[key];
              for (let i = 0; i < arr.length; i++) {
                const p = arr[i] as { user?: unknown };
                if (p?.user != null && String(p.user) === uname) return true;
              }
            }
            return false;
          };
          for (const u of [...offlineAfterByeRef.current]) {
            if (!stillInPresence(u)) offlineAfterByeRef.current.delete(u);
          }

          const users = new Set<string>();
          const fromPresence = new Map<string, Set<number>>();
          const me = getLocalUsername();

          for (const key in state) {
            state[key].forEach((p: any) => {
              if (!p?.user || isBotLikeUser(p.user)) return;
              const u = String(p.user);
              users.add(u);
              const raw = p.lockedPieceIds;
              const ids = Array.isArray(raw) ? raw : [];
              if (!fromPresence.has(u)) fromPresence.set(u, new Set());
              const bucket = fromPresence.get(u)!;
              ids.forEach((id: unknown) => {
                if (typeof id === "number" && Number.isFinite(id)) bucket.add(id);
              });
            });
          }

          for (const u of offlineAfterByeRef.current) {
            users.delete(u);
          }

          const joinedOthersResolved =
            presenceInitialSyncDone
              ? [...users].filter((u) => u !== me && !prevPresenceUsers.has(u))
              : [];

          setPlayerCount(users.size);
          setActiveUsers(users);

          for (const uid of [...remoteLockedPieces.keys()]) {
            if (uid === "bot") continue;
            if (!users.has(uid)) {
              releaseVisualLocksForDepartedUser(uid);
            }
          }
          /**
           * 선점 상태: lock/unlock은 브로드캐스트가 즉시 반영되고, presence의 lockedPieceIds는
           * track 전파가 늦으면 이전 목록을 실어 올 수 있음. 매 sync마다 presence로 덮어쓰면
           * 상대가 이미 해제한 조각이 다시 잠긴 것처럼 보임.
           * - 나(me): 항상 localPresenceLockIds
           * - 첫 sync·새로 들어온 유저: presence로 시드
           * - 그 외 기존 원격: 이미 맵에 있으면 브로드캐스트만으로 유지( presence로 갱신 안 함 )
           */
          users.forEach((u) => {
            const fromP = new Set(fromPresence.get(u) ?? []);
            if (u === me) {
              remoteLockedPieces.set(u, new Set(localPresenceLockIds));
              return;
            }
            if (!presenceInitialSyncDone) {
              remoteLockedPieces.set(u, new Set(fromP));
              return;
            }
            if (!prevPresenceUsers.has(u)) {
              remoteLockedPieces.set(u, new Set(fromP));
              return;
            }
            if (!remoteLockedPieces.has(u)) {
              remoteLockedPieces.set(u, new Set(fromP));
            }
          });
          refreshRemoteLockVisuals();

          if (joinedOthersResolved.length > 0 && localPresenceLockIds.size > 0) {
            sendLockBatch(Array.from(localPresenceLockIds));
          }

          prevPresenceUsers = new Set(users);
          presenceInitialSyncDone = true;

          cursors.forEach((cursorData, username) => {
            if (!users.has(username) && username !== "bot") {
              cursorData.container.destroy();
              cursors.delete(username);
            }
          });
        };

        channel
          .on('broadcast', { event: 'moveBatch' }, ({ payload }) => {
            payload.updates.forEach((u: any) => {
              const pieceContainer = pieces.current.get(u.pieceId);
              if (pieceContainer) {
                // 자신이 드래그 중인 조각은 원격 업데이트 무시
                if ((isDragging && dragCluster.has(u.pieceId)) || (selectedCluster && selectedCluster.has(u.pieceId))) {
                  return;
                }
                
                targetPositions.set(u.pieceId, { x: u.x, y: u.y });
                
                // 다른 사용자가 조각을 맞췄을 때 맨 뒤로 보내기
                const col = u.pieceId % GRID_COLS;
                const row = Math.floor(u.pieceId / GRID_COLS);
                const targetX = boardStartX + col * pieceWidth;
                const targetY = boardStartY + row * pieceHeight;
                
                if (Math.abs(u.x - targetX) < 1 && Math.abs(u.y - targetY) < 1) {
                  pieceContainer.eventMode = 'none';
                  pieceContainer.zIndex = 0;
                  pieceContainer.alpha = 1; // 잠금 해제 및 원래 투명도 복구
                } else {
                  // 다른 사용자가 드래그 중인 조각도 위로 올리기
                  topZIndex++;
                  pieceContainer.zIndex = topZIndex;
                }
              }
            });
          })
          .on('broadcast', { event: 'lock' }, ({ payload }) => {
            const userId = payload.userId;
            if (userId) {
              const uid = String(userId);
              abortLocalInteractionForRemoteClaim(uid, payload.pieceIds);
              if (!remoteLockedPieces.has(uid)) {
                remoteLockedPieces.set(uid, new Set());
              }
              const userLocked = remoteLockedPieces.get(uid)!;
              payload.pieceIds.forEach((id: number) => userLocked.add(id));
            }
            refreshRemoteLockVisuals();
          })
          .on('broadcast', { event: 'unlock' }, ({ payload }) => {
            const userId = payload.userId;
            if (userId) {
              const uid = String(userId);
              if (remoteLockedPieces.has(uid)) {
                const userLocked = remoteLockedPieces.get(uid)!;
                payload.pieceIds.forEach((id: number) => userLocked.delete(id));
              }
            }
            refreshRemoteLockVisuals();
          })
          .on('broadcast', { event: 'scoreUpdate' }, ({ payload }) => {
            setScores(prev => {
              const existing = prev.find(s => s.username === payload.username);
              if (existing) {
                return prev.map(s => s.username === payload.username ? { ...s, score: payload.score } : s).sort((a, b) => b.score - a.score);
              } else {
                return [...prev, { username: payload.username, score: payload.score }].sort((a, b) => b.score - a.score);
              }
            });
          })
          .on('broadcast', { event: 'cursorMove' }, ({ payload }) => {
            const { username, x, y } = payload;
            const currentUsername = user ? user.username : localStorage.getItem('puzzle_guest_name');
            if (username === currentUsername) return;

            let cursorData = cursors.get(username);
            if (!cursorData) {
              const container = new PIXI.Container();
              
              const graphics = new PIXI.Graphics();
              graphics.circle(0, 0, 4).fill(0xffffff);
              
              const text = new PIXI.Text({
                text: username,
                style: {
                  fontFamily: 'Arial',
                  fontSize: 12,
                  fill: 0xffffff,
                  stroke: { color: 0x000000, width: 3 }
                }
              });
              text.x = 8;
              text.y = -6;
              
              container.addChild(graphics);
              container.addChild(text);
              
              container.x = x;
              container.y = y;
              
              cursorsContainer.addChild(container);
              cursorData = { container, targetX: x, targetY: y };
              cursors.set(username, cursorData);
            } else {
              cursorData.targetX = x;
              cursorData.targetY = y;
            }
          })
          .on("broadcast", { event: "playerLeft" }, ({ payload }) => {
            const un =
              payload && typeof (payload as { username?: unknown }).username !== "undefined"
                ? String((payload as { username: unknown }).username).trim()
                : "";
            if (!un || un === getLocalUsername()) return;
            if (un === "guest") return;
            offlineAfterByeRef.current.add(un);
            applyPresenceSync();
          })
          .on("presence", { event: "sync" }, applyPresenceSync)
          .on("presence", { event: "join" }, applyPresenceSync)
          .on("presence", { event: "leave" }, applyPresenceSync)
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              prevPresenceUsers = new Set();
              presenceInitialSyncDone = false;
              realtimeBroadcastReady = true;
              const ch = channelRef.current;
              if (ch) {
                while (realtimeBroadcastQueue.length > 0) {
                  const item = realtimeBroadcastQueue.shift()!;
                  void ch.send({ type: 'broadcast', event: item.event, payload: item.payload });
                }
              }
              const currentUsername = user ? user.username : localStorage.getItem('puzzle_guest_name');
              const me = currentUsername != null && currentUsername !== '' ? String(currentUsername) : 'guest';
              localPresenceLockIds.clear();
              if (selectedCluster) {
                selectedCluster.forEach((id) => localPresenceLockIds.add(id));
              }
              if (isDragging && dragCluster.size > 0) {
                dragCluster.forEach((id) => localPresenceLockIds.add(id));
              }
              await channel.track({
                user: me,
                lockedPieceIds: Array.from(localPresenceLockIds),
              });
            } else if (
              status === 'CLOSED' ||
              status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT'
            ) {
              realtimeBroadcastReady = false;
            }
          });

        if (realtimeHealthTimer != null) {
          clearInterval(realtimeHealthTimer);
          realtimeHealthTimer = null;
        }
        realtimeHealthTimer = window.setInterval(() => {
          if (!isMounted) return;
          const ch = channelRef.current;
          if (!ch) return;
          try {
            if (!supabase.realtime.isConnected()) {
              void supabase.realtime.connect();
              return;
            }
            if (ch.state === REALTIME_CHANNEL_STATES.joined) {
              if (!realtimeBroadcastReady) {
                realtimeBroadcastReady = true;
                while (realtimeBroadcastQueue.length > 0) {
                  const item = realtimeBroadcastQueue.shift()!;
                  void ch.send({ type: "broadcast", event: item.event, payload: item.payload });
                }
                const meHeal = getLocalUsername();
                void ch.track({
                  user: meHeal,
                  lockedPieceIds: Array.from(localPresenceLockIds),
                });
              }
            }
          } catch {
            /* noop */
          }
        }, 4000);

      } catch (error) {
        console.error('Pixi initialization error:', error);
        setIsLoading(false);
      }
    };

    initPixi();

    // Track total play time
    let playTimeInterval: any;
    if (user && user.id) {
      playTimeInterval = setInterval(async () => {
        try {
          // Fetch current total to avoid overwriting from other tabs
          const { data } = await supabase.from('pixi_users').select('total_play_time').eq('id', user.id).single();
          if (data) {
            await supabase.from('pixi_users').update({
              total_play_time: (data.total_play_time || 0) + 60,
              last_active_at: new Date().toISOString()
            }).eq('id', user.id);
          }
        } catch (err) {
          console.error("Error updating play time:", err);
        }
      }, 60000); // Every 60 seconds
    }

    return () => {
      isMounted = false;
      if (realtimeHealthTimer != null) {
        clearInterval(realtimeHealthTimer);
        realtimeHealthTimer = null;
      }
      if (deferredBevelRafId != null) {
        cancelAnimationFrame(deferredBevelRafId);
        deferredBevelRafId = null;
      }
      if (deviceMotionHandler) {
        window.removeEventListener('devicemotion', deviceMotionHandler);
      }
      if (playTimeInterval) clearInterval(playTimeInterval);
      isBotRunningRef.current = false;
      isColorBotRunningRef.current = false;
      const tex = mainTextureRef.current;
      const appInst = appInstance;
      const objUrl = objectUrlRef.current;
      mainTextureRef.current = null;
      appInstance = null;
      objectUrlRef.current = null;
      if (channelRef.current) {
        releaseOwnedPieceLocks?.();
        const ch = channelRef.current;
        const bye = readLocalPuzzleUsername();
        if (bye !== "guest") {
          void ch.send({ type: "broadcast", event: "playerLeft", payload: { username: bye } });
        }
        ch.untrack?.();
        ch.unsubscribe();
        channelRef.current = null;
      }
      realtimeBroadcastReady = false;
      realtimeBroadcastQueue.length = 0;
      enqueueRealtimeBroadcast = () => {};
      const runHeavyTeardown = () => {
        try {
          try {
            if (easterTicker && appInst) {
              appInst.ticker.remove(easterTicker);
              easterTicker = null;
            }
          } catch {
            /* noop */
          }
          try {
            sharedLockTexture?.destroy(true);
            sharedLockTexture = null;
          } catch {
            /* noop */
          }
          try {
            tex?.destroy(true);
          } catch {
            /* noop */
          }
          try {
            appInst?.destroy(true);
          } catch {
            /* noop */
          }
        } finally {
          if (objUrl) {
            try {
              URL.revokeObjectURL(objUrl);
            } catch {
              /* noop */
            }
          }
          pieces.current.clear();
          worldRef.current = null;
          gatherBordersRef.current = null;
          gatherByColorRef.current = null;
          createMosaicFromImageRef.current = null;
          initialPositionsRef.current = [];
          isCompletedRef.current = false;
          activeUsersRef.current.clear();
          miniPadDragRef.current = null;
          zoomPadDragRef.current = null;
        }
      };
      // 로비 등 다음 화면이 먼저 그려진 뒤 WebGL/텍스처 정리(메인 스레드 블로킹 완화)
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => requestAnimationFrame(runHeavyTeardown));
      } else {
        setTimeout(runHeavyTeardown, 0);
      }
    };
  }, [imageUrl, isTossMode, isTossWideMode]);

  const handleMiniPadPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    miniPadDragRef.current = { x: e.clientX, y: e.clientY, isDragging: true, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleZoomPadPointerDown = (e: React.PointerEvent) => {
    // 토스 와이드(-90deg 회전)에서는 clientY를 기준축으로 사용
    zoomPadDragRef.current = { x: isTossMode && isTossWideMode ? e.clientY : e.clientX, isDragging: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleZoomPadPointerMove = (e: React.PointerEvent) => {
    if (!zoomPadDragRef.current?.isDragging || !worldRef.current) return;
    
    const isTossWide = isTossMode && isTossWideMode;
    const dx = isTossWide
      ? -(e.clientY - zoomPadDragRef.current.x)
      : e.clientX - zoomPadDragRef.current.x;
    if (Math.abs(dx) > 0) {
      // Sensitivity: 1 pixel = 1% zoom change
      // Reversed: dx > 0 (right) is zoom out (-), dx < 0 (left) is zoom in (+)
      const zoomFactor = 1 - (dx * 0.01);
      
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const world = worldRef.current;
      const worldX = (centerX - world.x) / world.scale.x;
      const worldY = (centerY - world.y) / world.scale.y;
      
      const newScale = Math.max(0.05, Math.min(world.scale.x * zoomFactor, 1));
      world.scale.set(newScale);
      
      world.x = centerX - worldX * world.scale.x;
      world.y = centerY - worldY * world.scale.y;
      
      zoomPadDragRef.current.x = isTossWide ? e.clientY : e.clientX;
    }
  };

  const handleZoomPadPointerUp = (e: React.PointerEvent) => {
    zoomPadDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleMiniPadPointerMove = (e: React.PointerEvent) => {
    if (!miniPadDragRef.current?.isDragging || !worldRef.current) return;

    const dx = e.clientX - miniPadDragRef.current.x;
    const dy = e.clientY - miniPadDragRef.current.y;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      miniPadDragRef.current.moved = true;
    }

    if (miniPadDragRef.current.moved) {
      // 2.5x multiplier for fast panning
      worldRef.current.x += dx * 2.5;
      worldRef.current.y += dy * 2.5;
      miniPadDragRef.current.x = e.clientX;
      miniPadDragRef.current.y = e.clientY;
    }
  };

  const handleMiniPadPointerUp = (e: React.PointerEvent) => {
    if (!miniPadDragRef.current) return;
    miniPadDragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const boardFrameStyle = isTossMode
    ? {
        // 토스 모드 퍼즐 배경: 와이드 모드는 가로 방향(90deg), 일반은 세로 방향(180deg)
        backgroundImage: isTossWideMode
          ? `linear-gradient(90deg, #F4F8FF 0%, #F4F8FF 35%, ${bgColor} 100%)`
          : `linear-gradient(180deg, #F4F8FF 0%, #F4F8FF 35%, ${bgColor} 100%)`,
        backgroundColor: "#F4F8FF",
      }
    : { backgroundColor: bgColor };

  const tossWidePuzzleInsetPx =
    isTossMode && isTossWideMode
      ? Math.max(
          1,
          (tossWideToolbarWidth > 0
            ? tossWideToolbarWidth
            : TOSS_WIDE_TOOLBAR_WIDTH_FALLBACK_PX) - TOSS_WIDE_PUZZLE_INSET_TRIM_PX,
        )
      : undefined;

  /** 토스 와이드: 툴바·캔버스와 동일한 -90°(물리 화면은 세로인 채 가로 레이아웃) */
  const tossWideFullscreenOverlayStyle: CSSProperties | undefined =
    isTossMode && isTossWideMode
      ? {
          position: 'absolute',
          width: '100vh',
          height: '100vw',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%) rotate(-90deg)',
          transformOrigin: 'center center',
        }
      : undefined;

  const puzzleLoadingStages = isKo ? PUZZLE_LOADING_STAGES_KO : PUZZLE_LOADING_STAGES_EN;
  const puzzleLoadingSubtitle =
    puzzleLoadingStages[puzzleLoadingStageIndex(loadProgress, puzzleLoadingStages.length)];
  const loadBarTrack = isTossMode ? "#EAF2FF" : "rgba(148, 163, 184, 0.35)";
  const loadBarFill = isTossMode ? "#3182F6" : "#6366f1";
  const loadPct = Math.min(100, Math.round(loadProgress));

  return (
    <div className="w-full h-full relative" style={boardFrameStyle}>
      {imageLoadError && (
        <div
          className={`z-[100] flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm text-white p-4 text-center ${
            tossWideFullscreenOverlayStyle ? 'absolute' : 'absolute inset-0'
          }`}
          style={tossWideFullscreenOverlayStyle}
        >
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
            <X className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-red-400 mb-2">Image Load Error</h2>
          <p className="text-slate-300 max-w-md mb-6">{imageLoadError}</p>
          <button
            onClick={onBack}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition-colors"
          >
            {isKo ? "로비로 돌아가기" : "Return to Lobby"}
          </button>
        </div>
      )}
      {isLoading && !imageLoadError && (
        <div
          className={`z-[100] flex flex-col items-center justify-center ${
            isTossMode
              ? "bg-[#F4F8FF]/95 backdrop-blur-md text-slate-900"
              : "bg-slate-900/90 backdrop-blur-sm text-white"
          } ${tossWideFullscreenOverlayStyle ? "absolute" : "absolute inset-0"}`}
          style={tossWideFullscreenOverlayStyle}
        >
          {isTossMode ? (
            <div className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-[#D9E8FF] bg-white shadow-[0_8px_24px_rgba(47,111,228,0.1)]">
              <PuzzleLoadingSpinner toss />
            </div>
          ) : (
            <div className="mb-4 flex h-16 w-16 items-center justify-center">
              <PuzzleLoadingSpinner toss={false} />
            </div>
          )}
          <h2
            className={
              isTossMode
                ? "text-lg font-semibold tracking-tight text-slate-900"
                : "text-xl font-bold text-white"
            }
          >
            {isKo ? "퍼즐 불러오는 중" : "Loading puzzle"}
          </h2>
          <p
            className={`mt-1.5 text-center text-sm px-6 max-w-sm min-h-[1.25rem] transition-opacity duration-200 ${
              isTossMode ? "text-slate-500" : "text-slate-400"
            }`}
          >
            {puzzleLoadingSubtitle}
          </p>
          <div className="mt-4 w-[min(280px,85vw)] space-y-1.5">
            <div
              className="h-2 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: loadBarTrack }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={loadPct}
              aria-label={isKo ? "불러오기 진행률" : "Loading progress"}
            >
              <div
                className="h-full rounded-full transition-[width] duration-200 ease-out"
                style={{ width: `${loadPct}%`, backgroundColor: loadBarFill }}
              />
            </div>
            <p
              className={`text-center text-xs font-medium tabular-nums ${
                isTossMode ? "text-slate-500" : "text-slate-400"
              }`}
            >
              {loadPct}%
            </p>
          </div>
        </div>
      )}
      <div
        ref={tossWideToolbarMeasureRef}
        className={`absolute top-0 left-0 w-full z-50 backdrop-blur-sm items-center justify-between gap-1 sm:gap-1.5 text-white ${
          isTossMode && isTossWideMode ? "" : "p-1 sm:p-1.5"
        } ${
          isTossMode && isTossWideMode
            ? "flex flex-row bg-white text-[#2F6FE4] gap-2"
            : isTossMode
            ? "flex flex-col sm:flex-row bg-white text-[#2F6FE4] px-1.5 pt-0 pb-1.5 sm:px-2 sm:pt-0 sm:pb-2"
            : "flex flex-col sm:flex-row bg-slate-900/80 border-b border-slate-700/50"
        }`}
        style={
          isTossMode && isTossWideMode
            ? {
                top: 0,
                left: 0,
                width: "100vh",
                transformOrigin: "top left",
                transform: "rotate(-90deg) translateX(-100%)",
                boxSizing: "border-box",
                // 회전 전 박스 짧은 변: 상·하 여백 동일 (하단과 같은 8px)
                paddingTop: 8,
                paddingBottom: 8,
                paddingLeft: hostWebViewPadding
                  ? Math.max(hostWebViewPadding.left + 4, Math.max(0, hostWebViewPadding.right - 28))
                  : 12,
                paddingRight: hostWebViewPadding
                  ? Math.max(hostWebViewPadding.left + 4, Math.max(0, hostWebViewPadding.right - 28))
                  : 12,
              }
            : (isTossMode ? tossToolbarPadding : hostToolbarPadding)
        }
      >
        {/* Top Row (Mobile) / Left Side (Desktop) */}
        <div className={`flex items-center gap-1 ${isTossMode && isTossWideMode ? "gap-2" : isTossMode ? "w-full justify-between gap-2" : "w-full justify-between sm:w-auto gap-1.5 sm:gap-2"}`}>
          <div className={`flex items-center ${isTossMode ? "gap-2" : "gap-1.5"}`}>
            {!isTossMode ? (
              <button 
                onClick={onBack}
                className="flex items-center justify-center bg-slate-800 hover:bg-slate-700 w-7 h-7 rounded-md transition-colors border border-slate-600 shrink-0"
                title="Back to Lobby"
              >
                <ChevronLeft size={14} />
              </button>
            ) : null}
            <div
              className={`flex items-center gap-1 px-1.5 h-7 rounded-md border shrink-0 ${
                isTossMode ? "bg-[#F4F8FF] border-0 h-8 px-2.5 gap-2 rounded-lg" : "bg-slate-800/50 border-slate-700/50"
              }`}
            >
              <span className={`text-xs font-medium ${isTossMode ? "text-blue-700" : "text-slate-300"}`}>#{encodeRoomId(roomId)}</span>
              {isTossMode ? (
                <button
                  aria-label={isCopied ? "링크 복사됨" : "링크 공유"}
                  onClick={handleShareLink}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-[#EAF2FF] text-[#2F6FE4]"
                >
                  {isCopied ? <Check size={12} className="text-[#2F6FE4]" /> : <Share2 size={12} className="text-[#2F6FE4]" />}
                </button>
              ) : (
                <button
                  onClick={handleShareLink}
                  className="flex items-center justify-center text-slate-400 hover:text-white transition-colors"
                  title="Share Link"
                >
                  {isCopied ? <Check size={14} className="text-emerald-400" /> : <Share2 size={14} />}
                </button>
              )}
            </div>
          </div>
          
          {isTossMode ? (
            <div className={`flex items-center justify-center gap-2 h-8 rounded-lg bg-[#F4F8FF] px-3 ${isTossWideMode ? "w-24 shrink-0" : "flex-1 min-w-0"}`}>
              <span className="w-full max-w-[90px] h-1.5 rounded-full overflow-hidden bg-[#D9E8FF]">
                <span
                  style={{
                    display: "block",
                    width: `${(placedPieces / totalPieces) * 100}%`,
                    height: "100%",
                    background: "#2F6FE4",
                    borderRadius: 999,
                    transition: "width 300ms",
                  }}
                />
              </span>
              <span className="text-xs font-semibold whitespace-nowrap text-[#2F6FE4]">
                {placedPieces} / {totalPieces}
              </span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1.5 px-2 h-7 rounded-md border flex-1 sm:flex-none justify-center ${
                isTossMode ? "bg-blue-50 border-blue-200" : "bg-slate-800/50 border-slate-700/50"
              }`}
            >
              <div
                className={`w-full max-w-[60px] sm:max-w-none sm:w-24 rounded-full h-1.5 overflow-hidden ${
                  isTossMode ? "bg-blue-200" : "bg-slate-700"
                }`}
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isTossMode ? "bg-blue-500" : "bg-indigo-500"
                  }`}
                  style={{ width: `${(placedPieces / totalPieces) * 100}%` }}
                />
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${isTossMode ? "text-blue-700" : "text-indigo-400"}`}>
                {placedPieces} / {totalPieces}
              </span>
            </div>
          )}

          {/* Leaderboard (비-Toss WebView); Toss 는 네비 액세서리로만 토글 */}
          {!hostLeaderboardToggleRef ? (
            <button
              onClick={() => setShowLeaderboard(!showLeaderboard)}
              className={`${isTossMode && isTossWideMode ? "hidden" : "flex sm:hidden"} items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0 ${
                showLeaderboard
                  ? (isTossMode ? "bg-[#EAF2FF] text-[#2F6FE4]" : "bg-amber-500/20 border border-amber-500/50 text-amber-400")
                  : (isTossMode ? "bg-[#F4F8FF] text-[#2F6FE4]" : "bg-slate-800 hover:bg-slate-700 border border-slate-600")
              }`}
              title={isKo ? "순위" : "Rank"}
            >
              <Trophy size={16} className={showLeaderboard ? (isTossMode ? 'text-[#2F6FE4]' : 'text-amber-400') : (isTossMode ? 'text-[#2F6FE4]' : 'text-slate-400')} />
            </button>
          ) : null}
        </div>

        {/* Bottom Row (Mobile) / Right Side (Desktop) */}
        <div className={`flex items-center gap-1 ${isTossMode && isTossWideMode ? "gap-2" : isTossMode ? "w-full justify-between gap-2" : "w-full sm:w-auto gap-1.5 sm:gap-2 justify-center sm:justify-end"}`}>
          {isTossMode ? (
            <div className="flex items-center justify-center gap-2 flex-1 min-w-0 h-8 rounded-lg bg-[#F4F8FF] px-3 text-[#2F6FE4]">
              <Users size={12} className="text-[#2F6FE4]" />
              <span className="text-xs font-semibold whitespace-nowrap">{playerCount}/{maxPlayers}</span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 px-2 h-7 rounded-md border flex-1 sm:flex-none justify-center ${
                isTossMode ? "bg-blue-50 border-blue-200" : "bg-slate-800/50 border-slate-700/50"
              }`}
              title={isKo ? "인원" : "Players"}
            >
              <Users size={12} className={isTossMode ? "text-blue-700" : "text-slate-400"} />
              <span className={`text-xs font-medium whitespace-nowrap ${isTossMode ? "text-blue-700" : ""}`}>
                {playerCount}/{maxPlayers}
              </span>
            </div>
          )}

          {isTossMode ? (
            <div className="flex items-center justify-center gap-2 flex-1 min-w-0 h-8 rounded-lg bg-[#F4F8FF] px-3 text-[#2F6FE4]">
              <Clock size={12} className="text-[#2F6FE4]" />
              <span className="text-xs font-semibold whitespace-nowrap font-mono">
                {formatTime(playTime)}
              </span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1 px-2 h-7 rounded-md border flex-1 sm:flex-none justify-center ${
                isTossMode ? "bg-blue-50 border-blue-200" : "bg-slate-800/50 border-slate-700/50"
              }`}
              title={isKo ? "플레이 시간" : "Play Time"}
            >
              <Clock size={12} className={isTossMode ? "text-blue-700" : "text-slate-400"} />
              <span className={`text-xs font-medium font-mono whitespace-nowrap ${isTossMode ? "text-blue-700" : ""}`}>
                {formatTime(playTime)}
              </span>
            </div>
          )}

          {!isTossMode ? (
            <div className="relative">
              <button
                onClick={() => setShowBotMenu(!showBotMenu)}
                className={`flex items-center justify-center w-7 h-7 rounded-md border transition-colors shrink-0 ${showBotMenu ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'bg-slate-800/50 border-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white'}`}
                title="Bot Actions"
              >
                <Bot size={14} className={isColorBotLoading ? 'animate-pulse text-indigo-400' : ''} />
              </button>
              
              {showBotMenu && (
                <div className="absolute top-full mt-2 right-0 bg-slate-800 border border-slate-700 rounded-xl p-3 z-50 animate-in fade-in slide-in-from-top-2 w-48">
                <div className="flex items-center justify-between mb-3 border-b border-slate-700 pb-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Bot Actions</span>
                  <button onClick={() => setShowBotMenu(false)} className="text-slate-500 hover:text-white">
                    <X size={14} />
                  </button>
                </div>
                
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      gatherBordersRef.current?.();
                      setShowBotMenu(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-sm text-left"
                  >
                    <LayoutGrid size={14} />
                    <span>Gather Borders</span>
                  </button>
                  
                  <button
                    onClick={() => {
                      gatherByColorRef.current?.(false);
                      setShowBotMenu(false);
                    }}
                    disabled={isColorBotLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-sm text-left disabled:opacity-50"
                  >
                    <Palette size={14} />
                    <span>Group by Color</span>
                  </button>

                  <button
                    onClick={() => {
                      gatherByColorRef.current?.(true);
                      setShowBotMenu(false);
                    }}
                    disabled={isColorBotLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-sm text-left disabled:opacity-50"
                  >
                    <Zap size={14} className="text-amber-400" />
                    <span>Quick Group</span>
                  </button>

                  <button
                    onClick={() => {
                      setMosaicQuick(false);
                      setShowMosaicModal(true);
                      setShowBotMenu(false);
                    }}
                    disabled={isColorBotLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-sm text-left disabled:opacity-50"
                  >
                    <ImageIcon size={14} className="text-indigo-400" />
                    <span>Image Mosaic</span>
                  </button>

                  <button
                    onClick={() => {
                      setMosaicQuick(true);
                      setShowMosaicModal(true);
                      setShowBotMenu(false);
                    }}
                    disabled={isColorBotLoading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/50 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors text-sm text-left disabled:opacity-50"
                  >
                    <Zap size={14} className="text-amber-400" />
                    <span>Quick Mosaic</span>
                  </button>
                </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="relative">
            {isTossMode ? (
              <button
                aria-label="배경색 변경"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="inline-flex items-center justify-center gap-1.5 h-8 min-w-[52px] px-3 rounded-lg bg-[#F4F8FF] text-[#2F6FE4]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Palette size={12} className="text-[#2F6FE4]" />
                  <span className="w-2.5 h-2.5 rounded-full border border-blue-100" style={{ backgroundColor: bgColor }} />
                </span>
              </button>
            ) : (
              <button 
                onClick={() => setShowColorPicker(!showColorPicker)}
                className={`flex items-center gap-1 px-1.5 h-7 rounded-md border transition-colors shrink-0 ${
                  showColorPicker
                    ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-400"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:bg-slate-700"
                }`}
                title={isKo ? "배경색 변경" : "Change Background Color"}
              >
                <Palette size={14} />
                <div className="w-3 h-3 rounded-full border border-slate-600" style={{ backgroundColor: bgColor }} />
              </button>
            )}
            
            {showColorPicker && (
              <div className={`absolute top-full mt-2 right-0 rounded-xl p-3 z-50 animate-in fade-in slide-in-from-top-2 w-[140px] ${
                isTossMode ? "bg-white text-[#2F6FE4] shadow-[0_8px_20px_rgba(47,111,228,0.12)]" : "bg-slate-800 border border-slate-700"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-medium ${isTossMode ? "text-[#2F6FE4]" : "text-slate-300"}`}>{isKo ? "배경" : "Background"}</span>
                  <button onClick={() => setShowColorPicker(false)} className={isTossMode ? "text-[#2F6FE4]" : "text-slate-500 hover:text-white"}>
                    <X size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {PRESET_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => {
                        setBgColor(color);
                        setShowColorPicker(false);
                      }}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${bgColor === color ? (isTossMode ? 'border-blue-400 scale-110' : 'border-indigo-400 scale-110') : 'border-slate-600'}`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                <div className={`mt-3 pt-3 flex items-center justify-between ${isTossMode ? "" : "border-t border-slate-700"}`}>
                  <span className={`text-xs ${isTossMode ? "text-[#2F6FE4]" : "text-slate-400"}`}>{isKo ? "직접 선택" : "Custom"}</span>
                  <div className={`relative w-6 h-6 rounded overflow-hidden ${isTossMode ? "bg-[#F4F8FF]" : "border border-slate-600"}`}>
                    <input 
                      type="color" 
                      value={bgColor} 
                      onChange={(e) => setBgColor(e.target.value)}
                      className="absolute -top-2 -left-2 w-10 h-10 cursor-pointer"
                      title={isKo ? "사용자 색상" : "Custom Color"}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {isTossMode ? (
            <>
              <button
                aria-label={showMiniPad ? "미니 패드 숨기기" : "미니 패드 보이기"}
                onClick={() => setShowMiniPad((v) => !v)}
                className={`inline-flex items-center justify-center h-8 w-10 rounded-lg ${
                  showMiniPad ? "bg-[#EAF2FF] text-[#2F6FE4]" : "bg-[#F4F8FF] text-[#7AA6F2]"
                }`}
                title={isKo ? (showMiniPad ? "미니 패드 숨기기" : "미니 패드 보이기") : (showMiniPad ? "Hide mini pad" : "Show mini pad")}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                aria-label={isKo ? "퍼즐 이미지 보기" : "View puzzle image"}
                onClick={() => setShowFullImage(true)}
                className="inline-flex items-center justify-center h-8 w-10 rounded-lg bg-[#F4F8FF] text-[#2F6FE4]"
                title={isKo ? "퍼즐 이미지 보기" : "View puzzle image"}
              >
                <ImageIcon size={14} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowMiniPad((v) => !v)}
                className={`flex items-center justify-center w-7 h-7 rounded-md border transition-colors shrink-0 ${
                  showMiniPad
                    ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-400"
                    : "bg-slate-800/50 border-slate-700/50 text-slate-400 hover:bg-slate-700"
                }`}
                title={isKo ? (showMiniPad ? "미니 패드 숨기기" : "미니 패드 보이기") : (showMiniPad ? "Hide mini pad" : "Show mini pad")}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setShowFullImage(true)}
                className="flex items-center justify-center w-7 h-7 rounded-md border transition-colors shrink-0 bg-slate-800/50 border-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-white"
                title={isKo ? "퍼즐 이미지 보기" : "View puzzle image"}
              >
                <ImageIcon size={14} />
              </button>
            </>
          )}

          {(isTossMode && isTossWideMode) || !hostLeaderboardToggleRef ? (
            <button
              onClick={() => setShowLeaderboard(!showLeaderboard)}
              className={`${isTossMode && isTossWideMode ? "flex" : "hidden sm:flex"} items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0 ${
                showLeaderboard
                  ? (isTossMode ? "bg-[#EAF2FF] text-[#2F6FE4]" : "bg-amber-500/20 border border-amber-500/50 text-amber-400")
                  : (isTossMode ? "bg-[#F4F8FF] text-[#2F6FE4]" : "bg-slate-800 hover:bg-slate-700 border border-slate-600")
              }`}
              title={isKo ? "순위표" : "Leaderboard"}
            >
              <Trophy size={14} className={showLeaderboard ? (isTossMode ? 'text-[#2F6FE4]' : 'text-amber-400') : (isTossMode ? 'text-[#2F6FE4]' : 'text-slate-400')} />
            </button>
          ) : null}

          <button 
            type="button"
            onClick={() => {
              if (isTossMode) {
                setShowRotateConfirm(true);
                return;
              }
              void handleOrientationButton();
            }}
            className={`flex lg:hidden items-center justify-center w-7 h-7 rounded-md transition-colors border shrink-0 ${
              isTossMode
                ? "bg-[#F4F8FF] text-[#2F6FE4] border-none"
                : "bg-slate-800/50 hover:bg-slate-700 border-slate-700/50 text-slate-400 hover:text-white"
            }`}
            title={isTossMode ? (isTossWideMode ? "일반 모드" : "와이드 모드") : (isKo ? "화면 회전" : "Rotate Screen")}
          >
            <RotateCcw size={14} />
          </button>

          {!isTossMode ? (
            <button 
              onClick={toggleFullscreen}
              className="flex items-center justify-center w-7 h-7 bg-slate-800/50 hover:bg-slate-700 rounded-md transition-colors border border-slate-700/50 text-slate-400 hover:text-white shrink-0"
              title={isFullscreen ? (isKo ? "전체화면 종료" : "Exit Fullscreen") : (isKo ? "전체화면" : "Enter Fullscreen")}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          ) : null}
        </div>
      </div>

      {showLeaderboard && (
        <div
          className={`z-50 w-56 rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200 ${
            isTossMode
              ? "bg-white border border-[#D9E8FF] shadow-[0_10px_24px_rgba(47,111,228,0.14)]"
              : "bg-slate-800 border border-slate-700"
          } ${
            isTossMode && isTossWideMode
              ? "fixed top-16 right-0"
              : isTossMode
              ? "absolute top-0 right-0"
              : "absolute"
          } ${leaderboardOffset || isTossMode ? "" : "top-14 right-1 sm:top-16 sm:right-2"}`}
          style={
            isTossMode && isTossWideMode
              ? { transform: "translateX(100%) rotate(-90deg)", transformOrigin: "bottom left" }
              : leaderboardOffset
          }
        >
          <div className={`p-2.5 border-b flex items-center justify-between ${
            isTossMode ? "bg-[#F4F8FF] border-[#D9E8FF]" : "bg-slate-900/50 border-slate-700"
          }`}>
            <div className="flex items-center gap-2">
              <Trophy size={16} className={isTossMode ? "text-[#2F6FE4]" : "text-amber-400"} />
              <h3 className={`font-bold text-sm ${isTossMode ? "text-[#2F6FE4]" : "text-white"}`}>{isKo ? "순위표" : "Leaderboard"}</h3>
            </div>
            <button onClick={() => setShowLeaderboard(false)} className={`transition-colors ${isTossMode ? "text-[#2F6FE4] hover:text-[#1f5ec6]" : "text-slate-400 hover:text-white"}`}>
              <X size={16} />
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5">
            {scores.length === 0 ? (
              <div className={`text-center py-4 text-xs ${isTossMode ? "text-[#6B7684]" : "text-slate-400"}`}>{isKo ? "아직 점수가 없습니다." : "No scores yet"}</div>
            ) : (
              <div className="space-y-1">
                {scores.map((score, idx) => {
                  const currentUsername = user ? user.username : localStorage.getItem('puzzle_guest_name');
                  const isMe = score.username === currentUsername;
                  return (
                  <div key={idx} className={`flex items-center justify-between p-1.5 rounded-lg transition-colors ${
                    isMe
                      ? (isTossMode ? 'bg-[#EAF2FF] border border-[#CFE2FF]' : 'bg-indigo-500/20 border border-indigo-500/35')
                      : (isTossMode ? 'hover:bg-[#F4F8FF]' : 'hover:bg-slate-700/50')
                  }`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold w-4 text-center ${
                        idx === 0
                          ? (isTossMode ? 'text-[#2F6FE4]' : 'text-amber-400')
                          : idx === 1
                          ? (isTossMode ? 'text-[#4E5968]' : 'text-slate-300')
                          :                           idx === 2
                          ? (isTossMode ? 'text-[#6B7684]' : 'text-amber-700')
                          : (isTossMode ? 'text-[#8B95A1]' : 'text-slate-500')
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${activeUsers.has(score.username) ? 'bg-emerald-500' : (isTossMode ? 'bg-[#B0B8C1]' : 'bg-slate-600')}`} title={activeUsers.has(score.username) ? 'Online' : 'Offline'} />
                        <span className={`text-xs truncate max-w-[100px] ${
                          isMe
                            ? (isTossMode ? 'text-[#2F6FE4] font-bold' : 'text-indigo-300 font-bold')
                            : activeUsers.has(score.username)
                            ? (isTossMode ? 'text-[#333D4B]' : 'text-slate-200')
                            : (isTossMode ? 'text-[#8B95A1]' : 'text-slate-400')
                        }`} title={score.username}>
                          {score.username}
                        </span>
                        {isMe && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 ${
                          isTossMode ? "text-[#2F6FE4] bg-[#EAF2FF]" : "text-indigo-300 bg-indigo-500/25"
                        }`}>YOU</span>}
                      </div>
                    </div>
                    <span className={`text-xs font-bold ${isTossMode ? "text-[#2F6FE4]" : "text-indigo-400"}`}>{score.score}</span>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        ref={pixiContainer}
        className="h-full overflow-hidden"
        style={
          tossWidePuzzleInsetPx != null
            ? {
                marginLeft: tossWidePuzzleInsetPx,
                width: `calc(100% - ${tossWidePuzzleInsetPx}px)`,
                opacity: isLoading ? 0 : 1,
                visibility: isLoading ? 'hidden' : 'visible',
              }
            : {
                width: "100%",
                opacity: isLoading ? 0 : 1,
                visibility: isLoading ? 'hidden' : 'visible',
              }
        }
      />

      {showMosaicModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md overflow-hidden">
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-800/50">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-indigo-400" />
                <h3 className="font-bold text-white">Create Image Mosaic</h3>
              </div>
              <button onClick={() => setShowMosaicModal(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Image URL</label>
                <input
                  type="text"
                  value={mosaicUrl}
                  onChange={(e) => {
                    setMosaicUrl(e.target.value);
                    setMosaicError(null);
                  }}
                  placeholder="https://example.com/image.jpg"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Enter a direct link to an image. CORS must be enabled on the image host.
                </p>
                {mosaicError && (
                  <p className="text-xs text-red-400 mt-2">
                    {mosaicError}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Piece Gap Multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="5.0"
                  value={mosaicGap}
                  onChange={(e) => setMosaicGap(parseFloat(e.target.value) || 1.6)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-2">
                  1.0 means no gap. 1.6 is the default initial spacing.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowMosaicModal(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (mosaicUrl) {
                      setMosaicError(null);
                      try {
                        await createMosaicFromImageRef.current?.(mosaicUrl, mosaicQuick, mosaicGap);
                        setShowMosaicModal(false);
                      } catch (err) {
                        // Error is handled inside createMosaicFromImage, which sets mosaicError
                        // We just want to prevent closing the modal if it fails
                      }
                    }
                  }}
                  disabled={isColorBotLoading}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isColorBotLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : mosaicQuick ? (
                    <Zap size={14} />
                  ) : (
                    <ImageIcon size={14} />
                  )}
                  {isColorBotLoading ? 'Creating...' : 'Create Mosaic'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mini Image Pad & Zoom Pad Container */}
      {showMiniPad && (
        <div
          className={
            isTossMode && isTossWideMode
              ? "fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col gap-2 items-end"
              : "fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-40 flex flex-col gap-2"
          }
          style={
            isTossMode && isTossWideMode
              ? { transform: "translateX(100%) rotate(-90deg)", transformOrigin: "bottom left" }
              : undefined
          }
        >
        {/* Zoom Pad */}
        <div 
          className={`w-36 sm:w-48 h-9 rounded-full border-2 backdrop-blur-md flex items-center justify-center cursor-ew-resize touch-none ${
            isTossMode
              ? "border-[#D9E8FF] bg-[#F4F8FF]/95 text-[#2F6FE4] shadow-[0_8px_20px_rgba(47,111,228,0.12)]"
              : "border-indigo-500/35 bg-slate-800/80 text-indigo-400"
          }`}
          onPointerDown={handleZoomPadPointerDown}
          onPointerMove={handleZoomPadPointerMove}
          onPointerUp={handleZoomPadPointerUp}
          onPointerCancel={handleZoomPadPointerUp}
          title="Drag left/right to zoom"
        >
          <div className={`flex items-center justify-between w-full px-3 pointer-events-none ${isTossMode ? "text-[#2F6FE4]" : "text-slate-400"}`}>
            <Plus size={16} />
            <div className={`w-6 sm:w-10 h-1 rounded-full ${isTossMode ? "bg-[#B7CDF9]" : "bg-slate-600"}`}></div>
            <Minus size={16} />
          </div>
        </div>

        {/* Mini Image Pad: 퍼즐 비율과 무관하게 1:1 정사각형으로 통일 */}
        <div
          className={`w-36 sm:w-48 aspect-square rounded-xl border-2 overflow-hidden cursor-pointer touch-none backdrop-blur-md p-1.5 flex items-center justify-center ${
            isTossMode
              ? "border-[#D9E8FF] bg-[#F4F8FF]/95 shadow-[0_8px_20px_rgba(47,111,228,0.12)]"
              : "border-indigo-500/35 bg-slate-800/80"
          }`}
          onPointerDown={handleMiniPadPointerDown}
          onPointerMove={handleMiniPadPointerMove}
          onPointerUp={handleMiniPadPointerUp}
          onPointerCancel={handleMiniPadPointerUp}
          title={isKo ? "드래그하여 화면 이동" : "Drag to pan"}
        >
          <div className="w-full h-full flex items-center justify-center overflow-hidden rounded-lg">
            <img
              src={objectUrlRef.current || imageUrl}
              alt="Puzzle Thumbnail"
              draggable={false}
              className="block max-w-full max-h-full opacity-90 hover:opacity-100 transition-opacity pointer-events-none object-contain object-center select-none"
              style={{ WebkitUserDrag: "none", userSelect: "none" }}
            />
          </div>
        </div>
        </div>
      )}

      {/* Full Image Modal */}
      {showFullImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 animate-in fade-in duration-200" 
          onClick={() => setShowFullImage(false)}
        >
          {isTossMode && isTossWideMode && (
            <button
              className="fixed top-4 right-4 bg-slate-800 text-white rounded-full p-2 hover:bg-slate-700 border border-slate-600 transition-colors z-[110]"
              onClick={(e) => { e.stopPropagation(); setShowFullImage(false); }}
            >
              <X size={20} className="sm:w-6 sm:h-6" />
            </button>
          )}
          <div
            className="relative flex items-center justify-center"
            style={
              isTossMode && isTossWideMode
                ? {
                    width: "100vh",
                    height: "100vw",
                    transform: "rotate(-90deg)",
                    transformOrigin: "center center",
                  }
                : {
                    maxWidth: "95vw",
                    maxHeight: "95vh",
                  }
            }
          >
            <button
              className="absolute -top-4 -right-4 sm:-top-6 sm:-right-6 bg-slate-800 text-white rounded-full p-2 hover:bg-slate-700 border border-slate-600 transition-colors z-10"
              style={isTossMode && isTossWideMode ? { display: "none" } : undefined}
              onClick={(e) => { e.stopPropagation(); setShowFullImage(false); }}
            >
              <X size={20} className="sm:w-6 sm:h-6" />
            </button>
            <img 
              src={objectUrlRef.current || imageUrl} 
              alt="Full Puzzle" 
              className={`object-contain rounded-lg ${
                isTossMode && isTossWideMode ? "max-w-[92%] max-h-[88%]" : "max-w-full max-h-[90vh]"
              }`}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {showRotateConfirm && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setShowRotateConfirm(false)}
        >
          <div
            className={`w-full max-w-[340px] rounded-[20px] p-0 shadow-[0_12px_40px_rgba(0,0,0,0.16)] ${
              isTossMode ? "bg-white text-slate-900" : "bg-slate-900 border border-slate-700 text-white"
            }`}
            style={
              isTossMode && isTossWideMode
                ? { width: "min(82vh, 340px)", transform: "rotate(-90deg)" }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-[22px]">
            <p className={`text-[18px] font-bold leading-[1.35] tracking-[-0.02em] ${isTossMode ? "text-[#191f28]" : "text-white"}`}>
              {isKo ? "화면 회전을 위해 다시 로딩할게요." : "We'll reload to rotate the screen."}
            </p>
            <div className="mt-5 mb-[18px] flex gap-2">
              <button
                onClick={() => setShowRotateConfirm(false)}
                className={`flex-1 min-h-12 px-3 py-[14px] rounded-[14px] text-[15px] font-semibold ${
                  isTossMode
                    ? "bg-[#f2f4f6] text-[#333d4b] hover:bg-[#e9ecef]"
                    : "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                }`}
              >
                {isKo ? "아니요" : "No"}
              </button>
              <button
                onClick={() => {
                  setShowRotateConfirm(false);
                  setIsTossWideMode((prev) => !prev);
                }}
                className={`flex-1 min-h-12 px-3 py-[14px] rounded-[14px] text-[15px] font-semibold ${
                  isTossMode
                    ? "bg-[#3182F6] text-white hover:bg-[#2b73dc]"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
              >
                {isKo ? "네" : "Yes"}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
