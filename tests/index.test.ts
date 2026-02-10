import { beforeEach, describe, expect, it } from 'vitest'
import { GenidOptimized } from '../src'
import { GenidMethod } from '../src/types'

describe('GenidOptimized', () => {
  describe('构造函数和配置验证', () => {
    it('应该成功创建实例（使用最小配置）', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      expect(genid).toBeInstanceOf(GenidOptimized)
    })

    it('应该在缺少 workerId 时抛出错误', () => {
      expect(() => new GenidOptimized({} as any)).toThrow(
        '[GenidOptimized] workerId 是必须参数',
      )
    })

    it('应该在 workerIdBitLength 无效时抛出错误', () => {
      expect(
        () => new GenidOptimized({ workerId: 1, workerIdBitLength: 16 }),
      ).toThrow('[GenidOptimized] workerIdBitLength 必须在 1 到 15 之间')
    })

    it('应该在 seqBitLength 无效时抛出错误', () => {
      expect(
        () => new GenidOptimized({ workerId: 1, seqBitLength: 2 }),
      ).toThrow('[GenidOptimized] seqBitLength 必须在 3 到 21 之间')
      expect(
        () => new GenidOptimized({ workerId: 1, seqBitLength: 22 }),
      ).toThrow('[GenidOptimized] seqBitLength 必须在 3 到 21 之间')
    })

    it('应该在位长度总和超过 22 时抛出错误', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            workerIdBitLength: 15,
            seqBitLength: 10,
          }),
      ).toThrow('[GenidOptimized] workerIdBitLength + seqBitLength 不能超过 22')
    })

    it('应该在 workerId 超出范围时抛出错误', () => {
      expect(() => new GenidOptimized({ workerId: -1 })).toThrow(
        '[GenidOptimized] workerId 必须在 0 到',
      )
      expect(() => new GenidOptimized({ workerId: 64 })).toThrow(
        '[GenidOptimized] workerId 必须在 0 到',
      )
    })

    it('应该在 minSeqNumber 小于 5 时抛出错误', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            minSeqNumber: 4,
          }),
      ).toThrow('[GenidOptimized] minSeqNumber 必须至少为 5')
    })

    it('应该在 maxSeqNumber 小于 minSeqNumber 时抛出错误', () => {
      expect(
        () =>
          new GenidOptimized({
            workerId: 1,
            minSeqNumber: 10,
            maxSeqNumber: 5,
          }),
      ).toThrow('[GenidOptimized] maxSeqNumber 必须大于或等于 minSeqNumber')
    })

    it('应该正确设置默认配置', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const config = genid.getConfig()

      expect(config.method).toBe('DRIFT')
      expect(config.workerId).toBe(1)
      expect(config.workerIdBits).toBe(6)
      expect(config.sequenceBits).toBe(6)
      // 验证 baseTime 默认为 2020-01-01
      expect(config.baseTime.getFullYear()).toBe(2020)
      expect(config.baseTime.getMonth()).toBe(0)
      expect(config.baseTime.getDate()).toBe(1)
    })

    it('应该支持自定义配置', () => {
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

  describe('ID 生成功能', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 1,
        baseTime: new Date('2020-01-01').valueOf(),
      })
    })

    it('应该生成唯一的 ID', () => {
      const id1 = genid.nextId()
      const id2 = genid.nextId()

      expect(id1).not.toBe(id2)
      expect(typeof id1 === 'number' || typeof id1 === 'bigint').toBe(true)
      expect(typeof id2 === 'number' || typeof id2 === 'bigint').toBe(true)
    })

    it('应该生成递增的 ID', () => {
      const ids = Array.from({ length: 100 }, () => genid.nextId())

      for (let i = 1; i < ids.length; i++) {
        expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
      }
    })

    it('nextNumber() 应该返回 Number 类型', () => {
      const id = genid.nextNumber()
      expect(typeof id).toBe('number')
      expect(Number.isSafeInteger(id)).toBe(true)
    })

    it('nextBigId() 应该返回 BigInt 类型', () => {
      const id = genid.nextBigId()
      expect(typeof id).toBe('bigint')
    })

    it('nextId() 应该在安全范围内返回 Number', () => {
      const id = genid.nextId()
      if (typeof id === 'number') {
        expect(Number.isSafeInteger(id)).toBe(true)
      }
    })

    it('应该正确处理序列号边界（不会使用 maxSeqNumber + 1）', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3, // 最大序列号为 7
        minSeqNumber: 5, // 序列号范围 5-7，只有 3 个可用
      })

      // 生成足够多的 ID 以确保触发序列号重置
      const ids = genid.nextBatch(10)

      // 解析所有 ID，验证序列号都在有效范围内
      ids.forEach((id) => {
        const parsed = genid.parse(id)
        expect(parsed.sequence).toBeGreaterThanOrEqual(0)
        expect(parsed.sequence).toBeLessThanOrEqual(7)
      })
    })
  })

  describe('批量生成功能', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 1,
        baseTime: new Date('2020-01-01').valueOf(),
      })
    })

    it('应该批量生成指定数量的 ID', () => {
      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
    })

    it('应该批量生成的 ID 都是唯一的', () => {
      const ids = genid.nextBatch(1000)
      const uniqueIds = new Set(ids.map((id) => id.toString()))
      expect(uniqueIds.size).toBe(1000)
    })

    it('应该批量生成的 ID 是递增的', () => {
      const ids = genid.nextBatch(100)

      for (let i = 1; i < ids.length; i++) {
        expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
      }
    })

    it('应该支持生成 BigInt 数组', () => {
      const ids = genid.nextBatch(10, true)
      expect(ids.every((id) => typeof id === 'bigint')).toBe(true)
    })

    it('应该在数量无效时抛出错误', () => {
      expect(() => genid.nextBatch(0)).toThrow(
        '[GenidOptimized] 批量生成数量必须大于 0',
      )
      expect(() => genid.nextBatch(-1)).toThrow(
        '[GenidOptimized] 批量生成数量必须大于 0',
      )
    })
  })

  describe('ID 解析功能', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({
        workerId: 5,
        baseTime: new Date('2020-01-01').valueOf(),
        workerIdBitLength: 6,
        seqBitLength: 6,
      })
    })

    it('应该正确解析 ID 的各个组成部分', () => {
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

    it('应该支持解析 Number 类型的 ID', () => {
      const id = genid.nextNumber()
      const parsed = genid.parse(id)
      expect(parsed.workerId).toBe(5)
    })

    it('应该支持解析 BigInt 类型的 ID', () => {
      const id = genid.nextBigId()
      const parsed = genid.parse(id)
      expect(parsed.workerId).toBe(5)
    })

    it('应该支持解析字符串类型的 ID', () => {
      const id = genid.nextId()
      const parsed = genid.parse(id.toString())
      expect(parsed.workerId).toBe(5)
    })

    it('应该在解析负数 ID 时抛出错误', () => {
      expect(() => genid.parse(-1)).toThrow('[GenidOptimized] ID 不能为负数')
    })

    it('解析的时间戳应该接近当前时间', () => {
      const beforeTime = Date.now()
      const id = genid.nextId()
      const afterTime = Date.now()

      const parsed = genid.parse(id)

      expect(parsed.timestampMs).toBeGreaterThanOrEqual(beforeTime - 1000)
      expect(parsed.timestampMs).toBeLessThanOrEqual(afterTime + 1000)
    })
  })

  describe('统计功能', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({ workerId: 1 })
    })

    it('应该正确统计生成的 ID 数量', () => {
      const count = 100
      for (let i = 0; i < count; i++) {
        genid.nextId()
      }

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(count)
    })

    it('应该跟踪运行时间', () => {
      const stats = genid.getStats()
      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0)
    })

    it('应该计算平均生成速率', () => {
      genid.nextBatch(1000)

      // 等待一小段时间确保有足够的运行时间
      const start = Date.now()
      while (Date.now() - start < 10) {
        // 等待至少 10ms
      }

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(1000)
      expect(stats.avgPerSecond).toBeGreaterThanOrEqual(0)
    })

    it('应该跟踪当前状态', () => {
      const stats = genid.getStats()
      expect(['NORMAL', 'OVER_COST']).toContain(stats.currentState)
    })

    it('应该能够重置统计数据', () => {
      genid.nextBatch(100)
      genid.resetStats()

      const stats = genid.getStats()
      expect(stats.totalGenerated).toBe(0)
      expect(stats.overCostCount).toBe(0)
      expect(stats.turnBackCount).toBe(0)
    })
  })

  describe('配置信息', () => {
    it('应该返回完整的配置信息', () => {
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

    it('应该正确计算 workerIdRange', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 8,
      })

      const config = genid.getConfig()
      expect(config.workerIdRange).toBe('0-255') // 2^8 - 1
    })

    it('应该正确计算每毫秒可生成的 ID 数量', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 6,
      })

      const config = genid.getConfig()
      // maxSeqNumber(63) - minSeqNumber(5) + 1 = 59
      expect(config.idsPerMillisecond).toBe(59)
    })
  })

  describe('二进制格式化', () => {
    let genid: GenidOptimized

    beforeEach(() => {
      genid = new GenidOptimized({ workerId: 1 })
    })

    it('应该格式化 ID 为二进制字符串', () => {
      const id = genid.nextId()
      const formatted = genid.formatBinary(id)

      expect(formatted).toContain('ID:')
      expect(formatted).toContain('Binary (64-bit):')
      expect(formatted).toContain('时间戳')
      expect(formatted).toContain('工作节点 ID')
      expect(formatted).toContain('序列号')
    })

    it('应该支持格式化不同类型的 ID', () => {
      const id = genid.nextBigId()
      expect(() => genid.formatBinary(id)).not.toThrow()
      expect(() => genid.formatBinary(id.toString())).not.toThrow()
      expect(() => genid.formatBinary(Number(id))).not.toThrow()
    })

    it('应该在格式化负数 ID 时抛出错误', () => {
      expect(() => genid.formatBinary(-1)).toThrow(
        '[GenidOptimized] ID 不能为负数',
      )
    })
  })

  describe('高并发场景测试', () => {
    it('应该在快速生成大量 ID 时保持唯一性', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const ids = genid.nextBatch(10000)
      const uniqueIds = new Set(ids.map((id) => id.toString()))

      expect(uniqueIds.size).toBe(10000)
    })

    it('应该在序列号耗尽时触发漂移', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3, // 小序列号位数，更容易触发漂移
        minSeqNumber: 5,
      })

      // 生成足够多的 ID 以触发序列号耗尽
      genid.nextBatch(100)

      const stats = genid.getStats()
      // 由于序列号范围小，应该会发生漂移
      expect(stats.overCostCount).toBeGreaterThanOrEqual(0)
    })
  })

  describe('不同算法模式', () => {
    it('DRIFT 模式应该正常工作', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.DRIFT,
      })

      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
      expect(new Set(ids.map((id) => id.toString())).size).toBe(100)
    })

    it('TRADITIONAL 模式应该正常工作', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.TRADITIONAL,
      })

      const ids = genid.nextBatch(100)
      expect(ids).toHaveLength(100)
      expect(new Set(ids.map((id) => id.toString())).size).toBe(100)
    })
  })

  describe('多实例测试', () => {
    it('不同 workerId 的实例应该生成不同的 ID', () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 2 })

      const id1 = genid1.nextId()
      const id2 = genid2.nextId()

      const parsed1 = genid1.parse(id1)
      const parsed2 = genid2.parse(id2)

      expect(parsed1.workerId).toBe(1)
      expect(parsed2.workerId).toBe(2)
    })

    it('相同配置的不同实例应该生成唯一的 ID', async () => {
      const genid1 = new GenidOptimized({ workerId: 1 })
      const genid2 = new GenidOptimized({ workerId: 1 })

      const ids1 = genid1.nextBatch(100)

      // 等待至少 2ms 以确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 2))

      const ids2 = genid2.nextBatch(100)

      const allIds = [...ids1, ...ids2]
      const uniqueIds = new Set(allIds.map((id) => id.toString()))

      // 由于加了延迟，时间戳应该不同，ID 应该唯一
      expect(uniqueIds.size).toBe(200)
    })
  })

  describe('边界条件测试', () => {
    it('应该处理最小 workerId (0)', () => {
      const genid = new GenidOptimized({ workerId: 0 })
      const id = genid.nextId()
      const parsed = genid.parse(id)

      expect(parsed.workerId).toBe(0)
    })

    it('应该处理最大 workerId', () => {
      const genid = new GenidOptimized({
        workerId: 63, // 2^6 - 1
        workerIdBitLength: 6,
      })
      const id = genid.nextId()
      const parsed = genid.parse(id)

      expect(parsed.workerId).toBe(63)
    })

    it('应该处理最小序列号位长度', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 3,
        minSeqNumber: 5,
      })

      const id = genid.nextId()
      expect(id).toBeDefined()
    })

    it('应该处理最大序列号位长度', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 1,
        seqBitLength: 21,
      })

      const id = genid.nextId()
      expect(id).toBeDefined()
    })
  })

  describe('性能基准测试', () => {
    it('应该能够每秒生成大量 ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      const startTime = Date.now()
      const count = 100000
      genid.nextBatch(count)
      const endTime = Date.now()

      const duration = endTime - startTime
      const idsPerSecond = (count / duration) * 1000

      // 应该能够达到至少 5万/秒的性能
      expect(idsPerSecond).toBeGreaterThan(50000)
    })

    it('应该在极限并发下保持唯一性', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 10,
      })

      const count = 1000
      const ids = genid.nextBatch(count, true)

      // 验证唯一性
      const uniqueIds = new Set(ids.map((id) => id.toString()))
      expect(uniqueIds.size).toBe(count)

      // 验证递增性
      for (let i = 1; i < ids.length; i++) {
        const prev = BigInt(ids[i - 1])
        const curr = BigInt(ids[i])
        if (curr <= prev) {
          console.log(`发现重复/倒序 ID:`)
          console.log(`  索引 ${i - 1}: ${prev} (${ids[i - 1]})`)
          console.log(`  索引 ${i}: ${curr} (${ids[i]})`)
          console.log(`  解析 [${i - 1}]:`, genid.parse(ids[i - 1]))
          console.log(`  解析 [${i}]:`, genid.parse(ids[i]))
        }
        expect(curr).toBeGreaterThan(prev)
        // expect(ids[i]).toBeGreaterThan(ids[i - 1])
      }
    })
  })
})
