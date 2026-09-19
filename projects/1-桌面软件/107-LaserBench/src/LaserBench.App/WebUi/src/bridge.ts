import type { LaserSnapshot } from './types'

type Listener = (snapshot: LaserSnapshot) => void
interface Pending { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }

const listeners = new Set<Listener>()
const pending = new Map<string, Pending>()
let seq = 0

interface WebViewApi {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewApi }
  }
}

const webview = window.chrome?.webview

if (webview) {
  webview.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as any
    if (!message || typeof message !== 'object') return
    if (message.type === 'snapshot' && message.payload) {
      for (const listener of listeners) listener(message.payload as LaserSnapshot)
      return
    }
    if (message.type === 'reply' && typeof message.id === 'string') {
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.ok) item.resolve(message.result)
      else item.reject(new Error(message.error || 'LaserBench bridge request failed'))
    }
  })
}

export const hasNativeBridge = Boolean(webview)

export function onSnapshot(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function request<T = unknown>(method: string, params?: unknown): Promise<T> {
  if (!webview) return Promise.resolve(undefined as T)
  const id = `lb-${Date.now()}-${++seq}`
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: value => resolve(value as T), reject })
    webview.postMessage({ id, method, params: params ?? null })
    const timeoutMs = method === 'app.pickExperimentFolder' ? 10 * 60 * 1000 : 10000
    window.setTimeout(() => {
      const item = pending.get(id)
      if (!item) return
      pending.delete(id)
      item.reject(new Error(`Bridge timeout: ${method}`))
    }, timeoutMs)
  })
}
