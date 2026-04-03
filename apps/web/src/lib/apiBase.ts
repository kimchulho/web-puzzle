/** API origin without trailing slash. Empty = same origin (Vite dev + integrated server, or Toss proxy). */
export function getApiBase(): string {
  if (import.meta.env.DEV && import.meta.env.VITE_USE_REMOTE_API_IN_DEV !== "true") {
    return "";
  }
  const raw =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    "";
  if (typeof raw === "string" && raw.trim()) {
    return raw.replace(/\/$/, "");
  }
  return "";
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${p}` : p;
}
