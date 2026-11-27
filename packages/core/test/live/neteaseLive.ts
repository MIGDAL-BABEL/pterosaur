/**
 * 真实上游体检（手动运行，不进 CI）：`pnpm --filter @pterosaur/core check:live`
 *
 * 用内核自实现的网易云接口（weapi / eapi 签名）打真实上游，逐项检查归一化前的原始响应是否可用。
 * 只读、不登录、不带任何凭证——验证的是「签名能被上游接受」，与账号权限无关。
 *
 * 退出码非 0 表示有项失败；每项打印 `body.code`、耗时与关键字段。
 */
import { createHash } from 'node:crypto'
import { configureCore } from '../../src/ports.js'
import {
  album,
  albumNewest,
  artistAlbum,
  artists,
  cloudsearch,
  loginStatus,
  lyricNew,
  personalized,
  personalizedNewsong,
  playlistCatlist,
  playlistDetail,
  songDetail,
  songUrlV1,
  topPlaylist,
  toplist,
  userPlaylist,
} from '../../src/sources/neteaseApi.js'

// 宿主端口：Node 的 fetch + node:crypto（与 server 的 Node 宿主等价）；二维码 / 设备身份用不到
configureCore({
  http: {
    fetch: (url, init = {}) =>
      fetch(url, {
        method: init.method,
        body: init.body,
        headers: init.headers,
        ...(init.timeoutMs !== undefined
          ? { signal: AbortSignal.timeout(init.timeoutMs) }
          : {}),
      }) as never,
  },
  crypto: {
    sha1: (s) => createHash('sha1').update(s).digest('hex'),
    md5: (s) => createHash('md5').update(s).digest('hex'),
  },
  qrcode: { toDataUrl: async () => '' },
  neteaseDevice: {
    getCached: () => null,
    ensure: async () => ({ token: '', cookieHeader: '' }),
    invalidate: () => {},
    refresh: () => {},
  },
})

const HOT_PLAYLIST_ID = '3778678'

interface Step {
  name: string
  run: () => Promise<unknown>
  /** 从 body 取一个关键字段做展示。 */
  peek: (body: Record<string, unknown>) => string
}

const steps: Step[] = [
  {
    name: '搜索歌曲（cloudsearch, eapi）',
    run: () => cloudsearch({ keywords: '稻香', limit: 3 }),
    peek: (b) =>
      `songs=${(b.result as { songs?: unknown[] })?.songs?.length ?? 0} code=${b.code}`,
  },
  {
    name: '搜索歌手（cloudsearch type=100）',
    run: () => cloudsearch({ keywords: '周杰伦', type: 100, limit: 3 }),
    peek: (b) =>
      `artists=${(b.result as { artists?: unknown[] })?.artists?.length ?? 0}`,
  },
  {
    name: '推荐歌单（personalized, weapi）',
    run: () => personalized({ limit: 3 }),
    peek: (b) =>
      `result=${(b.result as unknown[])?.length ?? 0} code=${b.code}`,
  },
  {
    name: '全部榜单（toplist）',
    run: () => toplist({}),
    peek: (b) => `list=${(b.list as unknown[])?.length ?? 0}`,
  },
  {
    name: '热歌榜详情（playlist_detail）',
    run: () => playlistDetail({ id: HOT_PLAYLIST_ID, s: 8 }),
    peek: (b) =>
      `tracks=${(b.playlist as { tracks?: unknown[] })?.tracks?.length ?? 0}`,
  },
  {
    name: '分类歌单（top_playlist）',
    run: () => topPlaylist({ cat: '摇滚', limit: 3 }),
    peek: (b) => `playlists=${(b.playlists as unknown[])?.length ?? 0}`,
  },
  {
    name: '推荐新歌（personalized_newsong）',
    run: () => personalizedNewsong({ limit: 3 }),
    peek: (b) => `result=${(b.result as unknown[])?.length ?? 0}`,
  },
  {
    name: '歌单分类（playlist_catlist, eapi）',
    run: () => playlistCatlist({}),
    peek: (b) =>
      `categories=${Object.keys((b.categories as object) ?? {}).length}`,
  },
  {
    name: '最新专辑（album_newest）',
    run: () => albumNewest({}),
    peek: (b) => `albums=${(b.albums as unknown[])?.length ?? 0}`,
  },
  {
    name: '歌手详情（artists）',
    run: () => artists({ id: '6452' }),
    peek: (b) =>
      `name=${(b.artist as { name?: string })?.name} hotSongs=${(b.hotSongs as unknown[])?.length ?? 0}`,
  },
  {
    name: '歌手专辑（artist_album）',
    run: () => artistAlbum({ id: '6452', limit: 5, offset: 0 }),
    peek: (b) => `hotAlbums=${(b.hotAlbums as unknown[])?.length ?? 0}`,
  },
  {
    name: '专辑详情（album）',
    run: () => album({ id: '32311' }),
    peek: (b) =>
      `name=${(b.album as { name?: string })?.name} songs=${(b.songs as unknown[])?.length ?? 0}`,
  },
  {
    name: '歌词（lyric_new）',
    run: () => lyricNew({ id: '185809' }),
    peek: (b) =>
      `lrc=${(b.lrc as { lyric?: string })?.lyric?.slice(0, 20) ?? ''}`,
  },
  {
    name: '曲目详情（song_detail）',
    run: () => songDetail({ ids: ['185809'] }),
    peek: (b) => `songs=${(b.songs as unknown[])?.length ?? 0}`,
  },
  {
    name: '播放地址（song_url_v1, 匿名）',
    run: () => songUrlV1({ id: '185809', level: 'exhigh' }),
    peek: (b) => {
      const d = (b.data as { url?: string; br?: number }[])?.[0]
      return `url=${d?.url ? 'yes' : 'no'} br=${d?.br ?? '-'} code=${b.code}`
    },
  },
  {
    name: '登录态（login_status，未登录）',
    run: () => loginStatus({}),
    peek: (b) =>
      `code=${b.code} data.code=${(b.data as { code?: number })?.code}`,
  },
  {
    name: '用户歌单（user_playlist，未登录）',
    run: () => userPlaylist({ uid: '1' }),
    peek: (b) =>
      `code=${b.code} playlist=${(b.playlist as unknown[])?.length ?? 0}`,
  },
]

let failed = 0
for (const step of steps) {
  const t0 = Date.now()
  try {
    const res = (await step.run()) as { body: Record<string, unknown> }
    const ms = Date.now() - t0
    const ok = typeof res.body?.code === 'number' ? res.body.code === 200 : true
    if (!ok) failed++
    console.log(
      `${ok ? '✓' : '✗'} ${step.name}  ${ms}ms  ${step.peek(res.body ?? {})}`,
    )
  } catch (e) {
    failed++
    console.log(`✗ ${step.name}  ${Date.now() - t0}ms  ${(e as Error).message}`)
  }
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
