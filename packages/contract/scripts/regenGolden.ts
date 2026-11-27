/**
 * 生成黄金样例（`golden/*.json`）：上游原始 JSON → 共享模型的归一化结果。
 *
 * 输入取自**录制的真实响应**（`recordings/netease.ndjson`）——归一化逻辑最怕的就是
 * 「对着一份手捏的样本调通、遇到真实响应就崩」。输出由参考实现（内核的 `normalize*`）产出。
 * 重新生成：`pnpm --filter @pterosaur/contract regen:golden`（须先 `record`）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
  normalizeTrack,
} from '@pterosaur/core/netease'
import {
  normalizeBilibiliTrack,
  decodeTitle,
  parseDuration,
  canonicalBiliImage,
} from '@pterosaur/core/bilibili'
import {
  contractPath,
  type GoldenCase,
  type GoldenFile,
  type Recording,
} from '../src/index.js'

const SCHEMA = 'pterosaur-golden@1'

function recordings(): Recording[] {
  return readFileSync(contractPath('recordings', 'netease.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Recording)
}

/** 响应体若被截断（`__clipped__`），还原成它携带的 JSON 前缀——归一化只需前半段字段。 */
function bodyOf(id: string): any {
  const rec = recordings().find((r) => r.id === id)
  if (!rec) throw new Error(`录制里没有 ${id}：先跑 record`)
  const body = rec.response.body as {
    __clipped__?: boolean
    json?: string
    [k: string]: unknown
  }
  if (!body.__clipped__) return rec.response.body
  // 截断的 JSON 无法整体解析：按顶层键逐个取「完整的第一个元素」——取 `result.songs[0]` 这类
  throw new Error(
    `${id} 的响应被截断，无法作为黄金样例输入；请把 BODY_CLIP 调大后重录`,
  )
}

const cases: GoldenCase[] = []

function add(
  id: string,
  fn: string,
  input: unknown,
  expected: unknown,
  source: string,
): void {
  cases.push({ id, fn, input, expected, source })
}

{
  const songs = bodyOf('cloudsearch-songs').result?.songs ?? []
  songs.forEach((s: unknown, i: number) =>
    add(
      `cloudsearch.song.${i}`,
      'netease.normalizeTrack',
      s,
      normalizeTrack(s as never),
      '录制：cloudsearch 前 3 首',
    ),
  )
  songs.forEach((s: unknown, i: number) => {
    if (s && typeof s === 'object' && 'ar' in s) {
      add(
        `cloudsearch.artist.${i}`,
        'netease.normalizeArtist',
        (s as { ar: unknown[] }).ar[0],
        normalizeArtist((s as { ar: never[] }).ar[0]),
        '录制：cloudsearch 歌曲的首位艺人',
      )
    }
  })
}

{
  const newest = bodyOf('album-newest').albums ?? []
  newest
    .slice(0, 2)
    .forEach((a: unknown, i: number) =>
      add(
        `albumNewest.album.${i}`,
        'netease.normalizeAlbum',
        a,
        normalizeAlbum(a as never),
        '录制：最新专辑',
      ),
    )
}

{
  const artists = bodyOf('artists').artist
  if (artists)
    add(
      'artists.artist',
      'netease.normalizeArtist',
      artists,
      normalizeArtist(artists),
      '录制：歌手详情',
    )
}

{
  const album = bodyOf('album').album
  if (album)
    add(
      'album.album',
      'netease.normalizeAlbum',
      album,
      normalizeAlbum(album),
      '录制：专辑详情',
    )
}

{
  const playlists = bodyOf('personalized').result ?? []
  playlists
    .slice(0, 2)
    .forEach((p: unknown, i: number) =>
      add(
        `personalized.playlist.${i}`,
        'netease.normalizePlaylist',
        p,
        normalizePlaylist(p as never),
        '录制：推荐歌单',
      ),
    )
}

// B 站：标题 / 时长 / 封面规范化（不依赖上游记录，纯格式）
for (const [i, [title, duration, pic]] of (
  [
    [
      '<em class="keyword">周杰伦</em> 稻香 &amp; 晴天',
      '12:34',
      '//i2.hdslb.com/bfs/a.jpg',
    ],
    ['1:02:03', '1:02:03', 'http://i0.hdslb.com/bfs/b.jpg'],
  ] as const
).entries()) {
  add(
    `bilibili.decodeTitle.${i}`,
    'bilibili.decodeTitle',
    title,
    decodeTitle(title),
    '格式样本',
  )
  add(
    `bilibili.parseDuration.${i}`,
    'bilibili.parseDuration',
    duration,
    parseDuration(duration),
    '格式样本',
  )
  add(
    `bilibili.canonicalImage.${i}`,
    'bilibili.canonicalImage',
    pic,
    canonicalBiliImage(pic),
    '格式样本',
  )
}
add(
  'bilibili.normalizeTrack.0',
  'bilibili.normalizeTrack',
  {
    bvid: 'BV1xx411c7mD',
    title: '测试 &amp; 标题',
    pic: '//i1.hdslb.com/bfs/x.jpg',
    duration: '04:05',
    author: 'UP 主',
  },
  normalizeBilibiliTrack({
    bvid: 'BV1xx411c7mD',
    title: '测试 &amp; 标题',
    pic: '//i1.hdslb.com/bfs/x.jpg',
    duration: '04:05',
    author: 'UP 主',
  }),
  '格式样本',
)

const out: GoldenFile = { schema: SCHEMA, cases }
writeFileSync(
  contractPath('golden', 'normalize.json'),
  JSON.stringify(out, null, 2) + '\n',
)
console.log(`golden/normalize.json: ${cases.length} 条`)
