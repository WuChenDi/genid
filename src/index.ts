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
 * 优化版 Snowflake ID 生成器
 *
 * 基于 Snowflake 算法的高性能分布式唯一 ID 生成器，支持漂移算法和时钟回拨处理。
 *
 * 特性：
 * - 漂移算法：提升高并发下的性能
 * - 优雅处理时钟回拨，不阻塞生成
 * - 可配置的位长度，灵活性高
 * - 支持传统和漂移两种生成方法
 *
 * ⚠️ 注意：此实例不是线程安全的，每个 Worker/进程应该创建独立的实例并使用不同的 workerId
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

  /**
   * 构造函数，初始化 ID 生成器
   *
   * @param {Object} options - 配置选项
   * @param {number} options.workerId - 工作节点/机器 ID(必须，范围 0 到 2^workerIdBitLength-1)
   * @param {GenidMethod} [options.method=GenidMethod.DRIFT] - 算法类型
   * @param {number} [options.baseTime=1577836800000] - 起始时间戳(毫秒，默认：2020-01-01)
   * @param {number} [options.workerIdBitLength=6] - 工作节点 ID 的位数(1-15，默认：6)
   * @param {number} [options.seqBitLength=6] - 序列号的位数(3-21，默认：6)
   * @param {number} [options.maxSeqNumber] - 最大序列号(默认：2^seqBitLength-1)
   * @param {number} [options.minSeqNumber=5] - 最小序列号(默认：5，0-4 保留)
   * @param {number} [options.topOverCostCount=2000] - 最大漂移次数(默认：2000)
   *
   * @throws {Error} 如果缺少 workerId 或配置无效
   *
   * @example
   * const genid = new GenidOptimized({ workerId: 1 });
   * const id = genid.nextId();
   */
  constructor(options: GenidOptions) {
    // 验证必须参数
    if (options.workerId === undefined || options.workerId === null) {
      throw new Error('[GenidOptimized] workerId 是必须参数')
    }

    // 设置默认配置
    const config = this._initConfig(options)

    // 验证配置有效性
    this._validateConfig(config)

    // 初始化实例变量
    this._initVariables(config)

    // 性能监控(可选)
    this._stats = {
      totalGenerated: 0n, // 总生成 ID 数量
      overCostCount: 0n, // 漂移次数
      turnBackCount: 0n, // 时钟回拨次数
      startTime: Date.now(), // 启动时间
    }
  }

  /**
   * 初始化配置，设置默认值
   * @private
   * @param {Object} options - 用户提供的配置
   * @returns {Object} 合并后的配置对象
   */
  private _initConfig(options: GenidOptions): GenidConfig {
    const config: GenidConfig = {
      workerId: options.workerId,
      method:
        options.method === GenidMethod.TRADITIONAL
          ? GenidMethod.TRADITIONAL
          : GenidMethod.DRIFT,
      baseTime:
        options.baseTime && options.baseTime > 0
          ? options.baseTime
          : new Date('2020-01-01').valueOf(),
      workerIdBitLength:
        options.workerIdBitLength && options.workerIdBitLength > 0
          ? options.workerIdBitLength
          : 6,
      seqBitLength:
        options.seqBitLength && options.seqBitLength > 0 ? options.seqBitLength : 6,
      maxSeqNumber: 0,
      minSeqNumber: 0,
      topOverCostCount: 0,
    }

    // 计算最大序列号
    config.maxSeqNumber =
      options.maxSeqNumber && options.maxSeqNumber > 0
        ? options.maxSeqNumber
        : (1 << config.seqBitLength) - 1

    // 设置最小序列号(0-4 保留用于时钟回拨)
    config.minSeqNumber =
      options.minSeqNumber && options.minSeqNumber > 0 ? options.minSeqNumber : 5

    // 设置最大漂移次数
    config.topOverCostCount =
      options.topOverCostCount && options.topOverCostCount > 0
        ? options.topOverCostCount
        : 2000

    return config
  }

  /**
   * 验证配置参数的有效性
   * @private
   * @param {Object} config - 配置对象
   * @throws {Error} 如果配置无效
   */
  private _validateConfig(config: GenidConfig): void {
    const { workerId, workerIdBitLength, seqBitLength, minSeqNumber, maxSeqNumber } =
      config

    // 验证位长度
    if (workerIdBitLength < 1 || workerIdBitLength > 15) {
      throw new Error('[GenidOptimized] workerIdBitLength 必须在 1 到 15 之间')
    }

    if (seqBitLength < 3 || seqBitLength > 21) {
      throw new Error('[GenidOptimized] seqBitLength 必须在 3 到 21 之间')
    }

    if (workerIdBitLength + seqBitLength > 22) {
      throw new Error('[GenidOptimized] workerIdBitLength + seqBitLength 不能超过 22')
    }

    // 验证工作节点 ID
    const maxWorkerId = (1 << workerIdBitLength) - 1
    if (workerId < 0 || workerId > maxWorkerId) {
      throw new Error(`[GenidOptimized] workerId 必须在 0 到 ${maxWorkerId} 之间`)
    }

    // 验证序列号范围
    if (minSeqNumber < 5) {
      throw new Error('[GenidOptimized] minSeqNumber 必须至少为 5(0-4 保留)')
    }

    if (maxSeqNumber < minSeqNumber) {
      throw new Error('[GenidOptimized] maxSeqNumber 必须大于或等于 minSeqNumber')
    }
  }

  /**
   * 初始化实例变量
   * @private
   * @param {Object} config - 配置对象
   */
  private _initVariables(config: GenidConfig): void {
    // 将配置转换为 BigInt 以确保精度
    this.method = BigInt(config.method)
    this.baseTime = BigInt(config.baseTime)
    this.workerId = BigInt(config.workerId)
    this.workerIdBitLength = BigInt(config.workerIdBitLength)
    this.seqBitLength = BigInt(config.seqBitLength)
    this.maxSeqNumber = BigInt(config.maxSeqNumber)
    this.minSeqNumber = BigInt(config.minSeqNumber)
    this.topOverCostCount = BigInt(config.topOverCostCount)

    // 计算位移量
    this._timestampShift = this.workerIdBitLength + this.seqBitLength
    this._currentSeqNumber = this.minSeqNumber

    // 状态变量
    this._lastTimeTick = 0n // 上次时间戳
    this._turnBackTimeTick = 0n // 时钟回拨时间戳
    this._turnBackIndex = 0 // 时钟回拨索引
    this._isOverCost = false // 是否处于漂移状态
    this._overCostCountInOneTerm = 0n // 当前周期的漂移次数
  }

  /**
   * 获取当前时间戳(相对于 baseTime 的毫秒数)
   * @private
   * @returns {bigint} 当前时间戳
   */
  private _getCurrentTimeTick(): bigint {
    return BigInt(Date.now()) - this.baseTime
  }

  /**
   * 等待下一毫秒
   * @private
   * @returns {bigint} 下一毫秒时间戳
   */
  private _getNextTimeTick(): bigint {
    let timeTick = this._getCurrentTimeTick()
    let spinCount = 0
    const maxSpinCount = 1000000 // 防止死循环的最大自旋次数

    while (timeTick <= this._lastTimeTick) {
      spinCount++
      if (spinCount > maxSpinCount) {
        /**
         * 如果自旋太多次，强制返回当前时间 + 1
         * 这种情况理论上不应该发生，除非系统时间出现严重问题
         */
        return this._lastTimeTick + 1n
      }
      timeTick = this._getCurrentTimeTick()
    }
    return timeTick
  }

  /**
   * 根据组件计算 ID
   * @private
   * @param {bigint} useTimeTick - 使用的时间戳
   * @returns {bigint} 计算得到的 ID
   */
  private _calcId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      this._currentSeqNumber

    this._currentSeqNumber++
    this._stats.totalGenerated++

    return result
  }

  /**
   * 计算时钟回拨时的 ID
   * @private
   * @param {bigint} useTimeTick - 使用的时间戳
   * @returns {bigint} 计算得到的 ID
   */
  private _calcTurnBackId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      BigInt(this._turnBackIndex)

    this._turnBackTimeTick--
    this._stats.totalGenerated++
    return result
  }

  /**
   * 处理漂移情况(漂移算法)
   * @private
   * @returns {bigint} 生成的 ID
   */
  private _nextOverCostId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // 时间前进，重置状态 - 但要先用完当前序列号
    if (currentTimeTick > this._lastTimeTick) {
      this._endOverCostAction(currentTimeTick)

      // 如果当前序列号还在有效范围内，先用完它
      if (this._currentSeqNumber <= this.maxSeqNumber) {
        const result = this._calcId(this._lastTimeTick)
        // 用完后再更新到新时间
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

    // 超过最大漂移次数，等待下一毫秒
    if (this._overCostCountInOneTerm >= this.topOverCostCount) {
      this._endOverCostAction(currentTimeTick)
      this._lastTimeTick = this._getNextTimeTick()
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = false
      this._overCostCountInOneTerm = 0n
      return this._calcId(this._lastTimeTick)
    }

    // 序列号溢出
    if (this._currentSeqNumber > this.maxSeqNumber) {
      this._lastTimeTick++
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = true
      this._overCostCountInOneTerm++
      return this._calcId(this._lastTimeTick)
    }

    return this._calcId(this._lastTimeTick)
  }

  /**
   * 正常生成 ID
   * @private
   * @returns {bigint} 生成的 ID
   */
  private _nextNormalId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // 检测到时钟回拨
    if (currentTimeTick < this._lastTimeTick) {
      if (this._turnBackTimeTick < 1) {
        this._turnBackTimeTick = this._lastTimeTick - 1n
        this._turnBackIndex++

        // fix：如果回拨索引超过保留范围(1-4)，等待时间追上而不是循环
        if (this._turnBackIndex > 4) {
          // 等待时间追上
          this._lastTimeTick = this._getNextTimeTick()
          this._turnBackIndex = 0
          this._turnBackTimeTick = 0n
          this._currentSeqNumber = this.minSeqNumber
          return this._calcId(this._lastTimeTick)
        }

        this._beginTurnBackAction(this._turnBackTimeTick)
        this._stats.turnBackCount++
      }

      return this._calcTurnBackId(this._turnBackTimeTick)
    }

    // 时间追上，清除回拨状态
    if (this._turnBackTimeTick > 0) {
      this._endTurnBackAction(this._turnBackTimeTick)
      this._turnBackTimeTick = 0n
      this._turnBackIndex = 0 // 重置回拨索引
    }

    // 时间前进
    if (currentTimeTick > this._lastTimeTick) {
      this._lastTimeTick = currentTimeTick
      this._currentSeqNumber = this.minSeqNumber
      return this._calcId(this._lastTimeTick)
    }

    // 同一毫秒内序列号溢出，使用 > 判断，因为 _calcId 会先使用当前值再自增
    // 当 _currentSeqNumber = maxSeqNumber 时，还可以使用一次
    // 当 _currentSeqNumber = maxSeqNumber + 1 时才需要进位
    if (this._currentSeqNumber > this.maxSeqNumber) {
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

  /**
   * 钩子函数：开始漂移操作(可被子类重写)
   * @protected
   * @param {bigint} useTimeTick - 当前时间戳
   */
  protected _beginOverCostAction(useTimeTick: bigint): void {
    // 可重写此方法以实现自定义监控/日志
  }

  /**
   * 钩子函数：结束漂移操作(可被子类重写)
   * @protected
   * @param {bigint} useTimeTick - 当前时间戳
   */
  protected _endOverCostAction(useTimeTick: bigint): void {
    // 可重写此方法以实现自定义监控/日志
  }

  /**
   * 钩子函数：开始时钟回拨操作(可被子类重写)
   * @protected
   * @param {bigint} useTimeTick - 当前时间戳
   */
  protected _beginTurnBackAction(useTimeTick: bigint): void {
    // 可重写此方法以实现自定义监控/日志
  }

  /**
   * 钩子函数：结束时钟回拨操作(可被子类重写)
   * @protected
   * @param {bigint} useTimeTick - 当前时间戳
   */
  protected _endTurnBackAction(useTimeTick: bigint): void {
    // 可重写此方法以实现自定义监控/日志
  }

  /**
   * 生成下一个 ID
   *
   * @returns {number} 唯一 ID(Number 类型)
   * @throws {Error} 如果 ID 超出 JavaScript 安全整数范围
   *
   * @example
   * const id = genid.nextNumber();
   * console.log(id); // 123456789012345
   */
  nextNumber(): number {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()

    // JavaScript 安全整数范围：-(2^53-1) 到 2^53-1
    if (id >= 9007199254740992n) {
      throw new Error(
        `[GenidOptimized] 生成的 ID ${id.toString()} 超出 JavaScript 安全整数范围 (9007199254740992)。请使用 nextBigId() 方法。`
      )
    }

    return Number(id)
  }

  /**
   * 生成下一个 ID
   *
   * 如果 ID 在安全范围内返回 Number，否则返回 BigInt
   *
   * @returns {number|bigint} 唯一 ID
   *
   * @example
   * const id = genid.nextId();
   * console.log(typeof id); // 'number' 或 'bigint'
   */
  nextId(): number | bigint {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
    return id >= 9007199254740992n ? id : Number(id)
  }

  /**
   * 生成下一个 ID
   *
   * @returns {bigint} 唯一 ID(BigInt 类型)
   *
   * @example
   * const id = genid.nextBigId();
   * console.log(id); // 123456789012345678n
   */
  nextBigId(): bigint {
    return this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
  }

  /**
   * 批量生成 ID
   *
   * @param {number} count - 要生成的 ID 数量
   * @param {boolean} [asBigInt=false] - 是否返回 BigInt 数组
   * @returns {Array<number|bigint>} 唯一 ID 数组
   *
   * @example
   * const ids = genid.nextBatch(100);
   * const bigIds = genid.nextBatch(100, true);
   */
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
   * 解析 ID，提取其组成部分
   *
   * @param {number|bigint|string} id - 要解析的 ID
   * @returns {Object} 解析结果
   * @returns {Date} return.timestamp - 生成时间戳
   * @returns {number} return.timestampMs - 时间戳(毫秒)
   * @returns {number} return.workerId - 工作节点 ID
   * @returns {number} return.sequence - 序列号
   *
   * @example
   * const info = genid.parse(id);
   * console.log(info);
   * // {
   * //   timestamp: Date,
   * //   timestampMs: 1609459200000,
   * //   workerId: 1,
   * //   sequence: 42
   * // }
   */
  parse(id: number | bigint | string): ParseResult {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID 不能为负数')
    }

    // 使用位运算提取组件
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

  /**
   * 获取生成器统计信息
   *
   * @returns {Object} 统计数据
   *
   * @example
   * const stats = genid.getStats();
   * console.log(stats);
   */
  getStats(): StatsResult {
    const uptime = Date.now() - this._stats.startTime
    const totalGenerated = Number(this._stats.totalGenerated)

    return {
      totalGenerated, // 总生成 ID 数量
      overCostCount: Number(this._stats.overCostCount), // 漂移次数
      turnBackCount: Number(this._stats.turnBackCount), // 时钟回拨次数
      uptimeMs: uptime, // 运行时间(毫秒)
      avgPerSecond: uptime > 0 ? Math.floor((totalGenerated / uptime) * 1000) : 0, // 每秒平均生成数量
      currentState: this._isOverCost ? 'OVER_COST' : 'NORMAL', // 当前状态
    }
  }

  /**
   * 重置统计数据
   */
  resetStats(): void {
    this._stats = {
      totalGenerated: 0n,
      overCostCount: 0n,
      turnBackCount: 0n,
      startTime: Date.now(),
    }
  }

  /**
   * 获取配置信息
   *
   * @returns {Object} 配置详情
   */
  getConfig(): ConfigResult {
    const maxWorkerId = (1 << Number(this.workerIdBitLength)) - 1
    const maxSequence = (1 << Number(this.seqBitLength)) - 1
    const idsPerMs = Number(this.maxSeqNumber - this.minSeqNumber + 1n)

    return {
      method: Number(this.method) === GenidMethod.DRIFT ? 'DRIFT' : 'TRADITIONAL', // 算法类型
      workerId: Number(this.workerId), // 当前工作节点 ID
      workerIdRange: `0-${maxWorkerId}`, // 工作节点 ID 范围
      sequenceRange: `${Number(this.minSeqNumber)}-${Number(this.maxSeqNumber)}`, // 序列号范围
      maxSequence, // 最大序列号
      idsPerMillisecond: idsPerMs, // 每毫秒可生成 ID 数量
      baseTime: new Date(Number(this.baseTime)), // 起始时间
      timestampBits: 64 - Number(this.workerIdBitLength + this.seqBitLength), // 时间戳位数
      workerIdBits: Number(this.workerIdBitLength), // 工作节点 ID 位数
      sequenceBits: Number(this.seqBitLength), // 序列号位数
    }
  }

  /**
   * 将 ID 格式化为二进制字符串以便调试
   *
   * @param {number|bigint|string} id - 要格式化的 ID
   * @returns {string} 格式化的二进制表示
   */
  formatBinary(id: number | bigint | string): string {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID 不能为负数')
    }

    const binary = idBigInt.toString(2).padStart(64, '0')
    const parsed = this.parse(id)

    const timestampBits = 64 - Number(this.workerIdBitLength + this.seqBitLength)
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
