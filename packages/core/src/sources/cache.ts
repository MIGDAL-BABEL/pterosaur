import { credentialFingerprint } from './http.js'

/** 源内结构化数据缓存的寿命：对齐 server 路由层的 `CACHE_TTL.data`（见 ADR-042）。 */
export const DATA_CACHE_TTL_MS = 120 * 60_000

/** 带寿命与容量上限的进程内缓存（纯 ES，引擎可移植）。 */
export interface TtlCache<V> {
  get(key: string): V | undefined
  set(key: string, value: V): void
  delete(key: string): boolean
  clear(): void
  readonly size: number
}

/**
 * TTL + LRU 缓存，语义对齐此前在 Node 侧使用的 `lru-cache`：
 * 寿命自写入起算（命中不续命），到期即视为未命中；超过 `max` 条时淘汰最久未使用的一条。
 * `ttlMs <= 0` 表示不过期。
 */
export function createTtlCache<V>(max: number, ttlMs: number): TtlCache<V> {
  const map = new Map<string, { value: V; expiresAt: number }>()
  return {
    get(key) {
      const hit = map.get(key)
      if (!hit) return undefined
      if (hit.expiresAt > 0 && hit.expiresAt <= Date.now()) {
        map.delete(key)
        return undefined
      }
      // 重新插入即刷新 LRU 顺序（Map 按插入序迭代）
      map.delete(key)
      map.set(key, hit)
      return hit.value
    },
    set(key, value) {
      map.delete(key)
      map.set(key, {
        value,
        expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
      })
      if (map.size > max) {
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
      }
    },
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size
    },
  }
}

/**
 * 缓存键：`源|端点|参数…|凭证指纹`——**自动带凭证指纹**，杜绝手写键漏项（见 ADR-042）：
 * 不同账号对同一请求可能拿到不同结果，不能共用一条缓存。
 */
export function cacheKey(
  source: string,
  endpoint: string,
  params: readonly (string | number | boolean | undefined)[],
  credential?: string,
): string {
  return [
    source,
    endpoint,
    ...params.map((p) => (p === undefined ? '' : String(p))),
    credentialFingerprint(credential),
  ].join('|')
}
