/**
 * 生成算法向量（`vectors/*.json`）：同样的输入 → 同样的输出，供各端 core 的测试逐条比对。
 *
 * 向量由**参考实现**（`@pterosaur/core` + `@pterosaur/shared`）的真实输出产出，而不是手抄：
 * 手抄的值一旦与实现漂移，各端照它实现就会一起漂。重新生成用
 * `pnpm --filter @pterosaur/contract regen:vectors`。
 *
 * 选取原则：每项算法取**边界明确、互不重复**的代表性输入——空串 / 单个码点 / 代理对 / 分块边界 /
 * 大小写与特殊字符 / 真实上游样本。向量里的 `kind` 与各端 core 的函数一一对应（见 README）。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { configureCore } from '@pterosaur/core'
import { canonicalBiliImage } from '../../core/src/sources/bilibili.js'
import {
  eapiEncrypt,
  weapiEncrypt,
} from '../../core/src/sources/neteaseSign.js'
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  aesEcbDecrypt,
  aesEcbEncrypt,
  base64,
  fromHex,
  md5,
  pbkdf2Sha256,
  sha1,
  sha256,
  toHex,
  unbase64,
  utf8,
  fromUtf8,
} from '../../core/src/services/crypto.js'
import { parseLrc } from '@pterosaur/shared/lyric'
import { canonicalNeteaseImage, coverAt } from '@pterosaur/shared/image'
import { keyOf, sourceOf, streamUrl } from '@pterosaur/shared/types'
import {
  encodeForm,
  formUrlEncode,
  joinUrl,
  queryValues,
  replaceQuery,
  splitUrl,
} from '@pterosaur/shared/url'
import { contractPath, type Vector, type VectorFile } from '../src/index.js'

configureCore({
  http: { fetch: () => Promise.reject(new Error('regen:vectors 不应发请求')) },
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

const SCHEMA = 'pterosaur-vectors@1'

function write(file: string, vectors: Vector[]): void {
  const out: VectorFile = { schema: SCHEMA, vectors }
  mkdirSync(contractPath('vectors'), { recursive: true })
  writeFileSync(
    contractPath('vectors', file),
    JSON.stringify(out, null, 2) + '\n',
  )
  console.log(`vectors/${file}: ${vectors.length} 条`)
}

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** 让 `randomSecretKey` 依次产出给定 secret 的随机源（`Math.round(r * 61) = idx` → `r = idx / 61`）。 */
function fixedRng(secret: string): () => number {
  // secret 由 BASE62 字母表拼成（纯 ASCII），按字符展开不会拆开多字节字符
  const seq = [...secret].map((ch) => BASE62.indexOf(ch) / 61) // eslint-disable-line no-misused-spread
  let i = 0
  return () => (i < seq.length ? seq[i++]! : 0.5)
}

const v = (
  kind: string,
  input: unknown,
  expected: unknown,
  source: string,
): Vector => ({
  kind,
  input,
  expected,
  source,
})

/* ============================ 编解码 ============================ */

const TEXTS = ['', 'abc', '中文 é ü', '😀🎵', 'a'.repeat(56), 'x'.repeat(1000)]

write('encoding.json', [
  ...TEXTS.map((s) => v('utf8.encode', s, toHex(utf8(s)), 'RFC 3629')),
  ...TEXTS.slice(0, 5).map((s) =>
    v('utf8.decode', toHex(utf8(s)), fromUtf8(utf8(s)), 'RFC 3629'),
  ),
  ...TEXTS.slice(0, 5).map((s) =>
    v('base64.encode', s, base64(utf8(s)), 'RFC 4648'),
  ),
  ...['', 'aGVsbG8=', '5Lit5paH', '////', 'AAEC'].map((b) =>
    v('base64.decode', b, toHex(unbase64(b)), 'RFC 4648'),
  ),
  ...['', 'abc', '中文'].map((s) =>
    v('hex.encode', s, toHex(utf8(s)), '子串编码'),
  ),
  ...['', '616263', 'e4b8ad'].map((h) =>
    v('hex.decode', h, fromUtf8(fromHex(h)), '子串编码'),
  ),
  ...TEXTS.slice(0, 3).map((s) =>
    v('form.encode', s, formUrlEncode(s), 'WHATWG URL 标准'),
  ),
  ...[
    ['a', 'b c'],
    ['codekey', 'k-2'],
    ['params', '+/=='],
  ].map(([k, val]) =>
    v(
      'form.encodeObject',
      { [k!]: val! },
      encodeForm({ [k!]: val! }),
      'WHATWG URL 标准',
    ),
  ),
])

/* ============================ 摘要 ============================ */

