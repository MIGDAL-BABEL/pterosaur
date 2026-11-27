/**
 * 从内核的适配器注册表导出能力矩阵（`capabilities.json` 的生成逻辑）。
 *
 * 能力是**运行时事实**（适配器对象上有没有那个方法），不能手写——手写的那一份迟早
 * 与代码分叉，各端据它实现就会分叉。故由注册表推导，测试保证仓库里的 `capabilities.json`
 * 与当前代码一致。
 */
import { sources } from '@pterosaur/core'
import {
  CASSETTE_SOURCES,
  DEFAULT_SOURCE,
  MUSIC_SOURCES,
} from '@pterosaur/shared/types'
import type { SourceAdapter } from '@pterosaur/core'
import type { CapabilitiesFile } from './index.js'

/** `SourceAdapter` 的可选成员（与 `sources/types.ts` 的 `?` 成员一一对应）。 */
export const OPTIONAL_CAPABILITIES = [
  'audioQuality',
  'streamHeaders',
  'searchArtists',
  'searchAlbums',
  'searchPlaylists',
  'artistDetail',
  'playlistTracks',
  'songDetail',
  'parts',
  'recommendPlaylists',
  'toplists',
  'topPlaylists',
  'newSongs',
  'newAlbums',
  'hotSongs',
  'playlistCategories',
  'qrKey',
  'qrCreate',
  'qrCheck',
  'qrLoginUrl',
  'parseUserCookie',
  'userPlaylists',
] as const

export function buildCapabilities(): CapabilitiesFile {
  const out: Record<string, { core: true; optional: Record<string, boolean> }> =
    {}
  for (const [id, adapter] of Object.entries(sources)) {
    if (!adapter) continue
    const optional: Record<string, boolean> = {}
    for (const name of OPTIONAL_CAPABILITIES) {
      optional[name] =
        typeof (adapter as unknown as SourceAdapter & Record<string, unknown>)[
          name
        ] === 'function'
    }
    out[id] = { core: true, optional }
  }
  return {
    musicSources: MUSIC_SOURCES,
    cassetteSources: CASSETTE_SOURCES,
    defaultSource: DEFAULT_SOURCE,
    sources: out,
    enginePortable: true,
  }
}
