export type GitChange = {
  path: string;
  status: string;
};

export type GitChangeSummary = {
  added: number;
  deleted: number;
  modified: number;
  renamed: number;
  untracked: number;
};

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
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}min`);
  parts.push(`${seconds}s`);
  return parts.join("");
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

export function summarizeGitChanges(changes: GitChange[]): GitChangeSummary {
  const summary: GitChangeSummary = {
    added: 0,
    deleted: 0,
    modified: 0,
    renamed: 0,
    untracked: 0,
  };

  for (const change of changes) {
    if (change.status === "??") {
      summary.untracked += 1;
      continue;
    }
    if (change.status.includes("R")) summary.renamed += 1;
    else if (change.status.includes("A")) summary.added += 1;
    else if (change.status.includes("D")) summary.deleted += 1;
    else if (change.status.includes("M")) summary.modified += 1;
  }

  return summary;
}

export function formatGitChangeSummary(changes: GitChange[]): string {
  if (changes.length === 0) return "clean";

  const summary = summarizeGitChanges(changes);
  const parts = (
    [
      [summary.modified, "modified"],
      [summary.added, "added"],
      [summary.deleted, "deleted"],
      [summary.renamed, "renamed"],
      [summary.untracked, "untracked"],
    ] satisfies Array<[number, string]>
  )
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);

  return parts.join(", ");
}

export function parseGitStatus(output: string): GitChange[] {
  const records = output.split("\0");
  const changes: GitChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;

    const status = record.slice(0, 2);
    const path = record.slice(3);
    changes.push({ path, status });

    if (status.includes("R") || status.includes("C")) index += 1;
  }

  return changes;
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
      return `Elapsed: ${formatDuration(now - this.startedAt)}`;
    }
    if (this.lastElapsedMs !== null) return `Last: ${formatDuration(this.lastElapsedMs)}`;
    return "ready";
  }
}
