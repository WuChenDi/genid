import type { GenidConfig, GenidOptions } from './types'
import { GenidMethod } from './types'

/** Merges user options with defaults and returns a complete internal config. */
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

  // Values 0-4 are reserved for clock rollback; default starts at 5.
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

/** Validates the config and throws an Error if any value is out of range. */
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
    throw new Error('[GenidOptimized] baseTime must not be in the future')
  }

  if (workerIdBitLength < 1 || workerIdBitLength > 15) {
    throw new Error(
      '[GenidOptimized] workerIdBitLength must be between 1 and 15',
    )
  }

  if (seqBitLength < 3 || seqBitLength > 21) {
    throw new Error('[GenidOptimized] seqBitLength must be between 3 and 21')
  }

  if (workerIdBitLength + seqBitLength > 22) {
    throw new Error(
      '[GenidOptimized] workerIdBitLength + seqBitLength must not exceed 22',
    )
  }

  const maxWorkerId = (1 << workerIdBitLength) - 1
  if (workerId < 0 || workerId > maxWorkerId) {
    throw new Error(
      `[GenidOptimized] workerId must be between 0 and ${maxWorkerId}`,
    )
  }

  if (minSeqNumber < 5) {
    throw new Error(
      '[GenidOptimized] minSeqNumber must be at least 5 (0-4 are reserved)',
    )
  }

  if (maxSeqNumber < minSeqNumber) {
    throw new Error(
      '[GenidOptimized] maxSeqNumber must be greater than or equal to minSeqNumber',
    )
  }
}
