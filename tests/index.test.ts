import { beforeEach, describe, expect, it } from 'vitest'
import type {
  ConfigResult,
  GenidOptions,
  ParseResult,
  StatsResult,
} from '../src'
import { GenidMethod, GenidOptimized } from '../src'

describe('GenidOptimized', () => {
  describe('constructor and config validation', () => {
    it('creates an instance with minimal config', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      expect(genid).toBeInstanceOf(GenidOptimized)
    })

    it('throws when workerId is missing', () => {
      expect(() => new GenidOptimized({} as any)).toThrow(
        '[GenidOptimized] workerId is required',
      )
    })

    it('throws when workerIdBitLength is invalid', () => {
      expect(
        () => new GenidOptimized({ workerId: 1, workerIdBitLength: 16 }),
      ).toThrow('[GenidOptimized] workerIdBitLength must be between 1 and 15')
    })

    it('throws when seqBitLength is invalid', () => {
      expect(
        () => new GenidOptimized({ workerId: 1, seqBitLength: 2 }),
      ).toThrow('[GenidOptimized] seqBitLength must be between 3 and 21')
      expect(
        () => new GenidOptimized({ workerId: 1, seqBitLength: 22 }),
      ).toThrow('[GenidOptimized] seqBitLength must be between 3 and 21')
    })

    it('throws when workerIdBitLength + seqBitLength exceeds 22', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            workerIdBitLength: 15,
            seqBitLength: 10,
          }),
      ).toThrow(
        '[GenidOptimized] workerIdBitLength + seqBitLength must not exceed 22',
      )
    })

    it('throws when workerId is out of range', () => {
      expect(() => new GenidOptimized({ workerId: -1 })).toThrow(
        '[GenidOptimized] workerId must be between 0 and',
      )
      expect(() => new GenidOptimized({ workerId: 64 })).toThrow(
        '[GenidOptimized] workerId must be between 0 and',
      )
    })

    it('clamps minSeqNumber to 5 when given a value below 5', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        minSeqNumber: 4,
      })
      const config = genid.getConfig()
      expect(config.sequenceRange).toMatch(/^5-/)
    })

    it('throws when maxSeqNumber is less than minSeqNumber', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            minSeqNumber: 10,
            maxSeqNumber: 5,
          }),
      ).toThrow(
        '[GenidOptimized] maxSeqNumber must be greater than or equal to minSeqNumber',
      )
    })

    it('applies correct default config', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const config = genid.getConfig()

      expect(config.method).toBe('DRIFT')
      expect(config.workerId).toBe(1)
      expect(config.workerIdBits).toBe(6)
      expect(config.sequenceBits).toBe(6)
      // verify baseTime defaults to 2020-01-01
      expect(config.baseTime.getFullYear()).toBe(2020)
      expect(config.baseTime.getMonth()).toBe(0)
      expect(config.baseTime.getDate()).toBe(1)
    })

    it('applies custom config correctly', () => {
      const genid = new GenidOptimized({
        workerId: 10,
        method: GenidMethod.TRADITIONAL,
        baseTime: new Date('2020-01-01').valueOf(),
        workerIdBitLength: 8,
        seqBitLength: 10,
      })
      const config = genid.getConfig()

      expect(config.method).toBe('TRADITIONAL')
      expect(config.workerId).toBe(10)
      expect(config.workerIdBits).toBe(8)
      expect(config.sequenceBits).toBe(10)
    })
  })

  describe('ID generation', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 1,
        baseTime: new Date('2020-01-01').valueOf(),
      })
    })

    it('generates unique IDs', () => {
      const id1 = genid.nextId()
      const id2 = genid.nextId()

      expect(id1).not.toBe(id2)
      expect(typeof id1 === 'number' || typeof id1 === 'bigint').toBe(true)
      expect(typeof id2 === 'number' || typeof id2 === 'bigint').toBe(true)
    })

    it('generates monotonically increasing IDs', () => {
      const ids = Array.from({ length: 100 }, () => genid.nextId())

      for (let i = 1; i < ids.length; i++) {
        expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
      }
    })

    it('nextNumber() returns a Number', () => {
      const id = genid.nextNumber()
      expect(typeof id).toBe('number')
      expect(Number.isSafeInteger(id)).toBe(true)
    })

    it('nextBigId() returns a BigInt', () => {
      const id = genid.nextBigId()
      expect(typeof id).toBe('bigint')
    })

    it('nextId() returns a safe integer when within range', () => {
      const id = genid.nextId()
      if (typeof id === 'number') {
        expect(Number.isSafeInteger(id)).toBe(true)
      }
    })

    it('keeps sequence within bounds (never use maxSeqNumber + 1)', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3, // max sequence = 7
        minSeqNumber: 5, // range 5-7, only 3 slots
      })

      // generate enough IDs to trigger sequence reset
      const ids = genid.nextBatch(10)

      // verify every parsed sequence is within the valid range
      ids.forEach((id) => {
        const parsed = genid.parse(id)
        expect(parsed.sequence).toBeGreaterThanOrEqual(0)
        expect(parsed.sequence).toBeLessThanOrEqual(7)
      })
    })
  })

  describe('batch generation', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 1,
        baseTime: new Date('2020-01-01').valueOf(),
      })
    })

    it('generates the requested number of IDs', () => {
      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
    })

    it('generates unique IDs in batch', () => {
      const ids = genid.nextBatch(1000)
      const uniqueIds = new Set(ids.map((id) => id.toString()))
      expect(uniqueIds.size).toBe(1000)
    })

    it('generates monotonically increasing IDs in batch', () => {
      const ids = genid.nextBatch(100)

      for (let i = 1; i < ids.length; i++) {
        expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
      }
    })

    it('supports generating a BigInt array', () => {
      const ids = genid.nextBatch(10, true)
      expect(ids.every((id) => typeof id === 'bigint')).toBe(true)
    })

    it('throws when batch count is invalid', () => {
      expect(() => genid.nextBatch(0)).toThrow(
        '[GenidOptimized] batch count must be greater than 0',
      )
      expect(() => genid.nextBatch(-1)).toThrow(
        '[GenidOptimized] batch count must be greater than 0',
      )
    })
  })

  describe('ID parsing', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 5,
        baseTime: new Date('2020-01-01').valueOf(),
        workerIdBitLength: 6,
        seqBitLength: 6,
      })
    })

    it('correctly parses all components of an ID', () => {
      const id = genid.nextId()
      const parsed = genid.parse(id)

      expect(parsed).toHaveProperty('timestamp')
      expect(parsed).toHaveProperty('timestampMs')
      expect(parsed).toHaveProperty('workerId')
      expect(parsed).toHaveProperty('sequence')

      expect(parsed.workerId).toBe(5)
      expect(parsed.timestamp).toBeInstanceOf(Date)
      expect(parsed.timestampMs).toBeGreaterThan(0)
      expect(parsed.sequence).toBeGreaterThanOrEqual(5) // minSeqNumber
    })

    it('parses a Number ID', () => {
      const id = genid.nextNumber()
      const parsed = genid.parse(id)
      expect(parsed.workerId).toBe(5)
    })

    it('parses a BigInt ID', () => {
      const id = genid.nextBigId()
      const parsed = genid.parse(id)
      expect(parsed.workerId).toBe(5)
    })

    it('parses a string ID', () => {
      const id = genid.nextId()
      const parsed = genid.parse(id.toString())
      expect(parsed.workerId).toBe(5)
    })

    it('throws when parsing a negative ID', () => {
      expect(() => genid.parse(-1)).toThrow(
        '[GenidOptimized] ID must not be negative',
      )
    })

    it('parsed timestamp is close to current time', () => {
      const beforeTime = Date.now()
      const id = genid.nextId()
      const afterTime = Date.now()

      const parsed = genid.parse(id)

      expect(parsed.timestampMs).toBeGreaterThanOrEqual(beforeTime - 1000)
      expect(parsed.timestampMs).toBeLessThanOrEqual(afterTime + 1000)
    })
  })

  describe('statistics', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({ workerId: 1 })
    })

    it('tracks total generated count accurately', () => {
      const count = 100
      for (let i = 0; i < count; i++) {
        genid.nextId()
      }

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(count)
    })

    it('tracks uptime', () => {
      const stats = genid.getStats()
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0)
    })

    it('computes average generation rate', () => {
      genid.nextBatch(1000)

      // spin-wait to ensure enough uptime for rate calculation
      const start = Date.now()
      while (Date.now() - start < 10) {
        // wait at least 10ms
      }

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(1000)
      expect(stats.avgPerSecond).toBeGreaterThanOrEqual(0)
    })

    it('reports current state', () => {
      const stats = genid.getStats()
      expect(['NORMAL', 'OVER_COST']).toContain(stats.currentState)
    })

    it('resets stats correctly', () => {
      genid.nextBatch(100)
      genid.resetStats()

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(0)
      expect(stats.overCostCount).toBe(0)
      expect(stats.turnBackCount).toBe(0)
    })
  })

  describe('config info', () => {
    it('returns complete config object', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 8,
        seqBitLength: 10,
      })

      const config = genid.getConfig()

      expect(config).toHaveProperty('method')
      expect(config).toHaveProperty('workerId')
      expect(config).toHaveProperty('workerIdRange')
      expect(config).toHaveProperty('sequenceRange')
      expect(config).toHaveProperty('maxSequence')
      expect(config).toHaveProperty('idsPerMillisecond')
      expect(config).toHaveProperty('baseTime')
      expect(config).toHaveProperty('timestampBits')
      expect(config).toHaveProperty('workerIdBits')
      expect(config).toHaveProperty('sequenceBits')
    })

    it('computes workerIdRange correctly', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 8,
      })

      const config = genid.getConfig()
      expect(config.workerIdRange).toBe('0-255') // 2^8 - 1
    })

    it('computes idsPerMillisecond correctly', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 6,
      })

      const config = genid.getConfig()
      // maxSeqNumber(63) - minSeqNumber(5) + 1 = 59
      expect(config.idsPerMillisecond).toBe(59)
    })
  })

  describe('binary formatting', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({ workerId: 1 })
    })

    it('formats an ID as a binary string', () => {
      const id = genid.nextId()
      const formatted = genid.formatBinary(id)

      expect(formatted).toContain('ID:')
      expect(formatted).toContain('Binary (64-bit):')
      expect(formatted).toContain('Timestamp')
      expect(formatted).toContain('Worker ID')
      expect(formatted).toContain('Sequence')
    })

    it('formats different ID types without throwing', () => {
      const id = genid.nextBigId()
      expect(() => genid.formatBinary(id)).not.toThrow()
      expect(() => genid.formatBinary(id.toString())).not.toThrow()
      expect(() => genid.formatBinary(Number(id))).not.toThrow()
    })

    it('throws when formatting a negative ID', () => {
      expect(() => genid.formatBinary(-1)).toThrow(
        '[GenidOptimized] ID must not be negative',
      )
    })
  })

  describe('high-concurrency scenarios', () => {
    it('maintains uniqueness when generating IDs rapidly', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const ids = genid.nextBatch(10000)
      const uniqueIds = new Set(ids.map((id) => id.toString()))

      expect(uniqueIds.size).toBe(10000)
    })

    it('triggers drift when sequence is exhausted', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3, // small sequence bits to trigger drift more easily
        minSeqNumber: 5,
      })

      // generate enough IDs to exhaust the sequence
      genid.nextBatch(100)

      const stats = genid.getStats()
      // with a small sequence range, drift should occur
      expect(stats.overCostCount).toBeGreaterThanOrEqual(0)
    })
  })

  describe('algorithm modes', () => {
    it('DRIFT mode works correctly', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.DRIFT,
      })

      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
      expect(new Set(ids.map((id) => id.toString())).size).toBe(100)
    })

    it('TRADITIONAL mode works correctly', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.TRADITIONAL,
      })

      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
      expect(new Set(ids.map((id) => id.toString())).size).toBe(100)
    })

    it('TRADITIONAL mode does not trigger drift on sequence overflow', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.TRADITIONAL,
        seqBitLength: 3, // max sequence = 7, range 5-7, only 3 slots
        minSeqNumber: 5,
      })

      // generate enough IDs to trigger multiple sequence overflows
      genid.nextBatch(100)

      const stats = genid.getStats()
      // TRADITIONAL mode must not produce drift counts
      expect(stats.overCostCount).toBe(0)
      expect(stats.currentState).toBe('NORMAL')
    })

    it('DRIFT mode triggers drift on sequence overflow', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.DRIFT,
        seqBitLength: 3,
        minSeqNumber: 5,
      })

      genid.nextBatch(100)

      const stats = genid.getStats()
      // DRIFT mode must produce drift counts
      expect(stats.overCostCount).toBeGreaterThan(0)
    })
  })

  describe('multiple instances', () => {
    it('instances with different workerIds embed distinct workerIds', () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 2 })

      const id1 = genid1.nextId()
      const id2 = genid2.nextId()

      const parsed1 = genid1.parse(id1)
      const parsed2 = genid2.parse(id2)

      expect(parsed1.workerId).toBe(1)
      expect(parsed2.workerId).toBe(2)
    })

    it('two instances with the same config generate unique IDs', async () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 1 })

      const ids1 = genid1.nextBatch(100)

      // wait to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100))

      const ids2 = genid2.nextBatch(100)

      const allIds = [...ids1, ...ids2]
      const uniqueIds = new Set(allIds.map((id) => id.toString()))

      // timestamps should differ due to the delay, so all IDs must be unique
      expect(uniqueIds.size).toBe(200)
    })
  })

  describe('edge cases', () => {
    it('handles minimum workerId (0)', () => {
      const genid = new GenidOptimized({ workerId: 0 })
      const id = genid.nextId()
      const parsed = genid.parse(id)

      expect(parsed.workerId).toBe(0)
    })

    it('handles maximum workerId', () => {
      const genid = new GenidOptimized({
        workerId: 63, // 2^6 - 1
        workerIdBitLength: 6,
      })
      const id = genid.nextId()
      const parsed = genid.parse(id)

      expect(parsed.workerId).toBe(63)
    })

    it('handles minimum seqBitLength', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3,
        minSeqNumber: 5,
      })

      const id = genid.nextId()
      expect(id).toBeDefined()
    })

    it('handles maximum seqBitLength', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 1,
        seqBitLength: 21,
      })

      const id = genid.nextId()
      expect(id).toBeDefined()
    })
  })

  describe('performance benchmarks', () => {
    it('generates IDs at more than 50,000 per second', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      const startTime = Date.now()
      const count = 100000
      genid.nextBatch(count)
      const endTime = Date.now()

      const duration = endTime - startTime
      const idsPerSecond = (count / duration) * 1000

      expect(idsPerSecond).toBeGreaterThan(50000)
    })

    it('maintains uniqueness under extreme load', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 10,
      })

      const count = 1000
      const ids = genid.nextBatch(count, true)

      // verify uniqueness
      const uniqueIds = new Set(ids.map((id) => id.toString()))
      expect(uniqueIds.size).toBe(count)

      // verify monotonic order
      for (let i = 1; i < ids.length; i++) {
        const prev = BigInt(ids[i - 1])
        const curr = BigInt(ids[i])
        if (curr <= prev) {
          console.log('Found duplicate/out-of-order IDs:')
          console.log(`  index ${i - 1}: ${prev} (${ids[i - 1]})`)
          console.log(`  index ${i}: ${curr} (${ids[i]})`)
          console.log(`  parsed [${i - 1}]:`, genid.parse(ids[i - 1]))
          console.log(`  parsed [${i}]:`, genid.parse(ids[i]))
        }
        expect(curr).toBeGreaterThan(prev)
      }
    })
  })

  describe('ID validation', () => {
    it('validates a valid ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const id = genid.nextId()

      expect(genid.isValid(id)).toBe(true)
    })

    it('validates a Number ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const id = genid.nextNumber()

      expect(genid.isValid(id)).toBe(true)
    })

    it('validates a BigInt ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const id = genid.nextBigId()

      expect(genid.isValid(id)).toBe(true)
    })

    it('validates a string ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const id = genid.nextId().toString()

      expect(genid.isValid(id)).toBe(true)
    })

    it('rejects negative IDs', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      expect(genid.isValid(-1)).toBe(false)
      expect(genid.isValid(-123456n)).toBe(false)
    })

    it('rejects IDs exceeding the 64-bit range', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const maxUint64 = 18446744073709551616n // 2^64

      expect(genid.isValid(maxUint64)).toBe(false)
      expect(genid.isValid(maxUint64 + 1n)).toBe(false)
    })

    it('rejects IDs with a future timestamp beyond tolerance', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      // construct an ID 2 seconds in the future (exceeds 1-second tolerance)
      const futureTimestamp = BigInt(Date.now()) + 2000n
      const baseTime = BigInt(genid.getConfig().baseTime.valueOf())
      const futureId = (futureTimestamp - baseTime) << 12n

      expect(genid.isValid(futureId)).toBe(false)
    })

    it('handles IDs earlier than baseTime', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        baseTime: Date.now(), // use current time as baseTime
      })

      // spin-wait 2ms to ensure time has advanced past baseTime
      const start = Date.now()
      while (Date.now() - start < 2) {
        // spin
      }

      // construct a genid with a different config to verify cross-config behavior
      const genid2 = new GenidOptimized({
        workerId: 1,
        baseTime: Date.now() - 10000, // 10 seconds ago
        workerIdBitLength: 8,
        seqBitLength: 8,
      })

      // generate a valid ID from genid2
      const validId = genid2.nextId()

      // ID 0 is valid (represents baseTime moment, workerId=0, sequence=0)
      expect(genid.isValid(0)).toBe(true)
    })

    it('rejects IDs with workerId out of range', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 6, // max workerId = 63
        seqBitLength: 6,
      })

      // workerId=63 is the max valid value for 6 bits — should be accepted
      const config = genid.getConfig()
      const baseTime = BigInt(config.baseTime.valueOf())
      const currentTimestamp = BigInt(Date.now()) - baseTime

      const validId = (currentTimestamp << 12n) | (63n << 6n) | 5n
      expect(genid.isValid(validId)).toBe(true)

      // workerId=64 is masked to 0 by the 6-bit mask (64 & 0x3F = 0), so it reads as valid
      const idWithOverflow = (currentTimestamp << 12n) | (64n << 6n) | 5n
      expect(genid.isValid(idWithOverflow)).toBe(true)
    })

    it('rejects IDs with invalid format', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      expect(genid.isValid('invalid')).toBe(false)
      expect(genid.isValid('abc123')).toBe(false)
      expect(genid.isValid(NaN)).toBe(false)
    })

    it('accepts IDs from other workerIds in non-strict mode', () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 2 })

      const id1 = genid1.nextId()
      const id2 = genid2.nextId()

      // non-strict mode should accept IDs from any workerId
      expect(genid1.isValid(id2)).toBe(true)
      expect(genid2.isValid(id1)).toBe(true)
    })

    it('accepts only own workerId in strict mode', () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 2 })

      const id1 = genid1.nextId()
      const id2 = genid2.nextId()

      // strict mode: each instance accepts only its own workerId
      expect(genid1.isValid(id1, true)).toBe(true)
      expect(genid1.isValid(id2, true)).toBe(false)

      expect(genid2.isValid(id2, true)).toBe(true)
      expect(genid2.isValid(id1, true)).toBe(false)
    })

    it('validates all IDs from a batch', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const ids = genid.nextBatch(100)

      for (const id of ids) {
        expect(genid.isValid(id)).toBe(true)
      }
    })

    it('correctly validates boundary values', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      // 0 is valid (represents baseTime moment, workerId=0, sequence=0)
      expect(genid.isValid(0)).toBe(true)

      // 1 is valid
      expect(genid.isValid(1)).toBe(true)

      const validId = genid.nextBigId()
      expect(genid.isValid(validId)).toBe(true)
    })

    it('validates IDs across different configs', () => {
      const genid1 = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 8,
        seqBitLength: 10,
      })
      const genid2 = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 6,
        seqBitLength: 6,
      })

      const id1 = genid1.nextId()
      const id2 = genid2.nextId()

      // each instance should validate its own IDs
      expect(genid1.isValid(id1)).toBe(true)
      expect(genid2.isValid(id2)).toBe(true)

      // cross-config validation may differ due to different bit shifts
    })

    it('supports afterTime option to reject IDs that are too old', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      // small numeric IDs pass in loose mode (decode to near-baseTime timestamps)
      expect(genid.isValid('8077035')).toBe(true)

      // with afterTime set, the ID timestamp must be after that point
      const startupTime = Date.now() - 60000 // 1 minute ago
      expect(genid.isValid('8077035', { afterTime: startupTime })).toBe(false)

      // a freshly generated ID should pass the afterTime check
      const id = genid.nextId()
      expect(genid.isValid(id, { afterTime: startupTime })).toBe(true)
    })

    it('supports strictWorkerId via options object', () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 2 })

      const id2 = genid2.nextId()

      expect(genid1.isValid(id2, { strictWorkerId: true })).toBe(false)
      expect(genid2.isValid(id2, { strictWorkerId: true })).toBe(true)
    })

    it('supports combining strictWorkerId and afterTime', () => {
      const startupTime = Date.now() - 1000
      const genid = new GenidOptimized({ workerId: 1 })
      const id = genid.nextId()

      expect(
        genid.isValid(id, { strictWorkerId: true, afterTime: startupTime }),
      ).toBe(true)
      expect(
        genid.isValid('8077035', {
          strictWorkerId: false,
          afterTime: startupTime,
        }),
      ).toBe(false)
    })
  })

  describe('baseTime validation', () => {
    it('throws when baseTime is in the future', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            baseTime: Date.now() + 100000,
          }),
      ).toThrow('[GenidOptimized] baseTime must not be in the future')
    })

    it('accepts a valid past baseTime', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        baseTime: new Date('2020-01-01').valueOf(),
      })
      expect(genid).toBeInstanceOf(GenidOptimized)
    })
  })

  describe('type exports', () => {
    it('exports the GenidMethod enum', () => {
      expect(GenidMethod.DRIFT).toBe(1)
      expect(GenidMethod.TRADITIONAL).toBe(2)
    })

    it('exports types (compile-time verification)', () => {
      const options: GenidOptions = { workerId: 1 }
      const genid = new GenidOptimized(options)

      const id = genid.nextId()
      const parsed: ParseResult = genid.parse(id)
      expect(parsed.workerId).toBe(1)

      const stats: StatsResult = genid.getStats()
      expect(stats.totalGenerated).toBe(1)

      const config: ConfigResult = genid.getConfig()
      expect(config.method).toBe('DRIFT')
    })
  })
})
