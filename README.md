# @cdlab996/genid

[![npm version](https://img.shields.io/npm/v/@cdlab996/genid)](https://www.npmjs.com/package/@cdlab996/genid)
[![license](https://img.shields.io/npm/l/@cdlab996/genid)](./LICENSE)

基于 Snowflake 算法的高性能分布式唯一 ID 生成器，支持漂移算法和时钟回拨处理。

## 特性

- **漂移算法** - 高并发场景下突破每毫秒序列号上限，性能更优
- **时钟回拨处理** - 使用保留序列号优雅降级，不阻塞 ID 生成
- **灵活配置** - 支持自定义时间戳、节点 ID、序列号的位长度分配
- **ID 验证** - 支持严格/宽松模式校验 ID 有效性
- **运行监控** - 内置统计、解析和二进制格式化调试工具

## 安装

```bash
# npm
npm install @cdlab996/genid

# pnpm
pnpm add @cdlab996/genid
```

## 快速开始

```typescript
import { GenidOptimized } from '@cdlab996/genid'

// 创建实例（每个 Worker/进程使用不同的 workerId）
const genid = new GenidOptimized({ workerId: 1 })

// 生成 ID
const id = genid.nextId()

// 批量生成
const ids = genid.nextBatch(1000)

// 解析 ID
const info = genid.parse(id)
// => { timestamp: Date, timestampMs: 1609459200000, workerId: 1, sequence: 42 }

// 验证 ID
genid.isValid(id) // true
```

## API

### `new GenidOptimized(options)`

| 参数                | 类型          | 必填  | 默认值             | 说明                                          |
| ------------------- | ------------- | :---: | ------------------ | --------------------------------------------- |
| `workerId`          | `number`      |  Yes  | -                  | 工作节点 ID（0 ~ 2^workerIdBitLength-1）      |
| `method`            | `GenidMethod` |       | `DRIFT`            | 算法：`DRIFT`（漂移）或 `TRADITIONAL`（传统） |
| `baseTime`          | `number`      |       | `1577836800000`    | 起始时间戳，毫秒（默认 2020-01-01）           |
| `workerIdBitLength` | `number`      |       | `6`                | 节点 ID 位数（1-15）                          |
| `seqBitLength`      | `number`      |       | `6`                | 序列号位数（3-21）                            |
| `maxSeqNumber`      | `number`      |       | `2^seqBitLength-1` | 最大序列号                                    |
| `minSeqNumber`      | `number`      |       | `5`                | 最小序列号（0-4 保留用于时钟回拨）            |
| `topOverCostCount`  | `number`      |       | `2000`             | 最大漂移次数                                  |

### 生成 ID

```typescript
genid.nextId()            // 返回 number | bigint（自动选择）
genid.nextNumber()        // 返回 number（超出安全整数范围抛错）
genid.nextBigId()         // 返回 bigint
genid.nextBatch(100)      // 批量生成 100 个 ID
genid.nextBatch(100, true) // 批量生成 100 个 BigInt ID
```

### 解析与验证

```typescript
// 解析 ID 的组成部分
genid.parse(id)
// => { timestamp: Date, timestampMs: number, workerId: number, sequence: number }

// 宽松验证：检查 ID 格式是否有效
genid.isValid(id)           // true
genid.isValid(12345)        // false
genid.isValid('invalid')    // false

// 严格验证：要求 workerId 匹配当前实例
genid.isValid(id, true)     // true（本实例生成的 ID）
genid.isValid(otherId, true) // false（其他实例生成的 ID）
```

### 统计与配置

```typescript
// 获取运行统计
genid.getStats()
// => {
//   totalGenerated: 1000,
//   overCostCount: 10,
//   turnBackCount: 2,
//   uptimeMs: 60000,
//   avgPerSecond: 16,
//   currentState: 'NORMAL' | 'OVER_COST'
// }

// 获取当前配置
genid.getConfig()
// => {
//   method: 'DRIFT',
//   workerId: 1,
//   workerIdRange: '0-63',
//   sequenceRange: '5-63',
//   maxSequence: 63,
//   idsPerMillisecond: 59,
//   baseTime: Date,
//   timestampBits: 52,
//   workerIdBits: 6,
//   sequenceBits: 6
// }

// 重置统计
genid.resetStats()
```

### 调试

```typescript
genid.formatBinary(id)
// ID: 123456789012345
// Binary (64-bit):
// 0000000000011010... - 时间戳 (52 bits) = 2025-10-17T...
// 000001 - 工作节点 ID (6 bits) = 1
// 101010 - 序列号 (6 bits) = 42
```

## 使用示例

### 自定义位分配

```typescript
import { GenidOptimized, GenidMethod } from '@cdlab996/genid'

const genid = new GenidOptimized({
  workerId: 1,
  method: GenidMethod.TRADITIONAL,
  baseTime: new Date('2024-01-01').valueOf(),
  workerIdBitLength: 10, // 支持 1024 个节点
  seqBitLength: 12,      // 每毫秒 4096 个 ID
  topOverCostCount: 5000,
})
```

### 验证外部 ID

```typescript
// 验证从数据库或 API 获取的 ID
const externalId = '123456789012345'
if (genid.isValid(externalId)) {
  const info = genid.parse(externalId)
  console.log('生成时间:', info.timestamp)
  console.log('来自节点:', info.workerId)
} else {
  console.error('无效 ID')
}
```

### 性能监控

```typescript
setInterval(() => {
  const stats = genid.getStats()
  console.log(`速率: ${stats.avgPerSecond} ID/s | 漂移: ${stats.overCostCount} | 回拨: ${stats.turnBackCount}`)
}, 10000)
```

## 算法模式

| 模式              | 说明                                     | 适用场景             |
| ----------------- | ---------------------------------------- | -------------------- |
| **DRIFT**（默认） | 序列号耗尽时借用未来时间戳，避免等待     | 高频 ID 生成、高并发 |
| **TRADITIONAL**   | 严格按时间戳递增，序列号耗尽等待下一毫秒 | 对时间顺序严格要求   |

## 架构

### ID 结构（64-bit）

```
|------------ 时间戳 ------------|-- 工作节点 ID --|-- 序列号 --|
        42-52 bits                    1-15 bits        3-21 bits
```

默认配置：时间戳 52 bits（约 139 年）| 节点 ID 6 bits（64 个节点）| 序列号 6 bits（每毫秒 59 个 ID）

序列号 `0-4` 保留用于时钟回拨，正常使用从 `5` 开始。

### 核心流程

```mermaid
graph TB
    A[开始生成 ID] --> B{是否处于漂移状态?}

    B -->|否| C[正常路径]
    B -->|是| D[漂移路径]

    C --> E{检测时钟}
    E -->|时钟回拨| F[使用保留序列号 0-4]
    E -->|时间前进| G[重置序列号]
    E -->|同一毫秒| H{序列号是否溢出?}

    H -->|否| I[序列号+1 正常生成]
    H -->|是| J[进入漂移状态 时间戳+1]

    D --> K{检测时间}
    K -->|时间追上| L[退出漂移 恢复正常]
    K -->|超过最大漂移| M[等待下一毫秒 退出漂移]
    K -->|继续漂移| N{序列号是否溢出?}

    N -->|否| O[使用当前序列号]
    N -->|是| P[时间戳+1 重置序列号]

    F --> Q[计算 ID]
    G --> Q
    I --> Q
    J --> Q
    L --> Q
    M --> Q
    O --> Q
    P --> Q

    Q --> R[更新统计]
    R --> S[返回 ID]
```

## 注意事项

- 每个 Worker/进程必须使用**不同的 workerId**
- 实例**非线程安全**，不要跨线程共享
- `workerIdBitLength + seqBitLength` 不能超过 22
- 序列号 0-4 保留用于时钟回拨处理
- 超出 JavaScript 安全整数范围（2^53-1）时，使用 `nextBigId()` 或 `nextId()`（自动返回 BigInt）

## 性能

| 指标                       | 数值          |
| -------------------------- | ------------- |
| 单实例吞吐量               | > 50,000 ID/s |
| 每毫秒生成量（默认配置）   | 59 个         |
| 最大节点数（默认配置）     | 64 个         |
| 时间戳可用时长（默认配置） | ~139 年       |

## License

[MIT](./LICENSE) License © 2025-PRESENT [wudi](https://github.com/WuChenDi)
