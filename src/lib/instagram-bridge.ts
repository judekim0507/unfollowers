export interface InstagramUserNode {
  readonly id: string;
  readonly username: string;
  readonly full_name: string;
  readonly profile_pic_url: string;
  readonly is_private: boolean;
  readonly is_verified: boolean;
  readonly followed_by_viewer: boolean;
  readonly follows_viewer: boolean;
  readonly requested_by_viewer: boolean;
}

export interface InstagramFollowingPage {
  readonly count: number;
  readonly page_info: {
    readonly has_next_page: boolean;
    readonly end_cursor: string | null;
  };
  readonly edges: readonly {
    readonly node: InstagramUserNode;
  }[];
}

export interface AppUser {
  readonly id: string;
  readonly handle: string;
  readonly name: string;
  readonly avatar: string;
  readonly status: "unfollowed" | "follows-you";
  readonly isWhitelisted: boolean;
  readonly isVerified: boolean;
  readonly isPrivate: boolean;
  readonly followsViewer: boolean;
}

type ChromeRuntime = {
  readonly lastError?: { readonly message?: string };
  sendMessage(
    message: unknown,
    callback: (response?: InstagramBridgeResponse<unknown>) => void,
  ): void;
};

declare const chrome:
  | {
      readonly runtime?: ChromeRuntime;
    }
  | undefined;

export type InstagramBridgeResponse<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export interface TimingsConfig {
  readonly searchCycleTime: number;
  readonly searchCycleWait: number;
  readonly unfollowTime: number;
  readonly unfollowWait: number;
}

const WHITELIST_STORAGE_KEY = "iu_whitelisted-results";
const TIMINGS_STORAGE_KEY = "iu_timings";

const isBridgeAvailable = () =>
  typeof chrome !== "undefined" && chrome.runtime !== undefined;

let parentMessageId = 0;
const pendingParentMessages = new Map<
  number,
  {
    resolve(value: unknown): void;
    reject(reason?: unknown): void;
  }
>();

if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) {
      return;
    }

    const data = event.data as
      | {
          readonly source?: string;
          readonly id?: number;
          readonly response?: InstagramBridgeResponse<unknown>;
        }
      | undefined;

    if (
      data?.source !== "unfollowers-shell" ||
      typeof data.id !== "number" ||
      data.response === undefined
    ) {
      return;
    }

    const pending = pendingParentMessages.get(data.id);
    if (pending === undefined) {
      return;
    }

    pendingParentMessages.delete(data.id);

    if (data.response.ok) {
      pending.resolve(data.response.data);
      return;
    }

    pending.reject(new Error(data.response.error));
  });
}

