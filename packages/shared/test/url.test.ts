import { describe, it, expect } from 'vitest'
import {
  encodeForm,
  formUrlEncode,
  joinUrl,
  queryValues,
  replaceQuery,
  splitUrl,
} from '../src/url.js'

/**
 * 对拍：`src/url.ts` 是 WHATWG `URL` / `URLSearchParams` 的纯 ES 替身，
 * 这里直接拿 Node 的原生实现当基准——二者对同一输入必须逐字节一致。
 * （`URL` 只出现在测试里；`src/` 不得使用，见 ADR-067。）
 */
const SAMPLES = [
  '',
  'type',
  '1',
  '1200y1200',
  'v1_abc123_web_login_1730000000000',
  'unknown-123456',
  'a b+c/d?e&f=g#h"i<j>k~!*()-._,;:@$%[]{}|\\^`',
  '中文 é ü 😀',
  '\u0000\u0001\u001f\u007f\u0080',
]

describe('formUrlEncode（对拍 URLSearchParams）', () => {
  it('与原生编码逐字节一致', () => {
    for (const s of SAMPLES) {
      // `new URLSearchParams({ k })` 序列化为 `k=<value>`，去掉前缀即原生对 value 的编码
      const native = new URLSearchParams({ k: s }).toString()
      expect(encodeForm({ k: s })).toBe(native)
      expect(formUrlEncode(s)).toBe(native.slice(2))
    }
  })

  it('多键保持传入顺序；空对象为空串', () => {
    const fields = {
      codekey: 'k-2',
      chainId: 'v1_x_web_login_1',
      hdw_device: 'web',
      hitExp: '1',
    }
    expect(encodeForm(fields)).toBe(new URLSearchParams(fields).toString())
    expect(encodeForm({})).toBe('')
  })
})

describe('splitUrl + joinUrl（对拍 URL）', () => {
  const urls = [
    'https://p3.music.126.net/a/b.jpg',
    'http://p1.music.126.net:8080/h==/1.jpg?param=600y600&x=1#frag',
    'https://user:pw@p4.music.126.net/x.jpg',
    'https://P1.MUSIC.126.NET',
    'https://p3.music.126.net?param=1',
    'https://p3.music.126.net#top',
    'ftp://p1.music.126.net/a.jpg',
    'https://[::1]:8443/a.jpg',
    '  https://p3.music.126.net/a.jpg  ',
  ]

  it('拆开再拼回，与原生 href 一致（非默认端口、无点段的 ASCII 地址）', () => {
    for (const url of urls) {
      const parts = splitUrl(url)
      expect(parts, url).not.toBeNull()
      const native = new URL(url)
      expect(joinUrl(parts!), url).toBe(native.href)
      expect(parts!.protocol, url).toBe(native.protocol)
      expect(parts!.hostname, url).toBe(native.hostname)
    }
  })

  it('改写 scheme / 主机 / 查询串', () => {
    const parts = splitUrl('http://p1.music.126.net/a.jpg?x=1&param=2#f')!
    expect(
      joinUrl(parts, {
        protocol: 'https:',
        hostname: 'p3.music.126.net',
        rest: replaceQuery(parts.rest, 'param=3'),
      }),
    ).toBe('https://p3.music.126.net/a.jpg?param=3#f')
    expect(replaceQuery('/a.jpg?x=1#f', '')).toBe('/a.jpg#f')
    expect(replaceQuery('/a.jpg', 'k=v')).toBe('/a.jpg?k=v')
  })

  it('解析不了（无 scheme://、无主机）返回 null，对应 `new URL` 抛错', () => {
    expect(splitUrl('not a url')).toBeNull()
    expect(splitUrl('//p1.music.126.net/a.jpg')).toBeNull()
    expect(splitUrl('https://')).toBeNull()
    expect(splitUrl('')).toBeNull()
    expect(() => new URL('not a url')).toThrow()
  })
})

describe('queryValues（对拍 URLSearchParams.getAll）', () => {
  it('同一键的多个值按序返回，并按表单口径解码', () => {
    const rest = '/a.jpg?param=200y200&x=1&param=600y600&empty&param=a+b%21'
    expect(queryValues(rest, 'param')).toEqual(
      new URL(`https://h${rest}`).searchParams.getAll('param'),
    )
    expect(queryValues(rest, 'param')).toEqual(['200y200', '600y600', 'a b!'])
    expect(queryValues(rest, 'x')).toEqual(['1'])
    expect(queryValues(rest, 'empty')).toEqual([''])
    expect(queryValues(rest, 'none')).toEqual([])
    // 片段里的 `?param=` 不算查询串
    expect(queryValues('/a.jpg#param=1', 'param')).toEqual([])
  })
})
