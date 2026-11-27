/**
 * 网易云接口客户端（内核自实现，替代 `NeteaseCloudMusicApi`，见 ADR-065）。
 *
 * 只覆盖本应用用到的 16 个接口。每个接口的请求参数逐项对照库 4.32.0 的 `module/*.js` 迁来：
 * 上游对这些字段的顺序不敏感、但对**取值**敏感（例如 `total: true`、`n: 100000`），
 * 迁移时原样保留，确保行为与抽离前一致。
 *
 * 加密方式按库的缺省选择：`APP_CONF.encrypt = true` 时缺省的接口走 **eapi**（客户端域名
 * `interface.music.163.com`），显式 `createOption(query, 'weapi')` 的走 **weapi**（`music.163.com`）。
 *
 * 请求头的 cookie 按库的 `processCookieObject` / `createHeaderCookie` 构造（见 {@link requestHeaders}）：
 * 网页端 eapi 需要一套固定的设备字段；匿名请求用 `MUSIC_A`（匿名 token）替身，
 * 来自宿主端口提供的匿名凭证——没有它，网易云对部分接口返回更少的结果或拒绝。
 */
import { corePorts, type HttpResponse } from '../ports.js'
import { encodeForm } from '@pterosaur/shared/url'
import { eapiDecrypt, eapiEncrypt, weapiEncrypt } from './neteaseSign.js'
import { base64, md5, utf8 } from '../services/crypto.js'

/**
 * 随机源：weapi 的会话密钥与 RSA 填充、请求头里的 requestId / deviceId 都用它。
 * 取值为 [0, 1)，与 `Math.random` 同口径；单测可经 {@link setRandom} 换成固定序列。
 */
let random: () => number = Math.random

/** 替换随机源（仅测试使用；`null` 还原为 `Math.random`）。 */
export function setRandom(fn: (() => number) | null): void {
  random = fn ?? Math.random
}

/** 接口域名（库的 `util/config.json`）：缺省 eapi 打 apiDomain，weapi 打 domain。 */
const DOMAIN = 'https://music.163.com'
const API_DOMAIN = 'https://interface.music.163.com'

/** weapi 的 UA（库 `userAgentMap.weapi.pc`）。 */
const WEAPI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
/** eapi 的 UA（库 `userAgentMap.api.iphone`）。 */
const EAPI_UA = 'NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)'

/** 库把 `e_r`（响应加密）按配置塞进每个请求体；`encryptResponse: false` 时恒为 `false`。 */
const ENCRYPT_RESPONSE = false

export type Crypto = 'weapi' | 'eapi'

/** 接口响应：`body` 为解析后的上游 JSON（保留 `any` 以便调用处收敛）。 */
export interface NcmResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  cookie: string[]
}

/** 解析 cookie 串为键值对（库 `cookieToJson`：只认恰好一个 `=` 的片段）。 */
function cookieToObject(cookie: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const value = part.slice(eq + 1)
    if (value.includes('=')) continue
    out[part.slice(0, eq).trim()] = value.trim()
  }
  return out
}

/** 一次性生成的模块级设备字段（库在模块求值时算一次 `WNMCID`）。 */
const WNMCID = (() => {
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 6; i++) s += letters.charAt(Math.floor(random() * 26))
  return `${s}.${Date.now()}.01.0`
})()

/** 匿名 token（`MUSIC_A`）：库在启动时调用匿名注册接口获取；内核经宿主端口注入。 */
let anonymousToken: () => string = () => ''
/** 设置匿名 token 的来源（宿主启动后注入：同步读缓存即可，取不到返回空串）。 */
export function setAnonymousTokenProvider(provider: () => string): void {
  anonymousToken = provider
}

/**
 * 构造请求 cookie 与请求头（对齐库的 `processCookieObject` + `createHeaderCookie`）。
 *
 * 网页端 eapi 的 cookie **不发送用户原始的 `MUSIC_U` 之外的字段**，而是由一组固定设备字段组成：
 * `osver` / `deviceId` / `os` / `appver` / `versioncode` / `buildver` / `resolution` / `__csrf` /
 * `channel` / `requestId`，外加 `MUSIC_U`（登录时）与 `MUSIC_A`（始终）。
 */
