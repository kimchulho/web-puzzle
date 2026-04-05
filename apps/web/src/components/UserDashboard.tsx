import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  Filter,
  Grid,
  Image as ImageIcon,
  Loader2,
  Lock,
  Share2,
  Trophy,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { apiUrl } from "../lib/apiBase";
import {
  normalizePuzzleDifficulty,
  puzzleDifficultyLabel,
  type PuzzleDifficulty,
} from "../lib/puzzleDifficulty";

type DashboardUser = {
  id?: number;
  username: string;
  role?: string;
  completed_puzzles?: number;
  placed_pieces?: number;
  profile_public?: boolean;
};

type RoomRow = {
  roomId: number;
  roomCode: string;
  imageUrl: string | null;
  difficulty: string | null;
  status: string | null;
  pieceCount: number;
  totalPieces?: number;
  lockedPieces?: number;
  progressPercent?: number;
  isCompleted?: boolean;
  completedAt?: string | null;
  creatorName?: string | null;
  lastVisitedAt?: string | null;
  scoreInRoom?: number;
  iAmCreator?: boolean;
  imageHiddenReason?: string | null;
};

type UploadRow = {
  roomId: number;
  roomCode: string;
  imageUrl: string | null;
  difficulty: string | null;
  status: string | null;
  pieceCount: number;
  createdAt?: string | null;
  completedAt?: string | null;
};

