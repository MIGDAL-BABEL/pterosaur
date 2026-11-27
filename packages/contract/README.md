# `@pterosaur/contract` —— 跨端契约

三份原生实现（TS / Swift / Kotlin）之间**唯一的同步机制**（ADR-065 / 见 `docs/DECISIONS.md` 的 ADR-069）。
这里没有可被 import 的业务代码，只有**语言无关的数据**与几份生成它的 TypeScript 脚本。

| 文件                        | 内容                                             | 各端怎么用                                             |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `capabilities.json`         | 源清单与各源的能力矩阵（由注册表导出，不是手写） | 实现 UI 时据此隐藏入口；测试断言之                     |
| `vectors/*.json`            | 算法向量：同样的输入 → 同样的输出                | core 的测试逐条复算；任一不符即**测试失败**            |
| `golden/normalize.json`     | 上游原始 JSON → 共享模型的归一化结果             | 同上                                                   |
| `recordings/netease.ndjson` | 真实的匿名上游请求与响应（已脱敏）               | 回放服务器离线跑核心流程；断言自己构造的请求与录制一致 |

## 读契约

所有文件都是 UTF-8 JSON（`recordings` 是 NDJSON，一行一条）。结构定义见 `src/index.ts`；
各端应各自写最小的解析器，**不要**把结构硬编码进实现。

### 向量（`vectors/*.json`）

```json
{
  "kind": "aes-128.cbc.encrypt",
  "input": { "key": "…hex…", "iv": "…hex…", "plaintextHex": "…" },
  "expected": "…hex…",
  "source": "出处（规范 / 上游实测 / 库源码）"
}
```

`kind` 与各端 core 的函数一一对应。输入与期望输出的编码约定：

- `encoding`：文本 → UTF-8 字节的小写十六进制 / base64；`form.encode*` 遵循 WHATWG 表单编码。
- `digest`：输入是文本，输出是小写十六进制。
- `aes`：所有字节参数都以十六进制给出；`*.decrypt` 的输入是密文、输出是**带填充**的明文十六进制。
- `netease-sign`：
  - `netease.eapi.sign`：`{ path, payload }` → `params`（大写十六进制）；
  - `netease.weapi.encrypt`：`{ payload, secret }` → `{ params, encSecKey }`。会话密钥**直接给出**，
    各端用 `secret` 而不是随机生成；`encSecKey` 的裸 RSA 无随机，故结果确定（ADR-068）。
- `normalize` / `entity` / `url` / `lyric`：输入输出的形状与各端实现一致即可（JSON 深比较）。

### 黄金样例（`golden/normalize.json`）

```json
{ "id": "cloudsearch.song.0", "fn": "netease.normalizeTrack",
  "input": { "上游原始对象" }, "expected": { "共享模型 Track" }, "source": "录制" }
```

`fn` 是参考实现的函数名；各端按同一名字找到自己的实现，**输出须与 `expected` 深相等**。

### 录制（`recordings/netease.ndjson`）

每条是 `{ id, endpoint, request: { method, url, headers, body, plaintext }, response: { status, body } }`。
加密体每次不同，故 `request.body` 只记字段名、密文格式（`hex` / `base64` / `rsa`）与长度；
`plaintext` 是 eapi 的明文载荷（去掉 `header` 字段，避免录制里出现设备 cookie）。
**没有任何凭证**——测试会扫描并断言这一点。

## 重新生成

```bash
pnpm --filter @pterosaur/contract regen:capabilities   # 能力矩阵
pnpm --filter @pterosaur/contract regen:vectors        # 算法向量
pnpm --filter @pterosaur/contract record               # 录制（联网）
pnpm --filter @pterosaur/contract regen:golden         # 黄金样例（依赖录制）
```

生成物**入库**：Android / macOS 的构建机不必装 Node。生成脚本读的是参考实现的真实输出——
手改这些 JSON 没有意义，测试会让你失败。

## 修改契约的规矩

1. 改参考实现（`packages/core` / `packages/shared`）→ **同一提交**里重新生成契约。
2. 契约变化时，`packages/contract/**` 的 CI 规则要求三端的一致性测试全部重跑（见 ADR-066）。
3. 任何一端的测试**不得**复制样例到自己的仓库——只读本目录。