function requestCookie(callerCookie: string | undefined): {
  header: Record<string, string>
  cookieObject: Record<string, string>
  cookieHeader: string
} {
  const cookies = callerCookie ? cookieToObject(callerCookie) : {}
  const hasUser = Boolean(cookies.MUSIC_U)
  const header: Record<string, string> = {
    osver:
      cookies.osver ?? 'Microsoft-Windows-10-Professional-build-19045-64bit',
    deviceId: cookies.deviceId ?? 'undefined',
    os: cookies.os ?? 'pc',
    appver: cookies.appver ?? '3.1.17.204416',
    versioncode: cookies.versioncode ?? '140',
    mobilename: cookies.mobilename ?? '',
    buildver: cookies.buildver ?? String(Date.now()).slice(0, 10),
    resolution: cookies.resolution ?? '1920x1080',
    __csrf: cookies.__csrf ?? '',
    channel: cookies.channel ?? 'netease',
    requestId: `${Date.now()}_${String(Math.floor(random() * 1000)).padStart(4, '0')}`,
  }
  if (hasUser) header.MUSIC_U = cookies.MUSIC_U!
  // 已登录时若也带了 MUSIC_A，一并透传；匿名时用匿名 token 兜底
  if (cookies.MUSIC_A) header.MUSIC_A = cookies.MUSIC_A
  else if (!hasUser) header.MUSIC_A = anonymousToken() || ''
  if (!header.MUSIC_A) delete header.MUSIC_A

  // 与库的 `processCookieObject` 对齐：除 header 字段外，**Cookie 头**还带一组设备与统计字段。
  // 匿名请求缺少 `_ntes_nnid` / `NMTID` 时，上游对部分接口（歌手、专辑等）返回空体，
  // 对取流则回 `-460`（网络环境风险）。
  const nuid = cookies._ntes_nuid ?? randomHex(32)
  const cookieObject: Record<string, string> = {
    ...cookies,
    __remember_me: 'true',
    ntes_kaola_ad: '1',
    _ntes_nuid: nuid,
    _ntes_nnid: cookies._ntes_nnid ?? `${nuid},${Date.now()}`,
    WNMCID: cookies.WNMCID ?? WNMCID,
    WEVNSM: cookies.WEVNSM ?? '1.0.0',
    osver: header.osver!,
    deviceId: header.deviceId!,
    os: header.os!,
    channel: header.channel!,
    appver: header.appver!,
  }
  delete cookieObject.MUSIC_U
  delete cookieObject.MUSIC_A
  // NMTID：与库一致，每次请求换一个新的 32 位十六进制（登录相关路径除外）
  cookieObject.NMTID = randomHex(16)
  if (cookies.MUSIC_U) cookieObject.MUSIC_U = cookies.MUSIC_U
  if (cookies.MUSIC_A) cookieObject.MUSIC_A = cookies.MUSIC_A
  else if (!hasUser) cookieObject.MUSIC_A = anonymousToken() || ''
  if (cookieObject.MUSIC_A === undefined)
    cookieObject.MUSIC_A = anonymousToken()
  return {
    header,
    cookieObject,
    cookieHeader: encodeCookieHeader(cookieObject),
  }
}

