import express from "express";
import { existsSync } from "fs";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import {
  ROOM_EVENTS,
  LockAppliedPayload,
  LockDeniedPayload,
  LockRequestPayload,
  LockReleasedPayload,
  ScoreDeltaPayload,
  ScoreSyncPayload,
  SyncTimePayload,
  UnlockRequestPayload,
} from "./packages/contracts/realtime";
import { HealthResponse } from "./packages/contracts/api";
import { AuthSuccessResponse, TossLoginRequest } from "./packages/contracts/auth";
import { tossPartnerRequest } from "./tossPartnerClient";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase 클라이언트 초기화 (서버용)
const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const authSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey)
  : null;
const jwtSecret = process.env.JWT_SECRET || "dev-jwt-secret-change-me";

type AuthProvider = "web_local" | "toss";

interface JwtPayload {
  sub: string;
  provider: AuthProvider;
  channel: "web" | "toss";
  role: "player";
}

interface AuthedRequest extends Request {
  user?: JwtPayload;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });
  
  const PORT = process.env.PORT || 3000;

  // Allow cross-origin API calls (e.g. local Granite WebView -> Render API).
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
    return next();
  });

  app.use(express.json());

  if (!authSupabase) {
    console.warn(
      "SUPABASE_SERVICE_ROLE_KEY is missing. /api/auth/web/* endpoints will return 503."
    );
  }

  app.get("/api/health", (req, res) => {
    const payload: HealthResponse = {
      status: "ok",
      message: "Server is running with Socket.io",
    };
    res.json(payload);
  });

  const issueToken = (payload: JwtPayload) =>
    jwt.sign(payload, jwtSecret, { expiresIn: "7d" });

  const parseBearerToken = (authorizationHeader?: string) => {
    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      return null;
    }
    return authorizationHeader.slice("Bearer ".length).trim();
  };

  const authRequired = (req: AuthedRequest, res: Response, next: NextFunction) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ message: "Missing access token." });
    }
    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired access token." });
    }
  };

  app.post("/api/auth/web/signup", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const { username, password } = req.body ?? {};
    const normalizedUsername = (username ?? "").toString().trim().toLowerCase();
    const rawPassword = (password ?? "").toString();

    if (!normalizedUsername || rawPassword.length < 4) {
      return res.status(400).json({
        message: "username is required and password must be at least 4 characters.",
      });
    }

    const { data: existingIdentity, error: existingError } = await authSupabase
      .from("pixi_user_identities")
      .select("id")
      .eq("provider", "web_local")
      .eq("provider_user_id", normalizedUsername)
      .maybeSingle();

    if (existingError) {
      return res.status(500).json({ message: existingError.message });
    }
    if (existingIdentity) {
      return res.status(409).json({ message: "Username already exists." });
    }

    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const { data: createdUser, error: userInsertError } = await authSupabase
      .from("pixi_users")
      .insert({
        username: normalizedUsername,
        password: passwordHash,
        role: normalizedUsername === "admin" ? "admin" : "user",
        completed_puzzles: 0,
        placed_pieces: 0,
      })
      .select("id, username, role, completed_puzzles, placed_pieces, created_at, last_active_at")
      .single();

    if (userInsertError || !createdUser) {
      return res
        .status(500)
        .json({ message: userInsertError?.message ?? "Failed to create user." });
    }

    const { error: identityInsertError } = await authSupabase.from("pixi_user_identities").insert({
      user_id: createdUser.id,
      provider: "web_local",
      provider_user_id: normalizedUsername,
      password_hash: passwordHash,
      last_login_at: new Date().toISOString(),
    });

    if (identityInsertError) {
      await authSupabase.from("pixi_users").delete().eq("id", createdUser.id);
      return res.status(500).json({ message: identityInsertError.message });
    }

    const token = issueToken({
      sub: String(createdUser.id),
      provider: "web_local",
      channel: "web",
      role: "player",
    });

    return res.status(201).json({
      accessToken: token,
      user: createdUser,
    });
  });

  app.post("/api/auth/web/login", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const { username, password } = req.body ?? {};
    const normalizedUsername = (username ?? "").toString().trim().toLowerCase();
    const rawPassword = (password ?? "").toString();

    if (!normalizedUsername || !rawPassword) {
      return res.status(400).json({ message: "username and password are required." });
    }

    const { data: identity, error: identityError } = await authSupabase
      .from("pixi_user_identities")
      .select("id, user_id, password_hash")
      .eq("provider", "web_local")
      .eq("provider_user_id", normalizedUsername)
      .maybeSingle();

    if (identityError) {
      return res.status(500).json({ message: identityError.message });
    }
    if (!identity?.password_hash) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const passwordMatch = await bcrypt.compare(rawPassword, identity.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const { data: user, error: userError } = await authSupabase
      .from("pixi_users")
      .select("id, username, role, completed_puzzles, placed_pieces, created_at, last_active_at")
      .eq("id", identity.user_id)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ message: userError.message });
    }
    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    await authSupabase
      .from("pixi_user_identities")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", identity.id);

    await authSupabase
      .from("pixi_users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", user.id);

    const token = issueToken({
      sub: String(user.id),
      provider: "web_local",
      channel: "web",
      role: "player",
    });

    const response: AuthSuccessResponse = {
      accessToken: token,
      user,
    };
    return res.json(response);
  });

  app.post("/api/auth/toss/login", async (req, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }

    const { authorizationCode, referrer } = (req.body ?? {}) as TossLoginRequest;
    const code = (authorizationCode ?? "").toString().trim();
    const ref = (referrer ?? "").toString().trim();
    const codePreview = code ? `${code.slice(0, 8)}...(${code.length})` : "empty";

    if (!code || !ref) {
      return res.status(400).json({
        message: "authorizationCode and referrer are required (Apps in Toss appLogin response).",
      });
    }

    /** Partner API expects lowercase `sandbox` for 샌드박스; `appLogin` types use `SANDBOX`. */
    const partnerReferrer =
      ref === "SANDBOX" || ref.toLowerCase() === "sandbox" ? "sandbox" : ref;
    console.log("[toss-login] incoming", {
      referrer: ref,
      partnerReferrer,
      codePreview,
    });

    let providerUserId: string;
    try {
      const tokenRes = await tossPartnerRequest<Record<string, unknown>>({
        method: "POST",
        path: "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
        headers: {},
        jsonBody: { authorizationCode: code, referrer: partnerReferrer },
      });

      if (tokenRes.statusCode < 200 || tokenRes.statusCode >= 300) {
        return res.status(502).json({
          message: `Toss generate-token HTTP ${tokenRes.statusCode}.`,
          detail: tokenRes.body,
        });
      }

      const tokenBody = tokenRes.body as {
        resultType?: string;
        success?: { accessToken?: string };
        error?: string | { reason?: string };
      };

      if (tokenBody.error === "invalid_grant") {
        return res.status(401).json({ message: "invalid_grant", detail: tokenBody });
      }

      if (tokenBody.resultType !== "SUCCESS" || !tokenBody.success?.accessToken) {
        console.error("[toss-login] generate-token not successful", {
          resultType: tokenBody.resultType,
          error: tokenBody.error,
          referrer: partnerReferrer,
        });
        return res.status(502).json({
          message:
            `Toss generate-token did not return a successful accessToken. ` +
            `resultType=${String(tokenBody.resultType)} error=${JSON.stringify(tokenBody.error)}`,
          detail: tokenBody,
        });
      }

      const tossAccessToken = tokenBody.success.accessToken;

      const meRes = await tossPartnerRequest<Record<string, unknown>>({
        method: "GET",
        path: "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
        headers: { Authorization: `Bearer ${tossAccessToken}` },
      });

      if (meRes.statusCode < 200 || meRes.statusCode >= 300) {
        return res.status(502).json({
          message: `Toss login-me HTTP ${meRes.statusCode}.`,
          detail: meRes.body,
        });
      }

      const meBody = meRes.body as {
        resultType?: string;
        success?: { userKey?: number };
        error?: string;
      };

      if (meBody.error === "invalid_grant") {
        return res.status(401).json({ message: "invalid_grant", detail: meBody });
      }

      const userKey = meBody.success?.userKey;
      if (meBody.resultType !== "SUCCESS" || userKey === undefined || userKey === null) {
        return res.status(502).json({
          message: "Toss login-me did not return userKey.",
          detail: meBody,
        });
      }

      providerUserId = String(userKey);
    } catch (error) {
      console.error("[toss-login] partner API request failed", error);
      return res.status(502).json({
        message: "Toss partner API request failed.",
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const { data: existingIdentity, error: identityError } = await authSupabase
      .from("pixi_user_identities")
      .select("id, user_id")
      .eq("provider", "toss")
      .eq("provider_user_id", providerUserId)
      .maybeSingle();

    if (identityError) {
      return res.status(500).json({ message: identityError.message });
    }

    let userId = existingIdentity?.user_id as number | undefined;
    if (!userId) {
      const generatedUsername = `toss_${providerUserId}`.slice(0, 64);
      const { data: createdUser, error: createUserError } = await authSupabase
        .from("pixi_users")
        .insert({
          username: generatedUsername,
          password: "",
          role: "user",
          completed_puzzles: 0,
          placed_pieces: 0,
        })
        .select("id")
        .single();

      if (createUserError || !createdUser) {
        return res
          .status(500)
          .json({ message: createUserError?.message ?? "Failed to create toss user." });
      }
      userId = createdUser.id as number;

      const { error: createIdentityError } = await authSupabase
        .from("pixi_user_identities")
        .insert({
          user_id: userId,
          provider: "toss",
          provider_user_id: providerUserId,
          password_hash: null,
          last_login_at: new Date().toISOString(),
        });

      if (createIdentityError) {
        await authSupabase.from("pixi_users").delete().eq("id", userId);
        return res.status(500).json({ message: createIdentityError.message });
      }
    } else {
      await authSupabase
        .from("pixi_user_identities")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", existingIdentity?.id);
    }

    const { data: user, error: userError } = await authSupabase
      .from("pixi_users")
      .select("id, username, role, completed_puzzles, placed_pieces, created_at, last_active_at")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(500).json({ message: userError?.message ?? "Failed to load user." });
    }

    await authSupabase
      .from("pixi_users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", user.id);

    const token = issueToken({
      sub: String(user.id),
      provider: "toss",
      channel: "toss",
      role: "player",
    });

    const response: AuthSuccessResponse = {
      accessToken: token,
      user,
    };
    return res.json(response);
  });

  app.get("/api/auth/me", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!userId) {
      return res.status(401).json({ message: "Invalid token subject." });
    }

    const { data: user, error } = await authSupabase
      .from("pixi_users")
      .select("id, username, role, completed_puzzles, placed_pieces, created_at, last_active_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ message: error.message });
    }
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({ user });
  });

  /** 이어하기용 방문 목록 (RLS 우회: service role + JWT sub = pixi_users.id). */
  app.get("/api/user/room-visits", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }

    const { data, error } = await authSupabase
      .from("pixi_user_room_visits")
      .select("room_id, last_visited_at")
      .eq("user_id", userId)
      .order("last_visited_at", { ascending: false })
      .limit(40);

    if (error) {
      console.warn("[api/user/room-visits]", error.message);
      return res.status(500).json({ message: error.message });
    }
    return res.json({ visits: data ?? [] });
  });

  /** Logged-in room visit for 이어하기 (RLS 우회: service role + JWT의 sub만 신뢰). */
  app.post("/api/user/room-visit", authRequired, async (req: AuthedRequest, res) => {
    if (!authSupabase) {
      return res.status(503).json({
        message: "Auth server misconfigured. Set SUPABASE_SERVICE_ROLE_KEY in .env.",
      });
    }
    const userId = Number(req.user?.sub);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ message: "Invalid token subject." });
    }
    const roomId = Number((req.body ?? {}).roomId);
    if (!Number.isFinite(roomId) || roomId <= 0) {
      return res.status(400).json({ message: "roomId must be a positive number." });
    }

    const { error } = await authSupabase.from("pixi_user_room_visits").upsert(
      {
        user_id: userId,
        room_id: roomId,
        last_visited_at: new Date().toISOString(),
      },
      { onConflict: "user_id,room_id" }
    );

    if (error) {
      console.warn("[api/user/room-visit]", error.message);
      return res.status(500).json({ message: error.message });
    }
    return res.status(204).end();
  });

  // ==========================================
  // Socket.io & Playtime Logic
  // ==========================================
  
  // 방 상태 메모리: roomId -> { accumulatedTime(초), lastResumeTime(ms), users, isCompleted }
  const roomStates = new Map<number, { 
    accumulatedTime: number; 
    lastResumeTime: number | null; 
    users: Set<string>; 
    isCompleted: boolean 
  }>();
  const roomPieceLocks = new Map<number, Map<number, { socketId: string; userId: string }>>();
  const roomScoreCache = new Map<number, Map<string, number>>();
  const socketOwnedPieceIds = new Map<string, Map<number, Set<number>>>();
  const socketUserId = new Map<string, string>();

  // 현재까지의 정확한 플레이 타임 계산 (초 단위)
  const getCurrentPlayTime = (room: any) => {
    let time = room.accumulatedTime;
    if (room.lastResumeTime && !room.isCompleted) {
      time += (Date.now() - room.lastResumeTime) / 1000;
    }
    return time;
  };

  io.on("connection", (socket) => {
    let currentRoomId: number | null = null;
    const rememberOwned = (roomId: number, pieceId: number) => {
      if (!socketOwnedPieceIds.has(socket.id)) socketOwnedPieceIds.set(socket.id, new Map());
      const byRoom = socketOwnedPieceIds.get(socket.id)!;
      if (!byRoom.has(roomId)) byRoom.set(roomId, new Set());
      byRoom.get(roomId)!.add(pieceId);
    };
    const forgetOwned = (roomId: number, pieceId: number) => {
      const byRoom = socketOwnedPieceIds.get(socket.id);
      if (!byRoom) return;
      const ids = byRoom.get(roomId);
      if (!ids) return;
      ids.delete(pieceId);
      if (ids.size === 0) byRoom.delete(roomId);
      if (byRoom.size === 0) socketOwnedPieceIds.delete(socket.id);
    };
    const releaseOwnedLocks = (roomId: number, userIdFallback = "guest") => {
      const locks = roomPieceLocks.get(roomId);
      const byRoom = socketOwnedPieceIds.get(socket.id);
      const owned = byRoom?.get(roomId);
      if (!locks || !owned || owned.size === 0) return;
      const released: number[] = [];
      let userId = userIdFallback;
      for (const pieceId of [...owned]) {
        const owner = locks.get(pieceId);
        if (owner?.socketId === socket.id) {
          userId = owner.userId || userId;
          locks.delete(pieceId);
          released.push(pieceId);
        }
      }
      byRoom?.delete(roomId);
      if (byRoom && byRoom.size === 0) socketOwnedPieceIds.delete(socket.id);
      if (locks.size === 0) roomPieceLocks.delete(roomId);
      if (released.length > 0) {
        const payload: LockReleasedPayload = { roomId, userId, pieceIds: released };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockReleased, payload);
      }
    };
    const getRoomScoreMap = async (roomId: number): Promise<Map<string, number>> => {
      const cached = roomScoreCache.get(roomId);
      if (cached) return cached;
      const { data, error } = await supabase
        .from("pixi_scores")
        .select("username, score")
        .eq("room_id", roomId);
      if (error) {
        console.warn("[score-cache/load]", error.message);
        const empty = new Map<string, number>();
        roomScoreCache.set(roomId, empty);
        return empty;
      }
      const m = new Map<string, number>();
      for (const row of data ?? []) {
        const username = String((row as { username?: unknown }).username ?? "").trim();
        if (!username) continue;
        const scoreRaw = Number((row as { score?: unknown }).score ?? 0);
        m.set(username, Number.isFinite(scoreRaw) ? scoreRaw : 0);
      }
      roomScoreCache.set(roomId, m);
      return m;
    };
    const distributeCompletionRewards = async (roomId: number) => {
      const scoreMap = await getRoomScoreMap(roomId);
      const roomScores = [...scoreMap.entries()]
        .map(([username, score]) => ({ username, score: Number.isFinite(score) ? score : 0 }))
        .filter((x) => x.username && x.score > 0);
      if (roomScores.length === 0) return;
      const usernames = roomScores.map((x) => x.username);
      const { data: users, error: usersError } = await supabase
        .from("pixi_users")
        .select("id, username, completed_puzzles, placed_pieces")
        .in("username", usernames);
      if (usersError) {
        console.warn("[completion-reward/load-users]", usersError.message);
        return;
      }
      const byName = new Map(
        (users ?? []).map((u) => [String((u as { username: unknown }).username), u as any])
      );
      await Promise.all(
        roomScores.map(async ({ username, score }) => {
          const u = byName.get(username);
          if (!u) return;
          const completed = Number(u.completed_puzzles ?? 0) + 1;
          const placed = Number(u.placed_pieces ?? 0) + score;
          const { error } = await supabase
            .from("pixi_users")
            .update({ completed_puzzles: completed, placed_pieces: placed })
            .eq("id", u.id);
          if (error) {
            console.warn("[completion-reward/update-user]", { username, message: error.message });
          }
        })
      );
    };

    socket.on(ROOM_EVENTS.JoinRoom, async (roomId: number) => {
      if (currentRoomId) {
        releaseOwnedLocks(currentRoomId, socketUserId.get(socket.id) ?? "guest");
        socket.leave(currentRoomId.toString());
        const oldRoom = roomStates.get(currentRoomId);
        if (oldRoom) {
          oldRoom.users.delete(socket.id);
          // 마지막 유저가 나갔다면 타이머 일시정지
          if (oldRoom.users.size === 0 && !oldRoom.isCompleted && oldRoom.lastResumeTime) {
            oldRoom.accumulatedTime += (Date.now() - oldRoom.lastResumeTime) / 1000;
            oldRoom.lastResumeTime = null;
            
            supabase.from("pixi_rooms").update({ 
              total_play_time_seconds: Math.floor(oldRoom.accumulatedTime)
            }).eq("id", currentRoomId).then();
          }
        }
      }

      currentRoomId = roomId;
      socket.join(roomId.toString());

      if (!roomStates.has(roomId)) {
        const { data } = await supabase
          .from("pixi_rooms")
          .select("total_play_time_seconds, status")
          .eq("id", roomId)
          .single();
          
        roomStates.set(roomId, {
          accumulatedTime: data?.total_play_time_seconds || 0,
          lastResumeTime: null,
          users: new Set(),
          isCompleted: data?.status === "completed"
        });
      }

      const room = roomStates.get(roomId)!;
      
      // 방에 아무도 없었는데 내가 처음 들어온 거라면 타이머 시작
      if (room.users.size === 0 && !room.isCompleted) {
        room.lastResumeTime = Date.now();
      }
      
      room.users.add(socket.id);
      
      // 접속한 유저에게만 현재 기준 시간 동기화
      const syncPayload: SyncTimePayload = {
        accumulatedTime: getCurrentPlayTime(room), 
        isRunning: !room.isCompleted 
      };
      socket.emit(ROOM_EVENTS.SyncTime, syncPayload);
    });

    socket.on(ROOM_EVENTS.LockRequest, (raw: LockRequestPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const userId = String(raw?.userId ?? "").trim() || "guest";
      socketUserId.set(socket.id, userId);
      const input = Array.isArray(raw?.pieceIds) ? raw.pieceIds : [];
      const req = [...new Set(input.filter((x) => Number.isFinite(x) && x >= 0).map((x) => Math.floor(x)))];
      if (req.length === 0) return;
      if (!roomPieceLocks.has(roomId)) roomPieceLocks.set(roomId, new Map());
      const locks = roomPieceLocks.get(roomId)!;
      const granted: number[] = [];
      const denied: number[] = [];
      for (const pieceId of req) {
        const owner = locks.get(pieceId);
        if (!owner || owner.socketId === socket.id) {
          locks.set(pieceId, { socketId: socket.id, userId });
          rememberOwned(roomId, pieceId);
          granted.push(pieceId);
        } else {
          denied.push(pieceId);
        }
      }
      if (granted.length > 0) {
        const payload: LockAppliedPayload = { roomId, userId, pieceIds: granted };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockApplied, payload);
      }
      if (denied.length > 0) {
        const payload: LockDeniedPayload = { roomId, userId, pieceIds: denied };
        socket.emit(ROOM_EVENTS.LockDenied, payload);
      }
    });

    socket.on(ROOM_EVENTS.UnlockRequest, (raw: UnlockRequestPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const userId = String(raw?.userId ?? "").trim() || socketUserId.get(socket.id) || "guest";
      const input = Array.isArray(raw?.pieceIds) ? raw.pieceIds : [];
      const req = [...new Set(input.filter((x) => Number.isFinite(x) && x >= 0).map((x) => Math.floor(x)))];
      if (req.length === 0) return;
      const locks = roomPieceLocks.get(roomId);
      if (!locks) return;
      const released: number[] = [];
      for (const pieceId of req) {
        const owner = locks.get(pieceId);
        if (owner?.socketId === socket.id) {
          locks.delete(pieceId);
          forgetOwned(roomId, pieceId);
          released.push(pieceId);
        }
      }
      if (locks.size === 0) roomPieceLocks.delete(roomId);
      if (released.length > 0) {
        const payload: LockReleasedPayload = { roomId, userId, pieceIds: released };
        io.to(roomId.toString()).emit(ROOM_EVENTS.LockReleased, payload);
      }
    });

    socket.on(ROOM_EVENTS.ScoreDelta, async (raw: ScoreDeltaPayload) => {
      const roomId = Number(raw?.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0 || currentRoomId !== roomId) return;
      const username = String(raw?.username ?? "").trim();
      if (!username) return;
      const delta = Math.max(0, Math.floor(Number(raw?.delta ?? 0)));
      if (!Number.isFinite(delta) || delta <= 0) return;
      const scoreMap = await getRoomScoreMap(roomId);
      const nextScore = (scoreMap.get(username) ?? 0) + delta;
      scoreMap.set(username, nextScore);
      const payload: ScoreSyncPayload = { roomId, username, score: nextScore };
      io.to(roomId.toString()).emit(ROOM_EVENTS.ScoreSync, payload);
      const { error } = await supabase
        .from("pixi_scores")
        .upsert({ room_id: roomId, username, score: nextScore }, { onConflict: "room_id,username" });
      if (error) {
        console.warn("[score-delta/upsert]", error.message);
      }
    });

    socket.on(ROOM_EVENTS.PuzzleCompleted, async (roomId: number) => {
      const room = roomStates.get(roomId);
      if (room && !room.isCompleted) {
        room.isCompleted = true;
        if (room.lastResumeTime) {
          room.accumulatedTime += (Date.now() - room.lastResumeTime) / 1000;
          room.lastResumeTime = null;
        }
        
        const finalTime = Math.floor(room.accumulatedTime);

        await supabase
          .from("pixi_rooms")
          .update({ 
            total_play_time_seconds: finalTime,
            status: "completed" 
          })
          .eq("id", roomId);
        await distributeCompletionRewards(roomId);
          
        // 완성 시 모든 유저에게 정지된 최종 시간 동기화
        const completedPayload: SyncTimePayload = {
          accumulatedTime: finalTime, 
          isRunning: false 
        };
        io.to(roomId.toString()).emit(ROOM_EVENTS.SyncTime, completedPayload);
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && roomStates.has(currentRoomId)) {
        releaseOwnedLocks(currentRoomId, socketUserId.get(socket.id) ?? "guest");
        const room = roomStates.get(currentRoomId)!;
        room.users.delete(socket.id);
        
        // 마지막 유저가 나갔다면 타이머 일시정지 및 DB 저장
        if (room.users.size === 0 && !room.isCompleted) {
          if (room.lastResumeTime) {
            room.accumulatedTime += (Date.now() - room.lastResumeTime) / 1000;
            room.lastResumeTime = null;
          }
          
          supabase
            .from("pixi_rooms")
            .update({ 
              total_play_time_seconds: Math.floor(room.accumulatedTime)
            })
            .eq("id", currentRoomId)
            .then(({ error }) => {
              if (error) console.error(`DB Update Error on disconnect:`, error);
            });
        }
      }
      socketOwnedPieceIds.delete(socket.id);
      socketUserId.delete(socket.id);
    });
  });

  // 30초 주기의 느린 타이머 루프 (DB 백업용, 네트워크 통신 없음)
  setInterval(() => {
    roomStates.forEach((room, roomId) => {
      // 진행 중인 방만 30초마다 DB에 안전하게 백업
      if (room.users.size > 0 && !room.isCompleted) {
        const currentPlayTime = Math.floor(getCurrentPlayTime(room));
        supabase
          .from("pixi_rooms")
          .update({ 
            total_play_time_seconds: currentPlayTime
          })
          .eq("id", roomId)
          .then(({ error }) => {
            if (error) console.error(`DB Backup Error for room ${roomId}:`, error);
          });
      }
    });
  }, 30000);

  // ==========================================
  // Vite Middleware (Frontend Serving)
  // ==========================================

  const webDistIndex = path.join(__dirname, "apps/web/dist/index.html");
  const useBuiltWeb =
    process.env.NODE_ENV === "production" && existsSync(webDistIndex);

  if (!useBuiltWeb) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[web] NODE_ENV=production but apps/web/dist/index.html is missing — falling back to Vite dev middleware. Run npm run build:web before serving static production assets."
      );
    }
    const vite = await createViteServer({
      configFile: path.join(__dirname, "apps/web/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "apps/web/dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT as number, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
