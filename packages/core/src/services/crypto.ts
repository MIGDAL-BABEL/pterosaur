/**
 * 密码原语的统一出口（ADR-067）：编解码与摘要见 `hash.ts`，分组加密见 `aes.ts`。
 *
 * 放在 `services/crypto.ts` 而非 `src/crypto.ts`，是与 Node 的 `node:crypto` 改名不同、
 * 一眼就能认出不是宿主 API。
 */
export {
  base64,
  concatBytes,
  fromHex,
  fromUtf8,
  md5,
  pbkdf2Sha256,
  rsaEncryptPkcs1,
  rsaKeyFromSpki,
  setUtf8Codec,
  sha1,
  sha256,
  toHex,
  unbase64,
  utf8,
  type Utf8Codec,
} from '../crypto/hash.js'
export {
  aesCbcDecrypt,
  aesCbcEncrypt,
  aesEcbDecrypt,
  aesEcbEncrypt,
} from '../crypto/aes.js'
