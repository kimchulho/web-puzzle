import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { createClient } from '@supabase/supabase-js';
import { throttle } from 'lodash';
import { Clock, Users, Trophy, ChevronLeft, X, Palette } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';

// Supabase 클라이언트 초기화
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const SNAP_THRESHOLD = 30;

export default function PuzzleBoard({ roomId, imageUrl, pieceCount, onBack }: { roomId: number, imageUrl: string, pieceCount: number, onBack: () => void }) {
  const pixiContainer = useRef<HTMLDivElement>(null);
  const app = useRef<PIXI.Application | null>(null);
  const pieces = useRef<Map<number, PIXI.Container>>(new Map());
  const channelRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const textureAliasRef = useRef<string | null>(null);

  const [placedPieces, setPlacedPieces] = useState(0);
  const [totalPieces, setTotalPieces] = useState(pieceCount);
  const [playerCount, setPlayerCount] = useState(1);
  const [playTime, setPlayTime] = useState(0);
  const [scores, setScores] = useState<{username: string, score: number}[]>([]);
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set());
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [bgColor, setBgColor] = useState('#1e293b'); // default slate-800
  const [maxPlayers, setMaxPlayers] = useState(8);

  // 로컬 타이머 보간을 위한 Ref
  const accumulatedTimeRef = useRef(0);
  const isRunningRef = useRef(false);
  const localStartTimeRef = useRef(0);

  const activeUsersRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    activeUsersRef.current = activeUsers;
  }, [activeUsers]);

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

    socket.emit("join_room", roomId);

    socket.on("sync_time", (data: { accumulatedTime: number, isRunning: boolean }) => {
      accumulatedTimeRef.current = data.accumulatedTime;
      isRunningRef.current = data.isRunning;
      localStartTimeRef.current = Date.now();
      setPlayTime(Math.floor(data.accumulatedTime));
    });

    return () => {
      socket.disconnect();
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
    let isMounted = true;
    let appInstance: PIXI.Application | null = null;

    // 1. Pixi Application 초기화
    const initPixi = async () => {
      try {
        const app = new PIXI.Application();
        await app.init({ 
          resizeTo: window, 
          backgroundAlpha: 0,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true
        });

        if (!isMounted) {
          app.destroy(true);
          return;
        }

        appInstance = app;
        app.stage.eventMode = 'static';
        app.stage.hitArea = new PIXI.Rectangle(-10000, -10000, 20000, 20000);
        
        const world = new PIXI.Container();
        world.sortableChildren = true;
        app.stage.addChild(world);

        const cursorsContainer = new PIXI.Container();
        cursorsContainer.zIndex = 2000;
        world.addChild(cursorsContainer);
        const cursors = new Map<string, { container: PIXI.Container, targetX: number, targetY: number }>();

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
        let selectedShiftY = 0;
        let isDraggingSelected = false;
        let selectedMoved = false;
        let selectedTouchStartPos = { x: 0, y: 0 };
        let topZIndex = 1;

        // Global drag state for pieces
        let isDragging = false;
        let dragCluster = new Set<number>();
        let dragOffsets = new Map<number, {x: number, y: number}>();
        let currentShiftY = 0;
        let touchStartPos = { x: 0, y: 0 };
        let isTouchDraggingPiece = false;
        let pointerGlobalPos = { x: 0, y: 0 };
        let dragStartPieceId = -1;
        
        const targetPositions = new Map<number, {x: number, y: number}>();

        const updateTouches = (e: TouchEvent) => {
          activeTouches = e.touches.length;
          if (activeTouches === 0) {
            isDoubleTapZooming = false;
          }
        };

        app.stage.on('pointerdown', (e) => {
          if (activeTouches > 1 || isDoubleTapZooming) return;
          
          if (selectedCluster) {
            isDraggingSelected = true;
            selectedMoved = false;
            selectedTouchStartPos = { x: e.global.x, y: e.global.y };
            const localPos = e.getLocalPosition(world);
            selectedCluster.forEach(id => {
              const p = pieces.current.get(id)!;
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
          
          if (activeTouches <= 1) {
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

              channelRef.current?.send({
                type: 'broadcast',
                event: 'cursorMove',
                payload: {
                  username: localStorage.getItem('puzzle_username') || 'Anonymous',
                  x: broadcastX,
                  y: broadcastY
                }
              });
            }
          }

          if (isDraggingSelected && selectedCluster) {
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
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  p.zIndex = topZIndex;
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
              isDragging = false; // 핀치 줌이 시작되면 드래그 취소
              return;
            }
            
            if (e.pointerType === 'touch') {
              const dx = e.global.x - touchStartPos.x;
              const dy = e.global.y - touchStartPos.y;
              
              if (!isTouchDraggingPiece && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                isTouchDraggingPiece = true;
                topZIndex++;
                currentShiftY = pieceHeight * 1.6;
                
                if (selectedCluster) {
                  selectedCluster.forEach(id => {
                    const p = pieces.current.get(id)!;
                    const highlight = p.getChildByName('highlight');
                    if (highlight) highlight.visible = false;
                  });
                  selectedCluster = null;
                }
                
                const updates: any[] = [];
                dragCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  p.zIndex = topZIndex;
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
            } else {
              const localPos = e.getLocalPosition(world);
              const updates: any[] = [];
              
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const offset = dragOffsets.get(id)!;
                p.x = localPos.x - offset.x;
                p.y = localPos.y - offset.y;
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
              selectedCluster = dragCluster;
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const highlight = p.getChildByName('highlight');
                if (highlight) highlight.visible = true;
              });
              
              sendLockBatch(Array.from(selectedCluster));
              return;
            }
            
            isTouchDraggingPiece = false;
            sendUnlockBatch(Array.from(dragCluster));
            const snapped = snapCluster(dragCluster);
            if (snapped && selectedCluster && dragCluster.has(Array.from(selectedCluster)[0])) {
              selectedCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                const highlight = p.getChildByName('highlight');
                if (highlight) highlight.visible = false;
              });
              selectedCluster = null;
            }
            currentShiftY = 0;
            return;
          }

          if (isDraggingSelected) {
            isDraggingSelected = false;
            if (!selectedMoved) {
              // It was just a tap -> deselect
              if (selectedCluster) {
                sendUnlockBatch(Array.from(selectedCluster));
                selectedCluster.forEach(id => {
                  const p = pieces.current.get(id)!;
                  const highlight = p.getChildByName('highlight');
                  if (highlight) highlight.visible = false;
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
                    const highlight = p.getChildByName('highlight');
                    if (highlight) highlight.visible = false;
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
                        const highlight = p.getChildByName('highlight');
                        if (highlight) highlight.visible = true;
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
          cursors.forEach(cursorData => {
            cursorData.container.scale.set(1 / world.scale.x);
            const dx = cursorData.targetX - cursorData.container.x;
            const dy = cursorData.targetY - cursorData.container.y;
            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
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
          if (!isDragging && !isDraggingSelected) return;
          if (isDraggingSelected && !selectedMoved) return;
          if (isDragging && !isTouchDraggingPiece) return;
          
          const edgeMargin = 20;
          const scrollSpeed = 10;
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

          const newScale = Math.max(0.1, Math.min(world.scale.x * scaleMultiplier, 5));
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
          if (isDoubleTapZooming && e.touches.length === 1) {
            e.preventDefault();
            const currentY = e.touches[0].clientY;
            const deltaY = currentY - doubleTapZoomStartY;
            
            // 위로 드래그하면 축소, 아래로 드래그하면 확대
            const scaleMultiplier = Math.exp(deltaY * 0.01);
            const newScale = Math.max(0.1, Math.min(doubleTapInitialScale * scaleMultiplier, 5));
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
            const newScale = Math.max(0.1, Math.min(initialScale * scaleMultiplier, 5));
            
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
        const alias = `puzzleImage_${roomId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        textureAliasRef.current = alias;
        
        let texture;
        try {
          PIXI.Assets.add({ alias, src: imageUrl, data: { crossOrigin: 'anonymous' } });
          texture = await PIXI.Assets.load(alias);
        } catch (e) {
          console.error('Error loading texture:', e);
        }
        
        if (!isMounted) return;
        if (!texture) {
          console.error('Failed to load texture');
          return;
        }

        const TARGET_PIECE_COUNT = pieceCount;
        const aspectRatio = texture.width / texture.height;
        const GRID_ROWS = Math.max(1, Math.round(Math.sqrt(TARGET_PIECE_COUNT / Math.max(0.1, aspectRatio))));
        const GRID_COLS = Math.max(1, Math.round(aspectRatio * GRID_ROWS));
        const PIECE_COUNT = GRID_COLS * GRID_ROWS;
        setTotalPieces(PIECE_COUNT);

        const pieceWidth = texture.width / GRID_COLS;
        const pieceHeight = texture.height / GRID_ROWS;
        const tabDepth = Math.min(pieceWidth, pieceHeight) * 0.2;

        const boardWidth = texture.width;
        const boardHeight = texture.height;
        const boardStartX = 0;
        const boardStartY = 0;

        // 화면 중앙에 오도록 world 컨테이너 위치 조정 및 축소 (퍼즐판과 주변 조각이 모두 보이도록)
        const maxDim = Math.max(boardWidth, boardHeight);
        const boundingBoxSize = maxDim * 3.5;
        const initialFitScale = Math.min(app.screen.width / boundingBoxSize, app.screen.height / boundingBoxSize, 1);
        world.scale.set(initialFitScale);
        world.x = (app.screen.width - boardWidth * initialFitScale) / 2;
        world.y = (app.screen.height - boardHeight * initialFitScale) / 2;

        // 퍼즐 판 배경 그리기
        const boardBg = new PIXI.Graphics();
        boardBg.rect(boardStartX, boardStartY, boardWidth, boardHeight);
        boardBg.fill({ color: 0x000000, alpha: 0.3 });
        boardBg.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
        boardBg.zIndex = -1;
        world.addChild(boardBg);

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
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'moveBatch',
              payload: { updates }
            });
          }
        }, 50);

        const sendLockBatch = (pieceIds: number[]) => {
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'lock',
              payload: { pieceIds, userId: localStorage.getItem('puzzle_username') || 'unknown' }
            });
          }
        };

        const sendUnlockBatch = (pieceIds: number[]) => {
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'unlock',
              payload: { pieceIds, userId: localStorage.getItem('puzzle_username') || 'unknown' }
            });
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

        const checkCompletion = async () => {
          let lockedCount = 0;
          for (let i = 0; i < PIECE_COUNT; i++) {
            const p = pieces.current.get(i);
            if (p && p.eventMode === 'none') {
              lockedCount++;
            }
          }
          setPlacedPieces(lockedCount);
          
          if (lockedCount === PIECE_COUNT) {
            await supabase.from('pixi_rooms').update({ status: 'completed' }).eq('id', roomId);
            if (socketRef.current) {
              socketRef.current.emit("puzzle_completed", roomId);
            }
            triggerFireworks();
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
          const username = localStorage.getItem('puzzle_username') || 'Anonymous';
          
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
          const { data } = await supabase.from('pixi_scores').select('score').eq('room_id', roomId).eq('username', username).single();
          const newScore = (data?.score || 0) + points;
          await supabase.from('pixi_scores').upsert({ room_id: roomId, username, score: newScore }, { onConflict: 'room_id, username' });
          
          // Broadcast score update
          channelRef.current?.send({
            type: 'broadcast',
            event: 'scoreUpdate',
            payload: { username, score: newScore }
          });
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

          const updates: any[] = [];
          const dbUpdates: any[] = [];
          if (snapped) {
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(50);
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
              const highlight = p.getChildByName('highlight');
              if (highlight) highlight.visible = false;
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
            const highlight = p.getChildByName('highlight');
            if (highlight) highlight.visible = false;
          });

          snapCluster(selectedCluster);
          
          selectedCluster = null;
          isDraggingSelected = false;
        };

        const spacingX = pieceWidth * 1.6;
        const spacingY = pieceHeight * 1.6;
        
        const { data: existingPieces } = await supabase.from('pixi_pieces').select('*').eq('room_id', roomId);
        const hasExistingState = existingPieces && existingPieces.length > 0;
        const pieceStates = new Map<number, any>();
        if (hasExistingState) {
          existingPieces.forEach(p => pieceStates.set(p.piece_index, p));
        }

        const initialPositions: {x: number, y: number}[] = [];
        let placeLayer = 1;
        let placeSide = 0; // 0: Top, 1: Right, 2: Bottom, 3: Left
        let placeStep = 0;
        let initialPlacedCount = 0;
        
        for (let i = 0; i < PIECE_COUNT; i++) {
          let px = 0, py = 0;
          const minX = -placeLayer * spacingX;
          const minY = -placeLayer * spacingY;
          const maxX = boardWidth + placeLayer * spacingX;
          const maxY = boardHeight + placeLayer * spacingY;

          const countX = Math.ceil((maxX - minX) / spacingX);
          const countY = Math.ceil((maxY - minY) / spacingY);

          if (placeSide === 0) {
            px = minX + placeStep * ((maxX - minX) / countX);
            py = minY;
            placeStep++;
            if (placeStep >= countX) { placeSide = 1; placeStep = 0; }
          } else if (placeSide === 1) {
            px = maxX;
            py = minY + placeStep * ((maxY - minY) / countY);
            placeStep++;
            if (placeStep >= countY) { placeSide = 2; placeStep = 0; }
          } else if (placeSide === 2) {
            px = maxX - placeStep * ((maxX - minX) / countX);
            py = maxY;
            placeStep++;
            if (placeStep >= countX) { placeSide = 3; placeStep = 0; }
          } else if (placeSide === 3) {
            px = minX;
            py = maxY - placeStep * ((maxY - minY) / countY);
            placeStep++;
            if (placeStep >= countY) { placeSide = 0; placeStep = 0; placeLayer++; }
          }
          initialPositions.push({x: px, y: py});
        }
        
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

        for (let i = 0; i < PIECE_COUNT; i++) {
          const col = i % GRID_COLS;
          const row = Math.floor(i / GRID_COLS);

          const topTab = row === 0 ? 0 : -horizontalTabs[row - 1][col];
          const rightTab = col === GRID_COLS - 1 ? 0 : verticalTabs[row][col];
          const bottomTab = row === GRID_ROWS - 1 ? 0 : horizontalTabs[row][col];
          const leftTab = col === 0 ? 0 : -verticalTabs[row][col - 1];

          const pieceContainer = new PIXI.Container();
          
          const pieceGraphics = new PIXI.Graphics();
          pieceGraphics.moveTo(0, 0);
          drawEdge(pieceGraphics, 0, 0, pieceWidth, 0, topTab, tabDepth);
          drawEdge(pieceGraphics, pieceWidth, 0, pieceWidth, pieceHeight, rightTab, tabDepth);
          drawEdge(pieceGraphics, pieceWidth, pieceHeight, 0, pieceHeight, bottomTab, tabDepth);
          drawEdge(pieceGraphics, 0, pieceHeight, 0, 0, leftTab, tabDepth);
          
          const matrix = new PIXI.Matrix();
          matrix.translate(-col * pieceWidth, -row * pieceHeight);
          
          pieceGraphics.fill({ texture: texture, matrix: matrix, textureSpace: 'global' });
          pieceGraphics.stroke({ width: 2, color: 0x000000, alpha: 0.3 });

          const highlightGraphics = new PIXI.Graphics();
          highlightGraphics.moveTo(0, 0);
          drawEdge(highlightGraphics, 0, 0, pieceWidth, 0, topTab, tabDepth);
          drawEdge(highlightGraphics, pieceWidth, 0, pieceWidth, pieceHeight, rightTab, tabDepth);
          drawEdge(highlightGraphics, pieceWidth, pieceHeight, 0, pieceHeight, bottomTab, tabDepth);
          drawEdge(highlightGraphics, 0, pieceHeight, 0, 0, leftTab, tabDepth);
          highlightGraphics.closePath();
          highlightGraphics.stroke({ width: 4, color: 0x00ff00, alpha: 0.8 });

          // 렌더링 최적화: 벡터 그래픽을 텍스처로 변환하여 Sprite로 사용
          const pieceTexture = app.renderer.generateTexture(pieceGraphics);
          const pieceSprite = new PIXI.Sprite(pieceTexture);
          
          const highlightTexture = app.renderer.generateTexture(highlightGraphics);
          const highlightSprite = new PIXI.Sprite(highlightTexture);
          
          const bounds = pieceGraphics.getLocalBounds();
          const offsetX = bounds.minX !== undefined ? bounds.minX : bounds.x;
          const offsetY = bounds.minY !== undefined ? bounds.minY : bounds.y;
          
          pieceSprite.x = offsetX;
          pieceSprite.y = offsetY;
          
          highlightSprite.x = offsetX;
          highlightSprite.y = offsetY;
          highlightSprite.visible = false;
          highlightSprite.name = 'highlight';

          pieceContainer.addChild(highlightSprite);
          pieceContainer.addChild(pieceSprite);

          // 메모리 누수 방지를 위해 원본 그래픽 파괴
          pieceGraphics.destroy();
          highlightGraphics.destroy();

          // 퍼즐판 바깥에 겹치지 않게 배치
          let state = pieceStates.get(i);
          if (hasExistingState && state) {
            pieceContainer.x = state.x;
            pieceContainer.y = state.y;
            if (state.is_locked) {
              pieceContainer.eventMode = 'none';
              pieceContainer.zIndex = 0;
              initialPlacedCount++;
            } else {
              pieceContainer.eventMode = 'static';
              pieceContainer.cursor = 'pointer';
              pieceContainer.zIndex = 1;
            }
          } else {
            const pos = initialPositions[i];
            pieceContainer.x = pos.x;
            pieceContainer.y = pos.y;
            pieceContainer.eventMode = 'static';
            pieceContainer.cursor = 'pointer';
            pieceContainer.zIndex = 1;
          }

          // 드래그 로직
          pieceContainer.on('pointerdown', (e: PIXI.FederatedPointerEvent) => {
            if (activeTouches > 1 || isDoubleTapZooming) return; // 핀치 줌/더블탭 줌 중에는 드래그 시작 방지
            
            if (selectedCluster) {
              // 선택된 조각이 있을 때는 무조건 배경(stage)으로 이벤트를 넘겨서
              // 아무 곳이나 드래그/터치 시 선택된 조각이 제어되도록 함
              return;
            }
            
            e.stopPropagation(); // 조각 클릭 시 배경 패닝 이벤트 방지

            touchStartPos = { x: e.global.x, y: e.global.y };
            isTouchDraggingPiece = false;
            isDragging = true;
            dragStartPieceId = i;
            
            dragCluster = getConnectedCluster(i);
            const localPos = e.getLocalPosition(world);
            dragOffsets.clear();
            dragCluster.forEach(id => {
              const p = pieces.current.get(id)!;
              dragOffsets.set(id, { x: localPos.x - p.x, y: localPos.y - p.y });
              targetPositions.delete(id);
            });
            currentShiftY = 0;
            
            if (e.pointerType !== 'touch') {
              isTouchDraggingPiece = true;
              topZIndex++;
              const updates: any[] = [];
              dragCluster.forEach(id => {
                const p = pieces.current.get(id)!;
                p.zIndex = topZIndex;
                updates.push({ pieceId: id, x: p.x, y: p.y });
              });
              sendLockBatch(Array.from(dragCluster));
              sendMoveBatch(updates);
            }
          });

          world.addChild(pieceContainer);
          pieces.current.set(i, pieceContainer);
        }
        setPlacedPieces(initialPlacedCount);

        // 3. Supabase Realtime 수신
        const channel = supabase.channel(`room_${roomId}`);
        channelRef.current = channel;
        
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
                  pieceContainer.zIndex = 1000;
                }
              }
            });
          })
          .on('broadcast', { event: 'lock' }, ({ payload }) => {
            payload.pieceIds.forEach((id: number) => {
              const pieceContainer = pieces.current.get(id);
              if (pieceContainer) {
                // 자신이 드래그 중인 조각은 무시
                if ((isDragging && dragCluster.has(id)) || (selectedCluster && selectedCluster.has(id))) return;
                
                pieceContainer.alpha = 0.5;
                pieceContainer.eventMode = 'none';
              }
            });
          })
          .on('broadcast', { event: 'unlock' }, ({ payload }) => {
            payload.pieceIds.forEach((id: number) => {
              const pieceContainer = pieces.current.get(id);
              if (pieceContainer) {
                pieceContainer.alpha = 1;
                
                // 완전히 맞춰진 조각이 아니라면 다시 상호작용 가능하게 복구
                const col = id % GRID_COLS;
                const row = Math.floor(id / GRID_COLS);
                const targetX = boardStartX + col * pieceWidth;
                const targetY = boardStartY + row * pieceHeight;
                
                if (Math.abs(pieceContainer.x - targetX) >= 1 || Math.abs(pieceContainer.y - targetY) >= 1) {
                  pieceContainer.eventMode = 'static';
                }
              }
            });
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
            if (username === (localStorage.getItem('puzzle_username') || 'Anonymous')) return;

            let cursorData = cursors.get(username);
            if (!cursorData) {
              const container = new PIXI.Container();
              
              const graphics = new PIXI.Graphics();
              graphics.beginFill(0xffffff);
              graphics.drawCircle(0, 0, 4);
              graphics.endFill();
              
              const text = new PIXI.Text(username, {
                fontFamily: 'Arial',
                fontSize: 12,
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: 3
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
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState();
            let count = 0;
            const users = new Set<string>();
            for (const key in state) {
              count += state[key].length;
              state[key].forEach((p: any) => {
                if (p.user) users.add(p.user);
              });
            }
            setPlayerCount(count);
            setActiveUsers(users);
            
            // Remove cursors for users who left
            cursors.forEach((cursorData, username) => {
              if (!users.has(username)) {
                cursorData.container.destroy();
                cursors.delete(username);
              }
            });
          })
          .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
              await channel.track({ user: localStorage.getItem('puzzle_username') || 'Anonymous' });
            }
          });

      } catch (error) {
        console.error('Pixi initialization error:', error);
      }
    };

    initPixi();

    return () => {
      isMounted = false;
      if (appInstance) {
        appInstance.destroy(true);
      }
      if (channelRef.current) {
        channelRef.current.unsubscribe();
      }
      if (textureAliasRef.current) {
        PIXI.Assets.unload(textureAliasRef.current).catch(() => {});
        textureAliasRef.current = null;
      }
    };
  }, [imageUrl]);

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: bgColor }}>
      <div className="absolute top-0 left-0 w-full z-50 bg-slate-900/80 backdrop-blur-sm border-b border-slate-700/50 p-2 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4 text-white shadow-lg">
        {/* Top Row (Mobile) / Left Side (Desktop) */}
        <div className="flex items-center justify-between w-full sm:w-auto gap-2">
          <button 
            onClick={onBack}
            className="flex items-center gap-1 sm:gap-2 bg-slate-800 hover:bg-slate-700 px-2 sm:px-3 py-1.5 rounded-lg transition-colors border border-slate-600 shrink-0"
          >
            <ChevronLeft size={18} className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base hidden sm:inline">Lobby</span>
          </button>
          
          <div className="flex items-center gap-2 bg-slate-800/50 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700/50 flex-1 sm:flex-none justify-center">
            <div className="w-full max-w-[60px] sm:max-w-none sm:w-32 bg-slate-700 rounded-full h-2 sm:h-2.5 overflow-hidden">
              <div 
                className="bg-blue-500 h-full rounded-full transition-all duration-500" 
                style={{ width: `${(placedPieces / totalPieces) * 100}%` }}
              ></div>
            </div>
            <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
              {placedPieces} / {totalPieces}
            </span>
          </div>

          {/* Leaderboard Button on Mobile Top Right */}
          <button 
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className={`flex sm:hidden items-center gap-1 px-2 py-1.5 rounded-lg transition-colors border shrink-0 ${showLeaderboard ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-slate-800 hover:bg-slate-700 border-slate-600'}`}
          >
            <Trophy size={14} className={showLeaderboard ? 'text-amber-400' : 'text-slate-400'} />
            <span className="text-xs font-medium">Rank</span>
          </button>
        </div>

        {/* Bottom Row (Mobile) / Right Side (Desktop) */}
        <div className="flex items-center w-full sm:w-auto gap-2 justify-center sm:justify-end">
          <div className="flex items-center gap-1 sm:gap-2 bg-slate-800/50 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700/50 flex-1 sm:flex-none justify-center">
            <Users size={14} className="text-slate-400 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
              {playerCount}/{maxPlayers} <span className="hidden sm:inline">Player(s)</span>
            </span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 bg-slate-800/50 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700/50 flex-1 sm:flex-none justify-center">
            <Clock size={14} className="text-slate-400 sm:w-4 sm:h-4" />
            <span className="text-xs sm:text-sm font-medium font-mono whitespace-nowrap">{formatTime(playTime)}</span>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 bg-slate-800/50 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700/50 shrink-0">
            <Palette size={14} className="text-slate-400 sm:w-4 sm:h-4" />
            <input 
              type="color" 
              value={bgColor} 
              onChange={(e) => setBgColor(e.target.value)}
              className="w-5 h-5 sm:w-6 sm:h-6 p-0 border-0 rounded cursor-pointer bg-transparent"
              title="Change Background Color"
            />
          </div>

          <button 
            onClick={() => setShowLeaderboard(!showLeaderboard)}
            className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border shrink-0 ${showLeaderboard ? 'bg-amber-500/20 border-amber-500/50 text-amber-400' : 'bg-slate-800 hover:bg-slate-700 border-slate-600'}`}
          >
            <Trophy size={16} className={showLeaderboard ? 'text-amber-400' : 'text-slate-400'} />
            <span className="font-medium text-sm">Leaderboard</span>
          </button>
        </div>
      </div>

      {showLeaderboard && (
        <div className="absolute top-20 right-4 z-50 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="bg-slate-900/50 p-3 border-b border-slate-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-amber-400" />
              <h3 className="font-bold text-white">Leaderboard</h3>
            </div>
            <button onClick={() => setShowLeaderboard(false)} className="text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {scores.length === 0 ? (
              <div className="text-center text-slate-400 py-4 text-sm">No scores yet</div>
            ) : (
              <div className="space-y-1">
                {scores.map((score, idx) => {
                  const isMe = score.username === (localStorage.getItem('puzzle_username') || 'Anonymous');
                  return (
                  <div key={idx} className={`flex items-center justify-between p-2 rounded-lg transition-colors ${isMe ? 'bg-blue-500/20 border border-blue-500/30' : 'hover:bg-slate-700/50'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold w-4 text-center ${idx === 0 ? 'text-amber-400' : idx === 1 ? 'text-slate-300' : idx === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {idx + 1}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${activeUsers.has(score.username) ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-600'}`} title={activeUsers.has(score.username) ? 'Online' : 'Offline'} />
                        <span className={`text-sm truncate max-w-[100px] ${isMe ? 'text-blue-300 font-bold' : activeUsers.has(score.username) ? 'text-slate-200' : 'text-slate-400'}`} title={score.username}>
                          {score.username}
                        </span>
                        {isMe && <span className="text-[10px] font-bold text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded-full ml-1">YOU</span>}
                      </div>
                    </div>
                    <span className="font-bold text-blue-400">{score.score}</span>
                  </div>
                )})}
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={pixiContainer} className="w-full h-full overflow-hidden" />
    </div>
  );
}