write('digest.json', [
  ...TEXTS.map((s) => v('md5.hex', s, toHex(md5(utf8(s))), 'RFC 1321')),
  ...TEXTS.map((s) => v('sha1.hex', s, toHex(sha1(utf8(s))), 'FIPS 180-4')),
  ...TEXTS.map((s) => v('sha256.hex', s, toHex(sha256(utf8(s))), 'FIPS 180-4')),
  ...[1, 2, 1000].map((n) =>
    v(
      'pbkdf2.sha256',
      { password: 'secret', salt: 'salt', iterations: n },
      toHex(pbkdf2Sha256('secret', 'salt', n)),
      'RFC 8018',
    ),
  ),
])

/* ============================ 分组加密 ============================ */

const KEYS = [
  ['aes-128', '000102030405060708090a0b0c0d0e0f'],
  ['aes-192', '000102030405060708090a0b0c0d0e0f1011121314151617'],
  [
    'aes-256',
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  ],
]
const IV = '0102030405060708090a0b0c0d0e0f10'
const PLAINS = ['', 'a', 'hello world', 'x'.repeat(32)]

write('aes.json', [
  ...KEYS.flatMap(([name, keyHex]) =>
    PLAINS.map((p) => {
      const key = fromHex(keyHex!)
      const ct = aesEcbEncrypt(key, utf8(p))
      return v(
        `${name}.ecb.encrypt`,
        { key: keyHex, plaintextHex: toHex(utf8(p)) },
        toHex(ct),
        'FIPS 197 + PKCS#7',
      )
    }),
  ),
  ...KEYS.flatMap(
    ([name, keyHex]) =>
      PLAINS.map((p) => ({
        kind: `${name}.cbc.encrypt`,
        input: { key: keyHex, iv: IV, plaintextHex: toHex(utf8(p)) },
        expected: toHex(aesCbcEncrypt(fromHex(keyHex!), fromHex(IV), utf8(p))),
        source: 'NIST SP 800-38A + PKCS#7',
      })) as Vector[],
  ),
  // 解密向量：拿上面的密文解回明文
  ...KEYS.flatMap(([name, keyHex]) =>
    PLAINS.map((p) => {
      const key = fromHex(keyHex!)
      return v(
        `${name}.cbc.decrypt`,
        {
          key: keyHex,
          iv: IV,
          ciphertextHex: toHex(aesCbcEncrypt(key, fromHex(IV), utf8(p))),
        },
        toHex(utf8(p)),
        'NIST SP 800-38A + PKCS#7',
      )
    }),
  ),
  ...([PLAINS[2]!].map((p) => ({
    kind: 'aes-128.ecb.decrypt',
    input: {
      key: KEYS[0]![1],
      ciphertextHex: toHex(aesEcbEncrypt(fromHex(KEYS[0]![1]!), utf8(p))),
    },
    expected: toHex(utf8(p)),
    source: 'FIPS 197 + PKCS#7',
  })) as Vector[]),
])

// 自检：解密与加密互逆（不经向量，直接验实现）
for (const [, keyHex] of KEYS) {
  const key = fromHex(keyHex!)
  const ct = aesCbcEncrypt(key, fromHex(IV), utf8('roundtrip'))
  if (fromUtf8(aesCbcDecrypt(key, fromHex(IV), ct)) !== 'roundtrip')
    throw new Error('AES 自检失败')
  const eb = aesEcbEncrypt(key, utf8('roundtrip'))
  if (fromUtf8(aesEcbDecrypt(key, eb)) !== 'roundtrip')
    throw new Error('AES 自检失败')
}

/* ============================ 编码（与端无关但有结论） ============================ */

write('netease-sign.json', [
  ...['k-2', 'hello', '', '😀'].map((s) =>
    v(
      'netease.eapi.sign',
      { path: '/api/cloudsearch/pc', payload: s },
      eapiEncrypt('/api/cloudsearch/pc', s).params,
      '上游实测（check:live）',
    ),
  ),
  v(
    'netease.eapi.sign',
    {
      path: '/api/song/enhance/player/url/v1',
      payload: { ids: '[185809]', level: 'exhigh', encodeType: 'flac' },
    },
    eapiEncrypt('/api/song/enhance/player/url/v1', {
      ids: '[185809]',
      level: 'exhigh',
      encodeType: 'flac',
    }).params,
    '上游实测（check:live）',
  ),
  // weapi 的 params 依赖会话密钥：向量把 secret 直接写进 input，各端按同一 secret 复算
  ...['a', 'F', '9'].map((ch) => {
    const secret = ch.repeat(16)
    return v(
      'netease.weapi.encrypt',
      { payload: { e_r: false, csrf_token: '', s: '周杰伦' }, secret },
      weapiEncrypt(
        { e_r: false, csrf_token: '', s: '周杰伦' },
        fixedRng(secret),
      ),
      '裸 RSA + 双层 AES-CBC（ADR-068）',
    )
  }),
])