export function getInstagramTabId(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  const tabId = new URLSearchParams(window.location.search).get("tabId");
  if (tabId === null) {
    return null;
  }

  const parsed = Number(tabId);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function fetchFollowingPage(
  tabId: number,
  after?: string | null,
): Promise<InstagramFollowingPage> {
  return sendInstagramMessage<InstagramFollowingPage>({
    type: "IG_FETCH_FOLLOWING",
    tabId,
    after,
  });
}

export async function unfollowInstagramUser(
  tabId: number,
  userId: string,
  username: string,
): Promise<{ readonly status: number }> {
  return sendInstagramMessage<{ readonly status: number }>({
    type: "IG_UNFOLLOW_USER",
    tabId,
    userId,
    username,
  });
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await sendInstagramMessage<void>({
      type: "OPEN_URL",
      url,
    });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await sendInstagramMessage<void>({
      type: "COPY_TEXT",
      text,
    });
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export async function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<void> {
  try {
    await sendInstagramMessage<void>({
      type: "DOWNLOAD_TEXT",
      filename,
      content,
      mimeType,
    });
  } catch {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export async function loadStoredWhitelistedUsers(): Promise<readonly AppUser[]> {
  try {
    const users = await sendInstagramMessage<unknown>({
      type: "GET_WHITELIST",
    });
    return parseWhitelistedUsers(users);
  } catch {
    return loadWhitelistedUsers();
  }
}

export async function saveStoredWhitelistedUsers(
  users: readonly AppUser[],
): Promise<void> {
  saveWhitelistedUsers(users);

  try {
    await sendInstagramMessage<void>({
      type: "SAVE_WHITELIST",
      users,
    });
  } catch {
    // localStorage fallback above is best effort outside the extension bridge.
  }
}

function sendInstagramMessage<T>(message: unknown): Promise<T> {
  const runtime = typeof chrome === "undefined" ? undefined : chrome.runtime;

  if (!isBridgeAvailable() || runtime === undefined) {
    return sendParentMessage<T>(message);
  }

  return new Promise((resolve, reject) => {
    runtime.sendMessage(message, (response) => {
      const runtimeError = runtime.lastError;
      if (runtimeError !== undefined) {
        reject(new Error(runtimeError.message ?? "Chrome runtime error"));
        return;
      }

      if (response === undefined) {
        reject(new Error("No response from extension background worker"));
        return;
      }

      if (response.ok) {
        resolve(response.data as T);
        return;
      }

      reject(new Error(response.error));
    });
  });
}

function sendParentMessage<T>(message: unknown): Promise<T> {
  if (typeof window === "undefined" || window.parent === window) {
    return Promise.reject(
      new Error("Open this page from the Unfollowers Chrome extension."),
    );
  }

  const id = parentMessageId;
  parentMessageId += 1;

  return new Promise((resolve, reject) => {
    pendingParentMessages.set(id, { resolve, reject });
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { readonly type?: unknown }).type === "COPY_TEXT"
    ) {
      window.parent.postMessage(
        {
          source: "unfollowers-copy",
          id,
          text: (message as { readonly text?: unknown }).text,
        },
        "*",
      );
      return;
    }

    window.parent.postMessage(
      {
        source: "unfollowers-ui",
        id,
        message,
      },
      "*",
    );
  });
}

export function toAppUser(
  user: InstagramUserNode,
  whitelistedIds: ReadonlySet<string>,
): AppUser {
  return {
    id: user.id,
    handle: user.username,
    name: user.full_name,
    avatar: user.profile_pic_url,
    status: user.follows_viewer ? "follows-you" : "unfollowed",
    isWhitelisted: whitelistedIds.has(user.id),
    isVerified: user.is_verified,
    isPrivate: user.is_private,
    followsViewer: user.follows_viewer,
  };
}

export function loadWhitelistedUsers(): readonly AppUser[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(WHITELIST_STORAGE_KEY);
    if (raw === null) {
      return [];
    }

    return parseWhitelistedUsers(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function parseWhitelistedUsers(value: unknown): readonly AppUser[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((user) => {
    if (typeof user !== "object" || user === null) {
      return [];
    }

    const record = user as Record<string, unknown>;
    const id = record.id;
    const handle = record.handle ?? record.username;

    if (typeof id !== "string" || typeof handle !== "string") {
      return [];
    }

    return [
      {
        id,
        handle,
        name:
          typeof record.name === "string"
            ? record.name
            : typeof record.full_name === "string"
              ? record.full_name
              : "",
        avatar:
          typeof record.avatar === "string"
            ? record.avatar
            : typeof record.profile_pic_url === "string"
              ? record.profile_pic_url
              : "",
        status: "unfollowed" as const,
        isWhitelisted: true,
        isVerified:
          typeof record.isVerified === "boolean"
            ? record.isVerified
            : record.is_verified === true,
        isPrivate:
          typeof record.isPrivate === "boolean"
            ? record.isPrivate
            : record.is_private === true,
        followsViewer:
          typeof record.followsViewer === "boolean"
            ? record.followsViewer
            : record.follows_viewer === true,
      },
    ];
  });
}

export function saveWhitelistedUsers(users: readonly AppUser[]): void {
  try {
    localStorage.setItem(WHITELIST_STORAGE_KEY, JSON.stringify(users));
  } catch {
    // Sandboxed extension pages can deny localStorage. The in-memory UI state
    // still updates; persistence is best-effort in that environment.
  }
}

export function loadTimingsConfig(): TimingsConfig | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(TIMINGS_STORAGE_KEY);
    if (raw === null) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<TimingsConfig>;
    if (
      typeof parsed.searchCycleTime !== "number" ||
      typeof parsed.searchCycleWait !== "number" ||
      typeof parsed.unfollowTime !== "number" ||
      typeof parsed.unfollowWait !== "number"
    ) {
      return null;
    }

    return parsed as TimingsConfig;
  } catch {
    return null;
  }
}

export function saveTimingsConfig(config: TimingsConfig): void {
  try {
    localStorage.setItem(TIMINGS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // See saveWhitelistedUsers.
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
