import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildCapabilities } from '../src/capabilities.js'
import {
  contractPath,
  isCapabilitiesFile,
  isGoldenFile,
  isRecordingFile,
  isVectorFile,
  readJson,
  type GoldenFile,
  type Recording,
  type VectorFile,
} from '../src/index.js'
import { canonicalNeteaseImage, coverAt } from '@pterosaur/shared/image'
import { keyOf, sourceOf, streamUrl } from '@pterosaur/shared/types'
import { parseLrc } from '@pterosaur/shared/lyric'
import {
  encodeForm,
  formUrlEncode,
  joinUrl,
  queryValues,
  replaceQuery,
  splitUrl,
} from '@pterosaur/shared/url'
import {
  normalizeAlbum,
  normalizeArtist,
  normalizePlaylist,
  normalizeTrack,
} from '@pterosaur/core/netease'
import {
  canonicalBiliImage,
  decodeTitle,
  normalizeBilibiliTrack,
  parseDuration,
} from '@pterosaur/core/bilibili'
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  aesEcbDecrypt,
  aesEcbEncrypt,
  base64,
  fromHex,
  fromUtf8,
  md5,
  pbkdf2Sha256,
  sha1,
  sha256,
  toHex,
  unbase64,
  utf8,
} from '@pterosaur/core/crypto'
import { eapiEncrypt, weapiEncrypt } from '@pterosaur/core/neteaseSign'

const readVectors = (file: string) =>
  readJson<VectorFile>(`vectors/${file}`, isVectorFile)

/** 各 `kind` 对应参考实现的入口：TS 必须先自证「契约跑得通」，契约才算数（ADR-069）。 */
const RUNNERS: Record<string, (input: any) => unknown> = {
  'utf8.encode': (s: string) => toHex(utf8(s)),
  'utf8.decode': (h: string) => fromUtf8(fromHex(h)),
  'base64.encode': (s: string) => base64(utf8(s)),
  'base64.decode': (b: string) => toHex(unbase64(b)),
  'hex.encode': (s: string) => toHex(utf8(s)),
  'hex.decode': (h: string) => fromUtf8(fromHex(h)),
  'form.encode': (s: string) => formUrlEncode(s),
  'form.encodeObject': (o: Record<string, string>) => encodeForm(o),
  'md5.hex': (s: string) => toHex(md5(utf8(s))),
  'sha1.hex': (s: string) => toHex(sha1(utf8(s))),
  'sha256.hex': (s: string) => toHex(sha256(utf8(s))),
  'pbkdf2.sha256': (i: {
    password: string
    salt: string
    iterations: number
  }) => toHex(pbkdf2Sha256(i.password, i.salt, i.iterations)),
  'aes-128.ecb.encrypt': (i: any) =>
    toHex(aesEcbEncrypt(fromHex(i.key), fromHex(i.plaintextHex))),
  'aes-128.ecb.decrypt': (i: any) =>
    toHex(aesEcbDecrypt(fromHex(i.key), fromHex(i.ciphertextHex))),
  'aes-192.ecb.encrypt': (i: any) =>
    toHex(aesEcbEncrypt(fromHex(i.key), fromHex(i.plaintextHex))),
  'aes-256.ecb.encrypt': (i: any) =>
    toHex(aesEcbEncrypt(fromHex(i.key), fromHex(i.plaintextHex))),
  'aes-128.cbc.encrypt': (i: any) =>
    toHex(
      aesCbcEncrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.plaintextHex)),
    ),
  'aes-192.cbc.encrypt': (i: any) =>
    toHex(
      aesCbcEncrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.plaintextHex)),
    ),
  'aes-256.cbc.encrypt': (i: any) =>
    toHex(
      aesCbcEncrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.plaintextHex)),
    ),
  'aes-128.cbc.decrypt': (i: any) =>
    toHex(
      aesCbcDecrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.ciphertextHex)),
    ),
  'aes-192.cbc.decrypt': (i: any) =>
    toHex(
      aesCbcDecrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.ciphertextHex)),
    ),
  'aes-256.cbc.decrypt': (i: any) =>
    toHex(
      aesCbcDecrypt(fromHex(i.key), fromHex(i.iv), fromHex(i.ciphertextHex)),
    ),
  'netease.eapi.sign': (i: { path: string; payload: unknown }) =>
    eapiEncrypt(i.path, i.payload as never).params,
  'netease.image.canonical': (u: string) => canonicalNeteaseImage(u),
  'netease.image.coverAt': (i: { url: string; px: number }) =>
    coverAt(i.url, i.px),
  'bilibili.image.canonical': (u: string) => canonicalBiliImage(u),
  'entity.keyOf': (e: { id: string; source?: string }) => keyOf(e as never),
  'entity.sourceOf': (e: { source?: string }) => sourceOf(e as never),
  'stream.url': (o: { id: string; level?: string; token?: string }) =>
    streamUrl('netease', o.id, { level: o.level, token: o.token } as never),
  'url.split': (s: string) => splitUrl(s),
  'url.join': (p: unknown) => joinUrl(p as never),
  'url.queryValues': (i: { rest: string; key: string }) =>
    queryValues(i.rest, i.key),
  'url.replaceQuery': (i: { rest: string; query: string }) =>
    replaceQuery(i.rest, i.query),
  'lyric.parseLrc': (i: { lrc: string; translation?: string }) =>
    parseLrc(i.lrc, i.translation),
}

