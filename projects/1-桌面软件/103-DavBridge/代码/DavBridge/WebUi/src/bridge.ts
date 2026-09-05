import type { DavBridgeSnapshot } from './types'

type WebViewMessage = { data: unknown }
type WebViewApi = {
  postMessage: (value: unknown) => void
  addEventListener: (name: 'message', handler: (event: WebViewMessage) => void) => void
}
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void }

const webview = (window as unknown as { chrome?: { webview?: WebViewApi } }).chrome?.webview
const pending = new Map<string, Pending>()
const listeners = new Set<(snapshot: DavBridgeSnapshot) => void>()
let sequence = 0

if (webview) {
  webview.addEventListener('message', (event) => {
    const message = event.data as { id?: string; ok?: boolean; result?: unknown; error?: string; event?: string; payload?: unknown }
    if (message.id) {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.ok) item.resolve(message.result)
      else item.reject(new Error(message.error || 'DavBridge command failed'))
      return
    }
    if (message.event === 'snapshot') listeners.forEach(listener => listener(message.payload as DavBridgeSnapshot))
    if (message.event === 'navigate' && message.payload === 'overview') window.dispatchEvent(new CustomEvent('davbridge:navigate-overview'))
  })
}

export function hasNativeBridge() { return Boolean(webview) }
export function onSnapshot(listener: (snapshot: DavBridgeSnapshot) => void) { listeners.add(listener); return () => listeners.delete(listener) }
export async function invoke<T = unknown>(method: string, params?: unknown): Promise<T> {
  if (!webview) throw new Error('Native bridge is not available')
  const id = `db-${Date.now()}-${++sequence}`
  const promise = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
  webview.postMessage({ id, method, params })
  return promise as Promise<T>
}