/** 把键值对象编码为 Cookie 头（键与值都按 `encodeURIComponent` 编码，同库）。 */
export function encodeCookieHeader(obj: Record<string, string>): string {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k]!)}`)
    .join('; ')
}

/**
 * 发起一次加密请求并解析响应。
 *
 * 与库的差异（有意为之）：
 * - 库在 `body.code` 非 200 时 **reject** 并把答案抛给调用方；这里**一律 resolve**，
 *   由调用处按 `body.code` 判定——与适配器抽离前的实际用法一致（适配器从不依赖 reject）。
 * - 库会在响应加密（`e_r`）时解密；本应用配置为不加密响应，故仅对「十六进制且解析不出 JSON」
 *   的 eapi 响应尝试一次 ECB 解密。
 */
async function request(
  path: string,
  data: Record<string, unknown>,
  options: { cookie?: string; crypto: Crypto },
): Promise<NcmResult> {
  const { header, cookieHeader } = requestCookie(options.cookie)
  const payload: Record<string, unknown> = { ...data, e_r: ENCRYPT_RESPONSE }
  let url: string
  let form: Record<string, string>
  let userAgent: string
  if (options.crypto === 'weapi') {
    payload.csrf_token = header.__csrf ?? ''
    url = `${DOMAIN}/weapi/${path.slice(5)}`
    form = weapiEncrypt(payload, random)
    userAgent = WEAPI_UA
  } else {
    payload.header = header
    url = `${API_DOMAIN}/eapi/${path.slice(5)}`
    form = eapiEncrypt(path, payload)
    userAgent = EAPI_UA
  }
  const res: HttpResponse = await corePorts().http.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
      Referer: DOMAIN,
      Cookie: cookieHeader,
    },
    body: encodeForm(form),
    timeoutMs: 15_000,
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = options.crypto === 'eapi' ? eapiDecrypt(text.trim()) : null
  }
  return {
    body: body ?? {},
    cookie: res.headers.getSetCookie?.() ?? [],
  }
}

/* ============================ 接口 ============================ */

/**
 * 搜索（`/api/cloudsearch/pc`，缺省 eapi）。
 * `type`：1 单曲、10 专辑、100 歌手、1000 歌单。
 */
export function cloudsearch(query: {
  keywords: string
  type?: number
  limit?: number
  offset?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/cloudsearch/pc',
    {
      s: query.keywords,
      type: query.type ?? 1,
      limit: query.limit ?? 30,
      offset: query.offset ?? 0,
      total: true,
    },
    { cookie: query.cookie, crypto: 'eapi' },
  )
}

/** 推荐歌单（weapi）。 */
export function personalized(query: {
  limit?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/personalized/playlist',
    { limit: query.limit ?? 30, total: true, n: 1000 },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 全部榜单（eapi）。 */
export function toplist(query: { cookie?: string } = {}): Promise<NcmResult> {
  return request('/api/toplist', {}, { cookie: query.cookie, crypto: 'eapi' })
}

/** 歌单详情（eapi）。 */
export function playlistDetail(query: {
  id: string
  s?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/v6/playlist/detail',
    { id: query.id, n: 100000, s: query.s ?? 8 },
    { cookie: query.cookie, crypto: 'eapi' },
  )
}

/**
 * 分类歌单（weapi）。
 *
 * 库在这里做了 `avatarImgId_str → avatarImgIdStr` 的字符串替换；本适配器归一化只取
 * `name` / `coverImgUrl` / `playCount` / `creator.nickname` / `trackCount`，用不到该字段，故省略。
 */
export function topPlaylist(query: {
  cat?: string
  limit?: number
  offset?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/playlist/list',
    {
      cat: query.cat ?? '全部',
      order: 'hot',
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
      total: true,
    },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 推荐新歌（weapi）。 */
export function personalizedNewsong(query: {
  limit?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/personalized/newsong',
    { type: 'recommend', limit: query.limit ?? 10, areaId: 0 },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 歌单分类目录（eapi）。 */
export function playlistCatlist(
  query: { cookie?: string } = {},
): Promise<NcmResult> {
  return request(
    '/api/playlist/catalogue',
    {},
    { cookie: query.cookie, crypto: 'eapi' },
  )
}

/** 最新专辑（weapi）。 */
export function albumNewest(
  query: { cookie?: string } = {},
): Promise<NcmResult> {
  return request(
    '/api/discovery/newAlbum',
    {},
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 歌手专辑分页（weapi）。 */
export function artistAlbum(query: {
  id: string
  limit?: number
  offset?: number
  cookie?: string
}): Promise<NcmResult> {
  return request(
    `/api/artist/albums/${query.id}`,
    { limit: query.limit ?? 30, offset: query.offset ?? 0, total: true },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 歌手详情（含热门前 50 首，weapi）。 */
export function artists(query: {
  id: string
  cookie?: string
}): Promise<NcmResult> {
  return request(
    `/api/v1/artist/${query.id}`,
    {},
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 专辑详情（weapi）。 */
export function album(query: {
  id: string
  cookie?: string
}): Promise<NcmResult> {
  return request(
    `/api/v1/album/${query.id}`,
    {},
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 曲目播放地址 v1（eapi）。音质档：standard / higher / exhigh / lossless / hires 等。 */
export function songUrlV1(query: {
  id: string
  level: string
  cookie?: string
}): Promise<NcmResult> {
  const data: Record<string, unknown> = {
    ids: `[${query.id}]`,
    level: query.level,
    encodeType: 'flac',
  }
  if (query.level === 'sky') data.immerseType = 'c51'
  return request('/api/song/enhance/player/url/v1', data, {
    cookie: query.cookie,
    crypto: 'eapi',
  })
}

/** 曲目详情（weapi）。 */
export function songDetail(query: {
  ids: string[]
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/v3/song/detail',
    { c: `[${query.ids.map((id) => `{"id":${id}}`).join(',')}]` },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/** 歌词（eapi）。 */
export function lyricNew(query: {
  id: string
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/song/lyric/v1',
    {
      id: query.id,
      cp: false,
      tv: 0,
      lv: 0,
      rv: 0,
      kv: 0,
      yv: 0,
      ytv: 0,
      yrv: 0,
    },
    { cookie: query.cookie, crypto: 'eapi' },
  )
}

/** 登录账号信息（weapi）；库把 `body` 包成 `{ data: body }`，这里保持一致。 */
export async function loginStatus(query: {
  cookie?: string
}): Promise<NcmResult> {
  const result = await request(
    '/api/w/nuser/account/get',
    {},
    { cookie: query.cookie, crypto: 'weapi' },
  )
  return {
    body: { data: { ...result.body } },
    cookie: result.cookie,
  }
}

/** 用户歌单（weapi）。 */
export function userPlaylist(query: {
  uid: string
  cookie?: string
}): Promise<NcmResult> {
  return request(
    '/api/user/playlist',
    { uid: query.uid, limit: 30, offset: 0, includeVideo: true },
    { cookie: query.cookie, crypto: 'weapi' },
  )
}

/**
 * 匿名注册（weapi）：取 `MUSIC_A`。
 *
 * 库的 `register_anonimous` 构造 `username = base64("<deviceId> <base64(md5(xor(deviceId)))>")`，
 * 其中 xor 用的密钥是 `3go8&$8*3*3h0k(2)2`。这里照搬，供宿主在启动时获取匿名 token。
 */
export async function registerAnonymous(): Promise<string> {
  const deviceId = randomDeviceId()
  const encoded = `${deviceId} ${anonymousHash(deviceId)}`
  const username = base64(utf8(encoded))
  const result = await request(
    '/api/register/anonimous',
    { username },
    { crypto: 'weapi' },
  )
  const cookies = result.cookie ?? []
  for (const c of cookies) {
    const m = /(?:^|;\s*)MUSIC_A=([^;]+)/.exec(c)
    if (m) return m[1]!
  }
  return ''
}

/** 小写十六进制随机串（库用 CryptoJS `WordArray.random(n).toString()`：每个字节两位）。 */
function randomHex(bytes: number): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < bytes * 2; i++)
    out += hex.charAt(Math.floor(random() * 16))
  return out
}

/** 设备 id：52 个大写十六进制字符（库的 `generateDeviceId`）。 */
function randomDeviceId(): string {
  const chars = '0123456789ABCDEF'
  let out = ''
  for (let i = 0; i < 52; i++) out += chars.charAt(Math.floor(random() * 16))
  return out
}

const ANON_XOR_KEY = '3go8&$8*3*3h0k(2)2'

function anonymousHash(deviceId: string): string {
  let xored = ''
  for (let i = 0; i < deviceId.length; i++) {
    xored += String.fromCharCode(
      deviceId.charCodeAt(i) ^ ANON_XOR_KEY.charCodeAt(i % ANON_XOR_KEY.length),
    )
  }
  return base64(md5(utf8(xored)))
}