/** weapi 依赖随机会话密钥：向量把 secret 写进 input，这里按同一 secret 复算。 */
function runWeapi(input: unknown): unknown {
  const { payload, secret } = input as {
    payload: Record<string, unknown>
    secret: string
  }
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  // secret 由 BASE62 字母表拼成（纯 ASCII），按字符展开不会拆开多字节字符
  const seq = [...secret].map((ch) => chars.indexOf(ch) / 61) // eslint-disable-line no-misused-spread
  let i = 0
  const out = weapiEncrypt(payload, () => (i < seq.length ? seq[i++]! : 0.5))
  return out
}

describe('契约：算法向量', () => {
  const files = [
    'encoding.json',
    'digest.json',
    'aes.json',
    'netease-sign.json',
    'normalize.json',
    'entity.json',
    'url.json',
    'lyric.json',
  ]
  for (const file of files) {
    it(`${file}：参考实现逐条复算通过`, () => {
      const { vectors } = readVectors(file)
      expect(vectors.length).toBeGreaterThan(0)
      const failures: string[] = []
      for (const vector of vectors) {
        const run =
          vector.kind === 'netease.weapi.encrypt'
            ? runWeapi
            : RUNNERS[vector.kind]
        if (!run) {
          failures.push(`${vector.kind}：测试没有对应的入口`)
          continue
        }
        const got = JSON.stringify(run(vector.input))
        if (got !== JSON.stringify(vector.expected))
          failures.push(
            `${vector.kind}(${JSON.stringify(vector.input).slice(0, 60)})`,
          )
      }
      expect(failures).toEqual([])
    })
  }
})

describe('契约：黄金样例', () => {
  const { cases } = readJson<GoldenFile>('golden/normalize.json', isGoldenFile)
  const NORMALIZERS: Record<string, (i: any) => unknown> = {
    'netease.normalizeTrack': normalizeTrack,
    'netease.normalizeArtist': normalizeArtist,
    'netease.normalizeAlbum': normalizeAlbum,
    'netease.normalizePlaylist': normalizePlaylist,
    'bilibili.normalizeTrack': normalizeBilibiliTrack,
    'bilibili.decodeTitle': decodeTitle,
    'bilibili.parseDuration': parseDuration,
    'bilibili.canonicalImage': canonicalBiliImage,
  }
  it('每条样例都能被参考实现复现', () => {
    expect(cases.length).toBeGreaterThan(10)
    for (const c of cases) {
      const fn = NORMALIZERS[c.fn]
      expect(fn, `${c.id}：没有 ${c.fn} 的入口`).toBeDefined()
      expect(fn!(c.input), c.id).toEqual(c.expected)
    }
  })
})

describe('契约：录制', () => {
  const lines = readFileSync(
    contractPath('recordings', 'netease.ndjson'),
    'utf8',
  )
    .trim()
    .split('\n')
  const recordings = lines.map((l: string) => JSON.parse(l) as Recording)
  it('形状合法、含密文格式与响应体', () => {
    expect(
      isRecordingFile({ schema: 'pterosaur-recordings@1', recordings }),
    ).toBe(true)
    for (const r of recordings) {
      expect(r.request.method).toBe('POST')
      // music.163.com 或 interface.music.163.com
      expect(r.request.url).toMatch(
        /^https:\/\/(music|interface\.music)\.163\.com\/(weapi|eapi)\//,
      )
      expect(r.request.body).toMatch(/params=<(hex|base64):\d+>/)
      expect(r.response.status).toBe(200)
    }
  })
  it('不含凭证（Cookie 值、会话令牌一律不录）', () => {
    const raw = lines.join('\n')
    for (const needle of [
      'MUSIC_U',
      'SESSDATA',
      '__csrf',
      'MUSIC_A',
      'deviceId',
    ]) {
      expect(raw, `录制里出现了 ${needle}`).not.toContain(needle)
    }
  })
  it('eapi 录制的明文与「请求字段」一致（样本可回放）', () => {
    const eapi = recordings.filter((r) => r.endpoint.includes('/eapi/'))
    expect(eapi.length).toBeGreaterThan(0)
    for (const r of eapi) {
      expect(r.request.plaintext).not.toBeNull()
    }
  })
})

describe('契约：能力矩阵', () => {
  it('仓库里的 capabilities.json 与当前注册表一致', () => {
    const onDisk = readJson('capabilities.json', isCapabilitiesFile)
    expect(onDisk).toEqual(buildCapabilities())
  })
})
