/**
 * ID 生成算法类型
 */
export enum GenidMethod {
  /** 漂移算法（推荐用于高性能场景） */
  DRIFT = 1,
  /** 传统算法 */
  TRADITIONAL = 2,
}

/**
 * ID 生成器配置选项
 */
export interface GenidOptions {
  /** 工作节点/机器 ID（必须，范围 0 到 2^workerIdBitLength-1） */
  workerId: number
  /** 算法类型（默认：GenidMethod.DRIFT） */
  method?: GenidMethod
  /** 起始时间戳，单位：毫秒（默认：1577836800000，即 2020-01-01 00:00:00） */
  baseTime?: number
  /** 工作节点 ID 的位数（范围：1-15，默认：6） */
  workerIdBitLength?: number
  /** 序列号的位数（范围：3-21，默认：6） */
  seqBitLength?: number
  /** 最大序列号（默认：2^seqBitLength - 1） */
  maxSeqNumber?: number
  /** 最小序列号（默认：5，0-4 保留用于时钟回拨处理） */
  minSeqNumber?: number
  /** 最大漂移次数，超过后等待下一毫秒（默认：2000） */
  topOverCostCount?: number
}

/**
 * ID 生成器内部配置（所有字段必填）
 */
export interface GenidConfig {
  /** 工作节点/机器 ID */
  workerId: number
  /** 算法类型 */
  method: GenidMethod
  /** 起始时间戳，单位：毫秒 */
  baseTime: number
  /** 工作节点 ID 的位数 */
  workerIdBitLength: number
  /** 序列号的位数 */
  seqBitLength: number
  /** 最大序列号 */
  maxSeqNumber: number
  /** 最小序列号 */
  minSeqNumber: number
  /** 最大漂移次数 */
  topOverCostCount: number
}

/**
 * 内部统计数据（使用 BigInt 确保精度）
 */
export interface Stats {
  /** 总生成 ID 数量 */
  totalGenerated: bigint
  /** 漂移次数（序列号溢出导致时间戳增加的次数） */
  overCostCount: bigint
  /** 时钟回拨次数（检测到系统时间倒退的次数） */
  turnBackCount: bigint
  /** 生成器启动时间戳，单位：毫秒 */
  startTime: number
}

/**
 * ID 解析结果
 */
export interface ParseResult {
  /** ID 生成时间（Date 对象） */
  timestamp: Date
  /** ID 生成时间戳，单位：毫秒 */
  timestampMs: number
  /** 工作节点 ID */
  workerId: number
  /** 序列号 */
  sequence: number
}

/**
 * 统计信息结果（对外暴露，使用 Number 类型）
 */
export interface StatsResult {
  /** 总生成 ID 数量 */
  totalGenerated: number
  /** 漂移次数 */
  overCostCount: number
  /** 时钟回拨次数 */
  turnBackCount: number
  /** 运行时长，单位：毫秒 */
  uptimeMs: number
  /** 平均每秒生成 ID 数量 */
  avgPerSecond: number
  /** 当前状态（OVER_COST: 漂移中, NORMAL: 正常） */
  currentState: 'OVER_COST' | 'NORMAL'
}

/**
 * 配置信息结果
 */
export interface ConfigResult {
  /** 算法类型（DRIFT: 漂移算法, TRADITIONAL: 传统算法） */
  method: 'DRIFT' | 'TRADITIONAL'
  /** 当前工作节点 ID */
  workerId: number
  /** 工作节点 ID 范围（格式："0-63"） */
  workerIdRange: string
  /** 序列号范围（格式："5-63"） */
  sequenceRange: string
  /** 最大序列号值 */
  maxSequence: number
  /** 每毫秒可生成的 ID 数量 */
  idsPerMillisecond: number
  /** 起始时间（Date 对象） */
  baseTime: Date
  /** 时间戳占用的位数 */
  timestampBits: number
  /** 工作节点 ID 占用的位数 */
  workerIdBits: number
  /** 序列号占用的位数 */
  sequenceBits: number
}