export default function UserDashboard({
  mode,
  publicUsername,
  onBack,
  onJoinRoom,
  locale,
  user,
  setUser,
}: {
  mode: "self" | "public";
  publicUsername?: string;
  onBack: () => void;
  onJoinRoom: (roomId: number, imageUrl: string, pieceCount: number, difficulty: PuzzleDifficulty) => void;
  locale: "ko" | "en";
  user?: DashboardUser | null;
  setUser?: (u: DashboardUser) => void;
}) {
  const isKo = locale === "ko";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashUser, setDashUser] = useState<DashboardUser | null>(null);
  const [participated, setParticipated] = useState<RoomRow[]>([]);
  const [myUploads, setMyUploads] = useState<UploadRow[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  /** 참여 목록에서 내가 만든 방 제외 */
  const [hideRoomsICreated, setHideRoomsICreated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "self") {
        const token = localStorage.getItem("puzzle_access_token");
        if (!token) {
          setError(isKo ? "로그인이 필요합니다." : "Please sign in.");
          setLoading(false);
          return;
        }
        const res = await fetch(apiUrl("/api/user/dashboard"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = (await res.json().catch(() => ({}))) as {
          message?: string;
          user?: DashboardUser;
          participatedRooms?: RoomRow[];
          myUploads?: UploadRow[];
        };
        if (!res.ok) {
          setError(j?.message || `HTTP ${res.status}`);
          setLoading(false);
          return;
        }
        setDashUser(j.user ?? null);
        setParticipated(Array.isArray(j.participatedRooms) ? j.participatedRooms : []);
        setMyUploads(Array.isArray(j.myUploads) ? j.myUploads : []);
      } else {
        const u = (publicUsername ?? "").trim().toLowerCase();
        if (!u) {
          setError(isKo ? "사용자를 찾을 수 없습니다." : "User not found.");
          setLoading(false);
          return;
        }
        const res = await fetch(apiUrl(`/api/profile/${encodeURIComponent(u)}`));
        const j = (await res.json().catch(() => ({}))) as {
          message?: string;
          user?: { username: string; completed_puzzles?: number; placed_pieces?: number };
          participatedRooms?: RoomRow[];
        };
        if (!res.ok) {
          setError(j?.message || (isKo ? "비공개이거나 없는 프로필입니다." : "Profile is private or not found."));
          setLoading(false);
          return;
        }
        setDashUser(
          j.user
            ? {
                username: j.user.username,
                completed_puzzles: j.user.completed_puzzles,
                placed_pieces: j.user.placed_pieces,
              }
            : null
        );
        setParticipated(Array.isArray(j.participatedRooms) ? j.participatedRooms : []);
        setMyUploads([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mode, publicUsername, isKo]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleProfilePublic = async (next: boolean) => {
    const token = localStorage.getItem("puzzle_access_token");
    if (!token) return;
    setProfileSaving(true);
    try {
      const res = await fetch(apiUrl("/api/user/profile"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ profilePublic: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { user?: DashboardUser; message?: string };
      if (!res.ok || !j.user) {
        setError(j?.message || `HTTP ${res.status}`);
        return;
      }
      setDashUser(j.user);
      if (setUser && user) {
        const merged = { ...user, ...j.user };
        localStorage.setItem("puzzle_user", JSON.stringify(merged));
        setUser(merged);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const enterRoom = async (roomId: number) => {
    const { data, error: qErr } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
    if (qErr || !data) {
      setError(isKo ? "방 정보를 불러올 수 없습니다." : "Could not load room.");
      return;
    }
    onJoinRoom(
      data.id,
      data.image_url,
      data.piece_count,
      normalizePuzzleDifficulty((data as { difficulty?: string }).difficulty)
    );
  };

  const copyProfileLink = () => {
    const un = dashUser?.username ?? publicUsername ?? "";
    if (!un) return;
    const url = `${window.location.origin}/u/${encodeURIComponent(un)}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    });
  };

  const title =
    mode === "self"
      ? isKo
        ? "내 대시보드"
        : "My dashboard"
      : isKo
        ? `${dashUser?.username ?? publicUsername ?? ""}님의 프로필`
        : `${dashUser?.username ?? publicUsername ?? ""}'s profile`;

  const participatedFiltered = hideRoomsICreated
    ? participated.filter((r) => !r.iAmCreator)
    : participated;
  const hasMyCreatedInParticipated = participated.some((r) => r.iAmCreator);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"
            aria-label={isKo ? "뒤로" : "Back"}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-white">{title}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-16 text-slate-400">
            <Loader2 className="h-10 w-10 animate-spin" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-6 text-center text-rose-200">
            {error}
            {mode === "self" && error.includes("로그인") ? (
              <p className="mt-3 text-sm text-slate-400">{isKo ? "로비에서 로그인해 주세요." : "Sign in from the lobby."}</p>
            ) : null}
          </div>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="mb-1 flex items-center gap-2 text-slate-400">
                  <Trophy size={18} className="text-amber-400" />
                  <span className="text-sm">{isKo ? "완성한 퍼즐" : "Completed puzzles"}</span>
                </div>
                <p className="text-3xl font-bold text-white">{dashUser?.completed_puzzles ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                <div className="mb-1 flex items-center gap-2 text-slate-400">
                  <Grid size={18} className="text-indigo-400" />
                  <span className="text-sm">{isKo ? "맞춘 조각(누적)" : "Pieces placed (total)"}</span>
                </div>
                <p className="text-3xl font-bold text-white">{dashUser?.placed_pieces ?? 0}</p>
              </div>
            </section>

            {mode === "self" ? (
              <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Users className="mt-0.5 h-5 w-5 shrink-0 text-indigo-400" />
                    <div>
                      <p className="font-semibold text-white">{isKo ? "프로필 공개" : "Public profile"}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {isKo
                          ? "기본은 공개입니다. 체크를 해제하면 비공개로 전환됩니다. 공개 시 /u/아이디 에 통계·참여 방이 보이며, 직접 업로드한 퍼즐 이미지는 항상 비공개입니다."
                          : "Public by default; uncheck to make your profile private. When public, stats and joined rooms appear at /u/username; images you uploaded as room photos stay private."}
                      </p>
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 self-start sm:self-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500"
                      checked={dashUser?.profile_public !== false}
                      disabled={profileSaving}
                      onChange={(e) => void toggleProfilePublic(e.target.checked)}
                    />
                    <span className="text-sm text-slate-300">
                      {isKo ? "프로필 공개" : "Profile public"}
                    </span>
                  </label>
                </div>
                {dashUser?.profile_public !== false ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
                    <button
                      type="button"
                      onClick={copyProfileLink}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
                    >
                      {copyOk ? (
                        isKo ? "복사됨" : "Copied"
                      ) : (
                        <>
                          <Copy size={16} />
                          {isKo ? "프로필 링크 복사" : "Copy profile link"}
                        </>
                      )}
                    </button>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Share2 size={14} />
                      {`${window.location.origin}/u/${dashUser.username}`}
                    </span>
                  </div>
                ) : null}
              </section>
            ) : null}

            {mode === "self" && myUploads.length > 0 ? (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-white">
                  <ImageIcon size={20} className="text-sky-400" />
                  {isKo ? "직접 업로드한 사진(방)" : "Rooms from my uploads"}
                </h2>
                <p className="mb-3 text-sm text-slate-400">
                  {isKo
                    ? "퍼즐록스에서 제공한 이미지로 만든 방은 제외됩니다. 썸네일은 본인만 볼 수 있어요."
                    : "Rooms created from the built-in image catalog are not listed here. Only you see these thumbnails."}
                </p>
                <ul className="space-y-3">
                  {myUploads.map((r) => (
                    <li
                      key={r.roomId}
                      className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-slate-500">
                            <ImageIcon size={28} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm text-sky-300">#{r.roomCode}</p>
                        <p className="text-xs text-slate-400">
                          {puzzleDifficultyLabel(normalizePuzzleDifficulty(r.difficulty), isKo)} · {r.pieceCount}{" "}
                          {isKo ? "조각" : "pcs"}
                          {r.status ? (
                            <span>
                              {" "}
                              · {r.status}
                            </span>
                          ) : null}
                        </p>
                        {r.createdAt ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {isKo ? "만든 날" : "Created"}: {new Date(r.createdAt).toLocaleString()}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void enterRoom(r.roomId)}
                          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          {isKo ? "입장" : "Enter"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="flex items-center gap-2 text-base font-bold text-white">
                  <Users size={20} className="text-emerald-400" />
                  {isKo ? "참여한 퍼즐방" : "Puzzle rooms joined"}
                </h2>
                {participated.length > 0 && hasMyCreatedInParticipated ? (
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                    <Filter size={16} className="shrink-0 text-slate-500" />
                    <span className="select-none">
                      {isKo ? "내가 만든 방 숨기기" : "Hide rooms I created"}
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                      checked={hideRoomsICreated}
                      onChange={(e) => setHideRoomsICreated(e.target.checked)}
                    />
                  </label>
                ) : null}
              </div>
              {participated.length === 0 ? (
                <p className="text-sm text-slate-500">{isKo ? "아직 기록이 없습니다." : "No history yet."}</p>
              ) : participatedFiltered.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {isKo ? "필터 조건에 맞는 방이 없습니다." : "No rooms match this filter."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {participatedFiltered.map((r) => {
                    const displayTotal =
                      typeof r.totalPieces === "number" && r.totalPieces > 0
                        ? r.totalPieces
                        : Math.max(0, r.pieceCount);
                    const displayLocked = Math.max(0, r.lockedPieces ?? 0);
                    const pctRaw =
                      typeof r.progressPercent === "number"
                        ? r.progressPercent
                        : displayTotal > 0
                          ? Math.min(100, Math.round((displayLocked / displayTotal) * 100))
                          : 0;
                    const done =
                      r.isCompleted === true ||
                      r.status === "completed" ||
                      (displayTotal > 0 && displayLocked >= displayTotal);
                    const barPct = done ? 100 : pctRaw;
                    return (
                    <li
                      key={r.roomId}
                      className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-3"
                    >
                      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                        {r.imageUrl ? (
                          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] text-slate-500">
                            <Lock size={16} />
                            {isKo ? "이미지 비공개" : "Image private"}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <p className="font-mono text-sm text-indigo-300">#{r.roomCode}</p>
                          {r.iAmCreator ? (
                            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                              {isKo ? "내 방" : "Mine"}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-slate-400">
                          {puzzleDifficultyLabel(normalizePuzzleDifficulty(r.difficulty), isKo)} · {r.pieceCount}{" "}
                          {isKo ? "조각" : "pcs"}
                          {typeof r.scoreInRoom === "number" && r.scoreInRoom > 0 ? (
                            <span>
                              {" "}
                              · {isKo ? "이 방 점수" : "Score"} {r.scoreInRoom}
                            </span>
                          ) : null}
                        </p>
                        {displayTotal > 0 ? (
                          <div className="mt-2 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                              <span>
                                {isKo ? "진행" : "Progress"}: {displayLocked}/{displayTotal}{" "}
                                {isKo ? "조각" : "pcs"}
                                <span className="text-slate-500">
                                  {" "}
                                  ({done ? 100 : pctRaw}%)
                                </span>
                              </span>
                              {done ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-300">
                                  <CheckCircle size={12} className="shrink-0" aria-hidden />
                                  {isKo ? "완료" : "Done"}
                                </span>
                              ) : null}
                            </div>
                            <div
                              className="h-1.5 overflow-hidden rounded-full bg-slate-800"
                              role="progressbar"
                              aria-valuenow={done ? displayTotal : displayLocked}
                              aria-valuemin={0}
                              aria-valuemax={displayTotal}
                              aria-label={isKo ? "퍼즐 진행도" : "Puzzle progress"}
                            >
                              <div
                                className={`h-full rounded-full transition-[width] ${
                                  done ? "bg-emerald-500" : "bg-indigo-500/80"
                                }`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {r.lastVisitedAt ? (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {isKo ? "최근 방문" : "Last visit"}: {new Date(r.lastVisitedAt).toLocaleString()}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void enterRoom(r.roomId)}
                          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                        >
                          {isKo ? "입장" : "Enter"}
                        </button>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
