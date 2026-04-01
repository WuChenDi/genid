import { initConfig, validateConfig } from './config'
import type {
  ConfigResult,
  GenidConfig,
  GenidOptions,
  ParseResult,
  Stats,
  StatsResult,
  ValidateOptions,
} from './types'
import { GenidMethod } from './types'

/**
 * Distributed unique ID generator based on the Snowflake algorithm.
 *
 * - Drift mode: borrows future timestamps under high concurrency to exceed the
 *   per-millisecond sequence limit.
 * - Clock rollback: uses reserved sequence numbers (0-4) for graceful degradation
 *   without blocking generation.
 * - Not thread-safe; each worker/process should use a separate instance with a
 *   distinct workerId.
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
      throw new Error('[GenidOptimized] workerId is required')
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

  /** Returns the current timestamp relative to baseTime. */
  private _getCurrentTimeTick(): bigint {
    return BigInt(Date.now()) - this.baseTime
  }

  /** Spin-waits until the clock advances to the next millisecond. */
  private _getNextTimeTick(): bigint {
    let timeTick = this._getCurrentTimeTick()
    let spinCount = 0
    const maxSpinCount = 1000000

    while (timeTick <= this._lastTimeTick) {
      spinCount++
      // Guard against an abnormal system clock causing an infinite loop.
      if (spinCount > maxSpinCount) {
        return this._lastTimeTick + 1n
      }
      timeTick = this._getCurrentTimeTick()
    }
    return timeTick
  }

  /** Assembles an ID as timestamp | workerId | sequence, then increments the sequence. */
  private _calcId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      this._currentSeqNumber

    this._currentSeqNumber++
    this._stats.totalGenerated++

    return result
  }

  /** Assembles an ID during a clock-rollback event using reserved sequence numbers (0-4) to avoid conflicts. */
  private _calcTurnBackId(useTimeTick: bigint): bigint {
    const result =
      (BigInt(useTimeTick) << this._timestampShift) +
      (this.workerId << this.seqBitLength) +
      BigInt(this._turnBackIndex)

    this._turnBackTimeTick++
    this._stats.totalGenerated++
    return result
  }

  /** Generates an ID while in drift (over-cost) mode. */
  private _nextOverCostId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // Clock has advanced — exhaust the current sequence then return to normal mode.
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

    // Drift count has reached the cap — force a wait for the next millisecond.
    if (this._overCostCountInOneTerm >= this.topOverCostCount) {
      this._endOverCostAction(currentTimeTick)
      this._lastTimeTick = this._getNextTimeTick()
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = false
      this._overCostCountInOneTerm = 0n
      return this._calcId(this._lastTimeTick)
    }

    // Sequence exhausted — borrow the next millisecond's timestamp.
    if (this._currentSeqNumber > this.maxSeqNumber) {
      this._lastTimeTick++
      this._currentSeqNumber = this.minSeqNumber
      this._isOverCost = true
      this._overCostCountInOneTerm++
      return this._calcId(this._lastTimeTick)
    }

    return this._calcId(this._lastTimeTick)
  }

  /** Generates an ID in normal mode. */
  private _nextNormalId(): bigint {
    const currentTimeTick = this._getCurrentTimeTick()

    // Handle clock rollback.
    if (currentTimeTick < this._lastTimeTick) {
      if (this._turnBackTimeTick < 1) {
        this._turnBackTimeTick = this._lastTimeTick - 1n
        this._turnBackIndex++

        // Reserved sequence slots (1-4) exhausted — fall back to waiting mode.
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

      // Turn-back timestamp is about to overtake the normal timestamp — force a wait to prevent ID collisions.
      if (this._turnBackTimeTick >= this._lastTimeTick) {
        this._turnBackTimeTick = 0n
        this._turnBackIndex = 0
        this._lastTimeTick = this._getNextTimeTick()
        this._currentSeqNumber = this.minSeqNumber
        return this._calcId(this._lastTimeTick)
      }

      return this._calcTurnBackId(this._turnBackTimeTick)
    }

    // Clock has caught up — clear the rollback state.
    if (this._turnBackTimeTick > 0) {
      this._endTurnBackAction(this._turnBackTimeTick)
      this._turnBackTimeTick = 0n
      this._turnBackIndex = 0
    }

    // Clock advanced — reset the sequence.
    if (currentTimeTick > this._lastTimeTick) {
      this._lastTimeTick = currentTimeTick
      this._currentSeqNumber = this.minSeqNumber
      return this._calcId(this._lastTimeTick)
    }

    // Sequence exhausted (_calcId increments after use, so > maxSeq triggers carry).
    if (this._currentSeqNumber > this.maxSeqNumber) {
      if (this.method === BigInt(GenidMethod.TRADITIONAL)) {
        this._lastTimeTick = this._getNextTimeTick()
        this._currentSeqNumber = this.minSeqNumber
        return this._calcId(this._lastTimeTick)
      }

      // Drift mode: borrow the next millisecond's timestamp.
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

  // ---- Lifecycle hooks (subclasses may override for monitoring/logging) ----

  protected _beginOverCostAction(_useTimeTick: bigint): void {}
  protected _endOverCostAction(_useTimeTick: bigint): void {}
  protected _beginTurnBackAction(_useTimeTick: bigint): void {}
  protected _endTurnBackAction(_useTimeTick: bigint): void {}

  /**
   * Generates an ID and returns it as a number.
   * Throws if the ID exceeds the safe integer range.
   * @throws When ID >= Number.MAX_SAFE_INTEGER + 1
   */
  nextNumber(): number {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()

    if (id >= 9007199254740992n) {
      throw new Error(
        `[GenidOptimized] Generated ID ${id.toString()} exceeds the JavaScript safe integer range (9007199254740992). Use nextBigId() instead.`,
      )
    }

    return Number(id)
  }

  /** Generates an ID and returns a number if within safe range, otherwise a bigint. */
  nextId(): number | bigint {
    const id = this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
    return id >= 9007199254740992n ? id : Number(id)
  }

  /** Generates an ID and always returns a bigint. */
  nextBigId(): bigint {
    return this._isOverCost ? this._nextOverCostId() : this._nextNormalId()
  }

  /** Generates a batch of IDs. */
  nextBatch(count: number, asBigInt: boolean = false): Array<number | bigint> {
    if (count <= 0) {
      throw new Error('[GenidOptimized] batch count must be greater than 0')
    }

    const ids: Array<number | bigint> = []
    for (let i = 0; i < count; i++) {
      ids.push(asBigInt ? this.nextBigId() : this.nextId())
    }

    return ids
  }

  /**
   * Parses an ID and extracts its timestamp, workerId, and sequence number.
   *
   * @example
   * genid.parse(id)
   * // { timestamp: Date, timestampMs: 1609459200000, workerId: 1, sequence: 42 }
   */
  parse(id: number | bigint | string): ParseResult {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID must not be negative')
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

  /** Returns runtime statistics. */
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

  /** Resets the statistics counters. */
  resetStats(): void {
    this._stats = {
      totalGenerated: 0n,
      overCostCount: 0n,
      turnBackCount: 0n,
      startTime: Date.now(),
    }
  }

  /** Returns the current configuration. */
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
   * Validates whether an ID is a valid Snowflake ID under the current configuration.
   *
   * @param options - Validation options, or a boolean for strictWorkerId (backward-compatible).
   *
   * @example
   * genid.isValid(id)                            // loose validation
   * genid.isValid(id, true)                      // require workerId match
   * genid.isValid(id, { strictWorkerId: true })  // same as above
   * genid.isValid(id, { afterTime: startupTime }) // require ID generation time after startupTime
   */
  isValid(
    id: number | bigint | string,
    options: boolean | ValidateOptions = false,
  ): boolean {
    try {
      const opts: ValidateOptions =
        typeof options === 'boolean' ? { strictWorkerId: options } : options

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

      // Allow a 1-second drift tolerance.
      const currentTime = BigInt(Date.now())
      if (timestamp > currentTime + 1000n) return false

      // afterTime: the ID's generation time must not be earlier than the specified time.
      if (opts.afterTime != null && timestamp < BigInt(opts.afterTime)) {
        return false
      }

      const maxWorkerId = (1n << this.workerIdBitLength) - 1n
      if (workerId > maxWorkerId) return false
      if (opts.strictWorkerId && workerId !== this.workerId) return false

      const maxSeq = (1n << this.seqBitLength) - 1n
      if (sequence > maxSeq) return false

      return true
    } catch {
      return false
    }
  }

  /** Formats an ID as an annotated binary string (useful for debugging). */
  formatBinary(id: number | bigint | string): string {
    const idBigInt = BigInt(id)

    if (idBigInt < 0n) {
      throw new Error('[GenidOptimized] ID must not be negative')
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
      `${binary.slice(0, timestampBits)} - Timestamp (${timestampBits} bits) = ${parsed.timestamp.toISOString()}`,
      `${binary.slice(timestampBits, workerIdStart + Number(this.workerIdBitLength))} - Worker ID (${this.workerIdBitLength} bits) = ${parsed.workerId}`,
      `${binary.slice(seqStart)} - Sequence (${this.seqBitLength} bits) = ${parsed.sequence}`,
    ].join('\n')
  }
}
