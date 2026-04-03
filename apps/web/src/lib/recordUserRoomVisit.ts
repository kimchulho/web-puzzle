import { apiUrl } from "./apiBase";

/** Records or refreshes last visit time for cross-device "이어하기" (logged-in users only). Uses server + service role. */
export async function recordUserRoomVisit(roomId: number): Promise<void> {
  if (roomId == null || !Number.isFinite(roomId) || roomId <= 0) return;
  if (typeof localStorage === "undefined") return;
  const token = localStorage.getItem("puzzle_access_token");
  if (!token) return;

  try {
    const res = await fetch(apiUrl("/api/user/room-visit"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ roomId }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { message?: string };
        if (j?.message) message = j.message;
      } catch {
        // ignore
      }
      console.warn("[recordUserRoomVisit]", message);
    }
  } catch (e) {
    console.warn("[recordUserRoomVisit]", e instanceof Error ? e.message : String(e));
  }
}
