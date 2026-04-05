export interface AuthUser {
  id: number;
  username: string;
  role: string;
  completed_puzzles: number;
  placed_pieces: number;
  /** Default true: `GET /api/profile/:username` works; set false for private. Uploaded room images stay private. */
  profile_public?: boolean;
  created_at: string;
  last_active_at: string | null;
}

export interface AuthSuccessResponse {
  accessToken: string;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
}

/** Apps in Toss: appLogin → authorizationCode + referrer */
export interface TossLoginRequest {
  authorizationCode: string;
  referrer: string;
}
