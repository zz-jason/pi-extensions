export type ProxyLabel = {
  enabled: boolean;
  text: string;
};

export function formatNumber(count: number): string {
  if (count < 1_000) return count.toString();
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const twoDigits = (value: number) => value.toString().padStart(2, "0");

  if (hours > 0) return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  return `${minutes}:${twoDigits(seconds)}`;
}

export function compactPath(
  cwd: string,
  home = process.env.HOME || process.env.USERPROFILE,
): string {
  if (!home) return cwd;

  const normalizedHome = home.replace(/\/$/, "");
  if (cwd === normalizedHome) return "~";
  if (cwd.startsWith(`${normalizedHome}/`)) return `~${cwd.slice(normalizedHome.length)}`;
  return cwd;
}

export function getProxyLabel(env: NodeJS.ProcessEnv = process.env): ProxyLabel {
  const names = [
    ["ALL", env.ALL_PROXY || env.all_proxy],
    ["HTTPS", env.HTTPS_PROXY || env.https_proxy],
    ["HTTP", env.HTTP_PROXY || env.http_proxy],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name]) => name);

  if (names.length === 0) return { enabled: false, text: "proxy:off" };
  return { enabled: true, text: `proxy:on(${names.join("+")})` };
}

export class TaskTimer {
  private running = false;
  private startedAt: number | null = null;
  private lastElapsedMs: number | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  start(now = Date.now()): void {
    if (this.running) return;

    this.running = true;
    this.startedAt = now;
    this.lastElapsedMs = null;
  }

  stop(now = Date.now()): void {
    if (!this.running || this.startedAt === null) return;

    this.lastElapsedMs = Math.max(0, now - this.startedAt);
    this.running = false;
    this.startedAt = null;
  }

  getLabel(now = Date.now()): string {
    if (this.running && this.startedAt !== null) {
      return `run:${formatDuration(now - this.startedAt)}`;
    }
    if (this.lastElapsedMs !== null) return `last:${formatDuration(this.lastElapsedMs)}`;
    return "ready";
  }
}
