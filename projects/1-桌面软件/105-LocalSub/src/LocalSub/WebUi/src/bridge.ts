export type PageKey = "live" | "batch" | "models" | "settings" | "docs";

export interface LocalSubSnapshot {
  app: {
    productVersion: string;
    activePage: PageKey;
    busy: boolean;
    lastError: string | null;
  };
  core: {
    state: "stopped" | "starting" | "ready" | "busy" | "failed";
    pid: number | null;
    generation: number;
    currentOperation: string | null;
    lastError: string | null;
  };
  live: {
    state: "idle" | "starting" | "running" | "stopping" | "failed";
    source: string;
    modelName: string;
    level: number;
    status: string;
  };
  batch: {
    queued: number;
    state: string;
    status: string;
  };
  models: {
    catalogCount: number;
    installedCount: number;
    status: string;
  };
  settings: {
    audioSource: string;
    resourceProfile: string;
    subtitleAutoSize: boolean;
    subtitleFontSize: number;
  };
}

type BridgeResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: string | null;
};

const fallback: LocalSubSnapshot = {
  app: { productVersion: "0.1.1", activePage: "live", busy: false, lastError: null },
  core: { state: "ready", pid: 24816, generation: 2, currentOperation: null, lastError: null },
  live: {
    state: "idle",
    source: "PotPlayer",
    modelName: "Streaming Zipformer",
    level: 0.18,
    status: "实时链已迁入 LocalSub.Core，等待开始"
  },
  batch: { queued: 0, state: "idle", status: "拖入媒体后开始后台转写" },
  models: { catalogCount: 12, installedCount: 4, status: "模型目录可用" },
  settings: { audioSource: "PotPlayer", resourceProfile: "Auto", subtitleAutoSize: true, subtitleFontSize: 28 }
};

const previewPage = new URLSearchParams(window.location.search).get("page");
let fallbackPage: PageKey = previewPage === "docs" ? "docs" : "live";
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();

function hasNativeBridge(): boolean {
  return Boolean(window.chrome?.webview);
}

function nativeMessageHandler(event: MessageEvent) {
  const message = event.data as BridgeResponse<unknown>;
  if (!message || typeof message.id !== "string") return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.ok) request.resolve(message.result);
  else request.reject(new Error(message.error || "LocalSub bridge request failed"));
}

if (hasNativeBridge()) {
  window.chrome!.webview!.addEventListener("message", nativeMessageHandler);
}

export async function invoke<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!hasNativeBridge()) {
    if (method === "app.navigate" && typeof params.page === "string") fallbackPage = params.page as PageKey;
    if (method === "app.getSnapshot" || method === "app.navigate") {
      return {
        ...fallback,
        app: { ...fallback.app, activePage: fallbackPage }
      } as T;
    }
    throw new Error("Browser preview does not implement " + method);
  }

  const id = "web-" + Date.now() + "-" + ++sequence;
  const result = new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: value => resolve(value as T),
      reject
    });
  });
  window.chrome!.webview!.postMessage({ id, method, params });
  return result;
}

export function disposeBridge() {
  if (hasNativeBridge()) window.chrome!.webview!.removeEventListener("message", nativeMessageHandler);
  pending.clear();
}
