/**
 * 从内核的适配器注册表导出能力矩阵（`capabilities.json`，见 ADR-069）。
 *
 * 能力是**运行时事实**（适配器对象上有没有那个方法），不能手写。
 * 本脚本每次生成后，测试会断言仓库里的文件与当前代码一致，避免分叉。
 */
import { writeFileSync } from 'node:fs'
import { buildCapabilities } from '../src/capabilities.js'
import { contractPath } from '../src/index.js'

const file = contractPath('capabilities.json')
writeFileSync(file, JSON.stringify(buildCapabilities(), null, 2) + '\n')
console.log('已生成 capabilities.json')
