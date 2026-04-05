export const ROOM_EVENTS = {
  JoinRoom: "join_room",
  PlayerPresence: "player_presence",
  PuzzleCompleted: "puzzle_completed",
  SyncTime: "sync_time",
  MoveBatch: "move_batch",
  CursorMove: "cursor_move",
  ScoreDelta: "score_delta",
  ScoreSync: "score_sync",
  LockRequest: "lock_request",
  UnlockRequest: "unlock_request",
  LockApplied: "lock_applied",
  LockReleased: "lock_released",
  LockDenied: "lock_denied",
} as const;

export interface JoinRoomPayload {
  roomId: number;
  userId?: number;
  username?: string;
}
export type PuzzleCompletedPayload = number;

export interface PlayerPresencePayload {
  roomId: number;
  playerCount: number;
  users: string[];
}

export interface SyncTimePayload {
  accumulatedTime: number;
  isRunning: boolean;
}

export interface MoveBatchPayload {
  roomId: number;
  userId?: string;
  snapped?: boolean;
  updates: {
    pieceId: number;
    x: number;
    y: number;
    isLocked?: boolean;
    snappedBy?: string;
    rotationQuarter?: number;
    isBackFace?: boolean;
  }[];
}

export interface CursorMovePayload {
  roomId: number;
  username: string;
  x: number;
  y: number;
}

export interface ScoreDeltaPayload {
  roomId: number;
  username: string;
  delta: number;
}

export interface ScoreSyncPayload {
  roomId: number;
  username: string;
  score: number;
}

export interface LockRequestPayload {
  roomId: number;
  userId: string;
  pieceIds: number[];
}

export interface UnlockRequestPayload {
  roomId: number;
  userId: string;
  pieceIds: number[];
}

export interface LockAppliedPayload {
  roomId: number;
  userId: string;
  pieceIds: number[];
}

export interface LockReleasedPayload {
  roomId: number;
  userId: string;
  pieceIds: number[];
}

export interface LockDeniedPayload {
  roomId: number;
  userId: string;
  pieceIds: number[];
}
