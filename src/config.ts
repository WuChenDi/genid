import type { GenidConfig, GenidOptions } from './types'
import { GenidMethod } from './types'

/** 将用户配置与默认值合并，返回完整内部配置 */
export function initConfig(options: GenidOptions): GenidConfig {
  const config: GenidConfig = {
    workerId: options.workerId,
    method:
      options.method === GenidMethod.TRADITIONAL
        ? GenidMethod.TRADITIONAL
        : GenidMethod.DRIFT,
    baseTime:
      options.baseTime != null && options.baseTime > 0
        ? options.baseTime
        : new Date('2020-01-01').valueOf(),
    workerIdBitLength:
      options.workerIdBitLength != null && options.workerIdBitLength > 0
        ? options.workerIdBitLength
        : 6,
    seqBitLength:
      options.seqBitLength != null && options.seqBitLength > 0
        ? options.seqBitLength
        : 6,
    maxSeqNumber: 0,
    minSeqNumber: 0,
    topOverCostCount: 0,
  }

  config.maxSeqNumber =
    options.maxSeqNumber != null && options.maxSeqNumber > 0
      ? options.maxSeqNumber
      : (1 << config.seqBitLength) - 1

  // 0-4 保留用于时钟回拨，默认从 5 开始
  config.minSeqNumber =
    options.minSeqNumber != null && options.minSeqNumber >= 5
      ? options.minSeqNumber
      : 5

  config.topOverCostCount =
    options.topOverCostCount != null && options.topOverCostCount > 0
      ? options.topOverCostCount
      : 2000

  return config
}

/** 校验配置合法性，不合法则抛出 Error */
export function validateConfig(config: GenidConfig): void {
  const {
    workerId,
    baseTime,
    workerIdBitLength,
    seqBitLength,
    minSeqNumber,
    maxSeqNumber,
  } = config

  if (baseTime > Date.now()) {
    throw new Error('[GenidOptimized] baseTime 不能大于当前时间')
  }

  if (workerIdBitLength < 1 || workerIdBitLength > 15) {
    throw new Error('[GenidOptimized] workerIdBitLength 必须在 1 到 15 之间')
  }

  if (seqBitLength < 3 || seqBitLength > 21) {
    throw new Error('[GenidOptimized] seqBitLength 必须在 3 到 21 之间')
  }

  if (workerIdBitLength + seqBitLength > 22) {
    throw new Error(
      '[GenidOptimized] workerIdBitLength + seqBitLength 不能超过 22',
    )
  }

  const maxWorkerId = (1 << workerIdBitLength) - 1
  if (workerId < 0 || workerId > maxWorkerId) {
    throw new Error(`[GenidOptimized] workerId 必须在 0 到 ${maxWorkerId} 之间`)
  }

  if (minSeqNumber < 5) {
    throw new Error('[GenidOptimized] minSeqNumber 必须至少为 5(0-4 保留)')
  }

  if (maxSeqNumber < minSeqNumber) {
    throw new Error('[GenidOptimized] maxSeqNumber 必须大于或等于 minSeqNumber')
  }
}