/* ============================ 规范 ============================ */

write('normalize.json', [
  ...[
    'https://p1.music.126.net/h==/1.jpg',
    'http://p4.music.126.net/h==/1.jpg?param=600y600',
    'https://p3.music.126.net/a.jpg?imageView=1&param=200y200&param=300y300&watermark=1',
    'https://music.126.net/a.jpg?param=1',
    'https://img.example.com/a.jpg?param=1',
    'not a url',
    'https://music.126.net/a.jpg',
  ].map((u) =>
    v(
      'netease.image.canonical',
      u,
      canonicalNeteaseImage(u),
      'ADR-020 / ADR-058',
    ),
  ),
  ...[
    ['https://p1.music.126.net/a.jpg?param=600y600', 300],
    ['http://p4.music.126.net/a.jpg', 1200],
    ['https://img.example.com/a.jpg', 300],
  ].map(([u, px]) =>
    v(
      'netease.image.coverAt',
      { url: u, px },
      coverAt(u as string, px as number),
      '尺寸分档',
    ),
  ),
  ...[
    '//i0.hdslb.com/a.jpg',
    'http://i2.hdslb.com/a.jpg',
    'https://i0.hdslb.com/a.jpg',
    'https://cdn.example.com/a.jpg',
  ].map((u) =>
    v('bilibili.image.canonical', u, canonicalBiliImage(u), 'B 站镜像主机归一'),
  ),
])

write('entity.json', [
  // keyOf 的输入是整串 `source:id`——不同源的相同 id 必须区分（ADR-022）
  // keyOf 的输入是实体：同一原始 id 在不同源下必须得到不同的键
  ...[
    { source: 'netease', id: '1' },
    { source: 'bilibili', id: '1' },
    { id: 'x' },
  ].map((e) =>
    v('entity.keyOf', e, keyOf(e as never), 'ADR-022；缺 source 按缺省源'),
  ),
  // sourceOf 的输入是实体（旧数据可能只剩 source）
  ...[{ source: 'netease' }, { source: 'bilibili' }, {}].map((e) =>
    v(
      'entity.sourceOf',
      e,
      sourceOf(e as never),
      'ADR-022；缺 source 即缺省源',
    ),
  ),
  ...[
    { id: '1' },
    { id: '1', level: 'exhigh' as const },
    { id: 'abc', token: 'zz', level: 'lossless' as const },
  ].map((o) =>
    v(
      'stream.url',
      o,
      streamUrl('netease', o.id, {
        level: o.level,
        token: 'token' in o ? o.token : undefined,
      }),
      '同源代理',
    ),
  ),
])

write('url.json', [
  ...[
    'https://p3.music.126.net/a/b.jpg',
    'http://h.x:8080/p?q=1#f',
    'https://USER:PW@p.x/y',
    'https://p.x?param=1',
    'bad',
    '//p.x/a',
  ].map((s) => v('url.split', s, splitUrl(s), 'WHATWG URL 子集')),
  ...['https://p3.music.126.net/a/b.jpg?param=1', 'http://p.x/p'].map((s) =>
    v('url.join', splitUrl(s), joinUrl(splitUrl(s)!), 'WHATWG URL 子集'),
  ),
  ...['/a.jpg?param=200y200&param=600y600', '/a.jpg?x=1#f'].map((s) =>
    v(
      'url.queryValues',
      { rest: s, key: 'param' },
      queryValues(s, 'param'),
      'WHATWG URL 子集',
    ),
  ),
  ...['/a.jpg?x=1#f', '/a.jpg'].map((s) =>
    v(
      'url.replaceQuery',
      { rest: s, query: 'param=3' },
      replaceQuery(s, 'param=3'),
      'WHATWG URL 子集',
    ),
  ),
])

/* ============================ 歌词 ============================ */

const LRC_SAMPLES: [string, string | undefined][] = [
  ['', undefined],
  ['[00:01.00]第一行\n[00:03.50]第二行', undefined],
  ['[00:01.00]Hello\n[00:03.50]World', '[00:01.00]你好\n[00:03.50]世界'],
  ['[ar:某艺人]\n[ti:某歌]\n[00:05.12]只有一行', undefined],
  ['[00:02.00]A\n[00:01.00]B\n[00:01.00]C', undefined],
  ['纯文本歌词，没有时间轴', undefined],
]
write(
  'lyric.json',
  LRC_SAMPLES.map(([lrc, t]) =>
    v('lyric.parseLrc', { lrc, translation: t }, parseLrc(lrc, t), 'LRC 格式'),
  ),
)

console.log('完成')
