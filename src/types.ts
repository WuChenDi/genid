/** ID 生成算法类型 */
export enum GenidMethod {
  /** 漂移算法（推荐，高并发下可突破每毫秒序列号上限） */
  DRIFT = 1,
  /** 传统算法（序列号耗尽时等待下一毫秒） */
  TRADITIONAL = 2,
}

/** ID 生成器构造选项 */
export interface GenidOptions {
  /** 工作节点 ID（必须，范围 0 到 2^workerIdBitLength-1） */
  workerId: number
  /** 算法类型（默认：DRIFT） */
  method?: GenidMethod
  /** 起始时间戳/毫秒（默认：2020-01-01） */
  baseTime?: number
  /** 工作节点 ID 位数（1-15，默认：6） */
  workerIdBitLength?: number
  /** 序列号位数（3-21，默认：6） */
  seqBitLength?: number
  /** 最大序列号（默认：2^seqBitLength - 1） */
  maxSeqNumber?: number
  /** 最小序列号（默认：5，0-4 保留用于时钟回拨） */
  minSeqNumber?: number
  /** 最大漂移次数（默认：2000） */
  topOverCostCount?: number
}

/** 内部配置（所有字段必填，由 initConfig 生成） */
export interface GenidConfig {
  workerId: number
  method: GenidMethod
  baseTime: number
  workerIdBitLength: number
  seqBitLength: number
  maxSeqNumber: number
  minSeqNumber: number
  topOverCostCount: number
}

/** 内部统计数据（BigInt 确保大数精度） */
export interface Stats {
  totalGenerated: bigint
  overCostCount: bigint
  turnBackCount: bigint
  startTime: number
}

/** ID 解析结果 */
export interface ParseResult {
  /** 生成时间 */
  timestamp: Date
  /** 生成时间戳/毫秒 */
  timestampMs: number
  /** 工作节点 ID */
  workerId: number
  /** 序列号 */
  sequence: number
}

/** 对外统计信息 */
export interface StatsResult {
  totalGenerated: number
  overCostCount: number
  turnBackCount: number
  /** 运行时长/毫秒 */
  uptimeMs: number
  avgPerSecond: number
  currentState: 'OVER_COST' | 'NORMAL'
}

/** isValid 校验选项 */
export interface ValidateOptions {
  /** 为 true 时要求 workerId 匹配当前实例（默认：false） */
  strictWorkerId?: boolean
  /** ID 的生成时间不得早于此时间戳/毫秒（默认：baseTime） */
  afterTime?: number
}

/** 配置信息 */
export interface ConfigResult {
  method: 'DRIFT' | 'TRADITIONAL'
  workerId: number
  /** 格式："0-63" */
  workerIdRange: string
  /** 格式："5-63" */
  sequenceRange: string
  maxSequence: number
  idsPerMillisecond: number
  baseTime: Date
  timestampBits: number
  workerIdBits: number
  sequenceBits: number
}
