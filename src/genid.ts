import { initConfig, validateConfig } from './config'
import type {
  ConfigResult,
  GenidConfig,
  GenidOptions,
  ParseResult,
  Stats,
  StatsResult,
} from './types'
import { GenidMethod } from './types'

/**
 * 基于 Snowflake 算法的分布式唯一 ID 生成器
 *
 * - 漂移算法：高并发下借用未来时间戳，突破每毫秒序列号上限
 * - 时钟回拨：使用保留序列号（0-4）优雅降级，不阻塞生成
 * - 非线程安全，每个 Worker/进程应使用独立实例和不同 workerId
 *
 * @example
 * const genid = new GenidOptimized({ workerId: 1 });
 * const id = genid.nextId();
 */
export class GenidOptimized {
  private method!: bigint
  private baseTime!: bigint
  private workerId!: bigint
  private workerIdBitLength!: bigint
  private seqBitLength!: bigint
  private maxSeqNumber!: bigint
  private minSeqNumber!: bigint
  private topOverCostCount!: bigint

  private _timestampShift!: bigint
  private _currentSeqNumber!: bigint

  private _lastTimeTick!: bigint
  private _turnBackTimeTick!: bigint
  private _turnBackIndex!: number
  private _isOverCost!: boolean
  private _overCostCountInOneTerm!: bigint

  private _stats: Stats

  constructor(options: GenidOptions) {
    if (options.workerId === undefined || options.workerId === null) {
      throw new Error('[GenidOptimized] workerId 是必须参数')
    }

    const config = initConfig(options)
    validateConfig(config)
    this._initVariables(config)

    this._stats = {
      totalGenerated: 0n,
      overCostCount: 0n,
      turnBackCount: 0n,
      startTime: Date.now(),
    }
  }

  private _initVariables(config: GenidConfig): void {
    this.method = BigInt(config.method)
    this.baseTime = BigInt(config.baseTime)
    this.workerId = BigInt(config.workerId)
    this.workerIdBitLength = BigInt(config.workerIdBitLength)
    this.seqBitLength = BigInt(config.seqBitLength)
    this.maxSeqNumber = BigInt(config.maxSeqNumber)
    this.minSeqNumber = BigInt(config.minSeqNumber)
    this.topOverCostCount = BigInt(config.topOverCostCount)

    this._timestampShift = this.workerIdBitLength + this.seqBitLength
    this._currentSeqNumber = this.minSeqNumber

    this._lastTimeTick = 0n
    this._turnBackTimeTick = 0n
    this._turnBackIndex = 0
    this._isOverCost = false
    this._overCostCountInOneTerm = 0n
  }

  /** 获取相对于 baseTime 的当前时间戳 */
  private _getCurrentTimeTick(): bigint {
    return BigInt(Date.now()) - this.baseTime
  }

  /** 自旋等待直到时间前进到下一毫秒 */
  private _getNextTimeTick(): bigint {
    let timeTick = this._getCurrentTimeTick()
    let spinCount = 0
    const maxSpinCount = 1000000

    while (timeTick <= this._lastTimeTick) {
      spinCount++
      // 防止系统时间异常导致死循环
      if (spinCount > maxSpinCount) {
        return this._lastTimeTick + 1n
      }
      timeTick = this._getCurrentTimeTick()
    }
    return timeTick
  }

  /** 组装 ID：timestamp | workerId | sequence，并自增序列号 */
  private _calcId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      this._currentSeqNumber

    this._currentSeqNumber++
    this._stats.totalGenerated++

