export const ROOM_EVENTS = {
  JoinRoom: "join_room",
  PuzzleCompleted: "puzzle_completed",
  SyncTime: "sync_time",
  ScoreDelta: "score_delta",
  ScoreSync: "score_sync",
  LockRequest: "lock_request",
  UnlockRequest: "unlock_request",
  LockApplied: "lock_applied",
  LockReleased: "lock_released",
  LockDenied: "lock_denied",
} as const;

export type JoinRoomPayload = number;
export type PuzzleCompletedPayload = number;

export interface SyncTimePayload {
  accumulatedTime: number;
  isRunning: boolean;
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