    return result
  }

  /** 时钟回拨时组装 ID，使用保留序列号（0-4）避免冲突 */
  private _calcTurnBackId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      BigInt(this._turnBackIndex)

    this._turnBackTimeTick++
    this._stats.totalGenerated++
    return result
  }

  /** 漂移状态下生成 ID */
  private _nextOverCostId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // 时间已前进，先用完当前序列号再切回正常状态
    if (currentTimeTick > this._lastTimeTick) {
      this._endOverCostAction(currentTimeTick)

      if (this._currentSeqNumber <= this.maxSeqNumber) {
        const result = this._calcId(this._lastTimeTick)
        this._lastTimeTick = currentTimeTick
        this._currentSeqNumber = this.minSeqNumber
        this._isOverCost = false
        this._overCostCountInOneTerm = 0n
        return result
      }

      this._lastTimeTick = currentTimeTick
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = false
      this._overCostCountInOneTerm = 0n
      return this._calcId(this._lastTimeTick)
    }

    // 漂移次数达到上限，强制等待下一毫秒
    if (this._overCostCountInOneTerm >= this.topOverCostCount) {
      this._endOverCostAction(currentTimeTick)
      this._lastTimeTick = this._getNextTimeTick()
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = false
      this._overCostCountInOneTerm = 0n
      return this._calcId(this._lastTimeTick)
    }

    // 序列号溢出，借用下一毫秒时间戳
    if (this._currentSeqNumber > this.maxSeqNumber) {
      this._lastTimeTick++
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = true
      this._overCostCountInOneTerm++
      return this._calcId(this._lastTimeTick)
    }

    return this._calcId(this._lastTimeTick)
  }

  /** 正常状态下生成 ID */
  private _nextNormalId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // 时钟回拨处理
    if (currentTimeTick < this._lastTimeTick) {
      if (this._turnBackTimeTick < 1) {
        this._turnBackTimeTick = this._lastTimeTick - 1n
        this._turnBackIndex++

        // 保留序列号（1-4）用完，回退到等待模式
        if (this._turnBackIndex > 4) {
          this._lastTimeTick = this._getNextTimeTick()
          this._turnBackIndex = 0
          this._turnBackTimeTick = 0n
          this._currentSeqNumber = this.minSeqNumber
          return this._calcId(this._lastTimeTick)
        }

        this._beginTurnBackAction(this._turnBackTimeTick)
        this._stats.turnBackCount++
      }

      // 回拨时间戳即将越过正常时间戳，强制等待避免 ID 冲突
      if (this._turnBackTimeTick >= this._lastTimeTick) {
        this._turnBackTimeTick = 0n
        this._turnBackIndex = 0
        this._lastTimeTick = this._getNextTimeTick()
        this._currentSeqNumber = this.minSeqNumber
        return this._calcId(this._lastTimeTick)
      }

      return this._calcTurnBackId(this._turnBackTimeTick)
    }

    // 时间已追上，清除回拨状态
    if (this._turnBackTimeTick > 0) {
      this._endTurnBackAction(this._turnBackTimeTick)
      this._turnBackTimeTick = 0n
      this._turnBackIndex = 0
    }

    // 时间前进，重置序列号
    if (currentTimeTick > this._lastTimeTick) {
      this._lastTimeTick = currentTimeTick
      this._currentSeqNumber = this.minSeqNumber
      return this._calcId(this._lastTimeTick)
    }

    // 序列号溢出（_calcId 先用再自增，所以 > maxSeq 才需要进位）
    if (this._currentSeqNumber > this.maxSeqNumber) {
      if (this.method === BigInt(GenidMethod.TRADITIONAL)) {
        this._lastTimeTick = this._getNextTimeTick()
        this._currentSeqNumber = this.minSeqNumber
        return this._calcId(this._lastTimeTick)
      }

      // 漂移算法：借用未来时间戳
      this._beginOverCostAction(currentTimeTick)
      this._lastTimeTick++
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = true
      this._overCostCountInOneTerm = 1n
      this._stats.overCostCount++
      return this._calcId(this._lastTimeTick)
    }

    return this._calcId(this._lastTimeTick)
  }

  // ---- 生命周期钩子（子类可重写以实现监控/日志） ----

  protected _beginOverCostAction(_useTimeTick: bigint): void {}
  protected _endOverCostAction(_useTimeTick: bigint): void {}
  protected _beginTurnBackAction(_useTimeTick: bigint): void {}
  protected _endTurnBackAction(_useTimeTick: bigint): void {}

  /**
   * 生成 ID，返回 number。超出安全整数范围时抛错。
   * @throws 当 ID >= Number.MAX_SAFE_INTEGER + 1 时
   */
  nextNumber(): number {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()

    if (id >= 9007199254740992n) {
      throw new Error(
        `[GenidOptimized] 生成的 ID ${id.toString()} 超出 JavaScript 安全整数范围 (9007199254740992)。请使用 nextBigId() 方法。`,
      )
    }

    return Number(id)
  }

  /** 生成 ID，安全范围内返回 number，否则返回 bigint */
  nextId(): number | bigint {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
    return id >= 9007199254740992n ? id : Number(id)
  }

  /** 生成 ID，始终返回 bigint */
  nextBigId(): bigint {
    return this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
  }

  /** 批量生成 ID */
  nextBatch(count: number, asBigInt: boolean = false): Array<number | bigint> {
    if (count <= 0) {
      throw new Error('[GenidOptimized] 批量生成数量必须大于 0')
    }

    const ids: Array<number | bigint> = []
    for (let i = 0; i < count; i++) {
      ids.push(asBigInt ? this.nextBigId() : this.nextId())
    }

    return ids
  }

  /**
   * 解析 ID，提取时间戳、workerId、序列号
   *
   * @example
   * genid.parse(id)
   * // { timestamp: Date, timestampMs: 1609459200000, workerId: 1, sequence: 42 }
   */
  parse(id: number | bigint | string): ParseResult {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID 不能为负数')
    }

    const timestampTick = idBigInt >> this._timestampShift
    const timestamp = timestampTick + this.baseTime

    const workerIdMask = (1n << this.workerIdBitLength) - 1n
    const workerId = (idBigInt >> this.seqBitLength) & workerIdMask

    const seqMask = (1n << this.seqBitLength) - 1n
    const sequence = idBigInt & seqMask

    return {
      timestamp: new Date(Number(timestamp)),
      timestampMs: Number(timestamp),
      workerId: Number(workerId),
      sequence: Number(sequence),
    }
  }

  /** 获取运行统计信息 */
  getStats(): StatsResult {
    const uptime = Date.now() - this._stats.startTime
    const totalGenerated = Number(this._stats.totalGenerated)

    return {
      totalGenerated,
      overCostCount: Number(this._stats.overCostCount),
      turnBackCount: Number(this._stats.turnBackCount),
      uptimeMs: uptime,
      avgPerSecond:
        uptime > 0 ? Math.floor((totalGenerated / uptime) * 1000) : 0,
      currentState: this._isOverCost ? 'OVER_COST' : 'NORMAL',
    }
  }

  /** 重置统计数据 */
  resetStats(): void {
    this._stats = {
      totalGenerated: 0n,
      overCostCount: 0n,
      turnBackCount: 0n,
      startTime: Date.now(),
    }
  }

  /** 获取当前配置信息 */
  getConfig(): ConfigResult {
    const maxWorkerId = (1 << Number(this.workerIdBitLength)) - 1
    const maxSequence = (1 << Number(this.seqBitLength)) - 1
    const idsPerMs = Number(this.maxSeqNumber - this.minSeqNumber + 1n)

    return {
      method:
        Number(this.method) === GenidMethod.DRIFT ? 'DRIFT' : 'TRADITIONAL',
      workerId: Number(this.workerId),
      workerIdRange: `0-${maxWorkerId}`,
      sequenceRange: `${Number(this.minSeqNumber)}-${Number(this.maxSeqNumber)}`,
      maxSequence,
      idsPerMillisecond: idsPerMs,
      baseTime: new Date(Number(this.baseTime)),
      timestampBits: 64 - Number(this.workerIdBitLength + this.seqBitLength),
      workerIdBits: Number(this.workerIdBitLength),
      sequenceBits: Number(this.seqBitLength),
    }
  }

  /**
   * 验证 ID 是否为当前配置下合法的 Snowflake ID
   * @param strictWorkerId - 为 true 时要求 workerId 匹配当前实例
   */
  isValid(
    id: number | bigint | string,
    strictWorkerId: boolean = false,
  ): boolean {
    try {
      const idBigInt = BigInt(id)

      if (idBigInt < 0n) return false
      if (idBigInt >= 18446744073709551616n) return false // 2^64

      const timestampTick = idBigInt >> this._timestampShift
      const timestamp = timestampTick + this.baseTime

      const workerIdMask = (1n << this.workerIdBitLength) - 1n
      const workerId = (idBigInt >> this.seqBitLength) & workerIdMask

      const seqMask = (1n << this.seqBitLength) - 1n
      const sequence = idBigInt & seqMask

      if (timestamp < this.baseTime) return false

      // 允许 1 秒漂移容差
      const currentTime = BigInt(Date.now())
      if (timestamp > currentTime + 1000n) return false

      const maxWorkerId = (1n << this.workerIdBitLength) - 1n
      if (workerId < 0n || workerId > maxWorkerId) return false
      if (strictWorkerId && workerId !== this.workerId) return false

      const maxSeq = (1n << this.seqBitLength) - 1n
      if (sequence < 0n || sequence > maxSeq) return false

      return true
    } catch {
      return false
    }
  }

  /** 将 ID 格式化为带标注的二进制字符串（调试用） */
  formatBinary(id: number | bigint | string): string {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID 不能为负数')
    }

    const binary = idBigInt.toString(2).padStart(64, '0')
    const parsed = this.parse(id)

    const timestampBits =
      64 - Number(this.workerIdBitLength + this.seqBitLength)
    const workerIdStart = timestampBits
    const seqStart = workerIdStart + Number(this.workerIdBitLength)

    return [
      `ID: ${id}`,
      'Binary (64-bit):',
      `${binary.slice(0, timestampBits)} - 时间戳 (${timestampBits} bits) = ${parsed.timestamp.toISOString()}`,
      `${binary.slice(timestampBits, workerIdStart + Number(this.workerIdBitLength))} - 工作节点 ID (${this.workerIdBitLength} bits) = ${parsed.workerId}`,
      `${binary.slice(seqStart)} - 序列号 (${this.seqBitLength} bits) = ${parsed.sequence}`,
    ].join('\n')
  }
}
