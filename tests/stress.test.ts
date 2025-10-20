import { describe, it, expect } from 'vitest'
import { GenidOptimized } from '../src'

/**
 * 压力测试套件
 *
 * pnpm run test:stress
 */
describe('GenidOptimized - 压力测试', () => {
  describe('极限吞吐量测试', () => {
    it('应该在 1 分钟内生成海量 ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const duration = 60000 // 1 分钟
      const startTime = Date.now()
      let count = 0

      console.log('\n=== 1 分钟极限吞吐量测试 ===')

      while (Date.now() - startTime < duration) {
        genid.nextBatch(10000)
        count += 10000
      }

      const actualDuration = Date.now() - startTime
      const throughput = (count / actualDuration) * 1000
      const stats = genid.getStats()

      console.log(`总生成数: ${count.toLocaleString()} IDs`)
      console.log(`实际耗时: ${(actualDuration / 1000).toFixed(2)}s`)
      console.log(`平均吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)
      console.log(`漂移次数: ${stats.overCostCount.toLocaleString()}`)
      console.log(`时钟回拨: ${stats.turnBackCount}`)

      expect(count).toBeGreaterThan(1000000) // 至少 100万
    }, 70000)

    it('应该能够生成 1000 万个唯一 ID', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const targetCount = 10000000 // 1000万
      const checkInterval = 1000000 // 每 100万 检查一次

      console.log(`\n=== 生成 ${(targetCount / 1000000).toFixed(0)}M 唯一 ID 测试 ===`)

      const startTime = Date.now()
      let lastCheckTime = startTime

      for (let i = 0; i < targetCount / checkInterval; i++) {
        genid.nextBatch(checkInterval)

        const now = Date.now()
        const elapsed = now - lastCheckTime
        const throughput = (checkInterval / elapsed) * 1000

        console.log(
          `进度: ${(((i + 1) * checkInterval) / 1000000).toFixed(0)}M, 速率: ${Math.floor(throughput).toLocaleString()} IDs/秒`
        )

        lastCheckTime = now
      }

      const totalDuration = Date.now() - startTime
      const stats = genid.getStats()

      console.log(`总耗时: ${(totalDuration / 1000).toFixed(2)}s`)
      console.log(
        `平均吞吐量: ${Math.floor((targetCount / totalDuration) * 1000).toLocaleString()} IDs/秒`
      )
      console.log('统计数据:', stats)

      expect(stats.totalGenerated).toBe(targetCount)
    }, 300000) // 5 分钟超时
  })

  describe('长时间运行测试', () => {
    it('应该能够稳定运行 5 分钟', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const duration = 300000 // 5 分钟
      const batchSize = 1000

      console.log('\n=== 5 分钟稳定性测试 ===')

      const startTime = Date.now()
      let totalGenerated = 0
      const samples: any[] = []

      let lastSampleTime = startTime
      let lastSampleCount = 0

      while (Date.now() - startTime < duration) {
        genid.nextBatch(batchSize)
        totalGenerated += batchSize

        // 每 10 秒采样一次
        if (Date.now() - lastSampleTime >= 10000) {
          const currentTime = Date.now()
          const sampleDuration = currentTime - lastSampleTime
          const sampleCount = totalGenerated - lastSampleCount
          const throughput = (sampleCount / sampleDuration) * 1000

          samples.push({
            timestamp: currentTime - startTime,
            throughput,
            totalGenerated,
          })

          console.log(
            `${((currentTime - startTime) / 1000).toFixed(0)}s: ${Math.floor(throughput).toLocaleString()} IDs/秒, 总计: ${totalGenerated.toLocaleString()}`
          )

          lastSampleTime = currentTime
          lastSampleCount = totalGenerated
        }
      }

      const stats = genid.getStats()

      // 计算吞吐量统计
      const throughputs = samples.map((s) => s.throughput)
      const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length
      const maxThroughput = Math.max(...throughputs)
      const minThroughput = Math.min(...throughputs)
      const variance = ((maxThroughput - minThroughput) / avgThroughput) * 100

      console.log('\n=== 测试总结 ===')
      console.log(`总生成数: ${totalGenerated.toLocaleString()}`)
      console.log(`平均吞吐量: ${Math.floor(avgThroughput).toLocaleString()} IDs/秒`)
      console.log(`最大吞吐量: ${Math.floor(maxThroughput).toLocaleString()} IDs/秒`)
      console.log(`最小吞吐量: ${Math.floor(minThroughput).toLocaleString()} IDs/秒`)
      console.log(`波动范围: ${variance.toFixed(2)}%`)
      console.log(`漂移次数: ${stats.overCostCount.toLocaleString()}`)
      console.log(`时钟回拨: ${stats.turnBackCount}`)

      // 性能波动应该在合理范围内
      expect(variance).toBeLessThan(50)
    }, 320000) // 5分20秒超时
  })

  describe('内存压力测试', () => {
    it('应该能够处理超大批量生成', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const batchSizes = [10000, 50000, 100000, 500000, 1000000]

      console.log('\n=== 超大批量生成测试 ===')

      batchSizes.forEach((size) => {
        if (global.gc) {
          global.gc()
        }

        const memBefore = process.memoryUsage()
        const startTime = performance.now()

        const ids = genid.nextBatch(size, true)

        const duration = performance.now() - startTime
        const memAfter = process.memoryUsage()

        const memUsed = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024
        const throughput = (size / duration) * 1000

        console.log(
          `批次 ${(size / 1000).toFixed(0).padStart(6)}K: ${duration.toFixed(2).padStart(8)}ms, ${Math.floor(throughput).toLocaleString().padStart(10)} IDs/秒, 内存: ${memUsed.toFixed(2)}MB`
        )

        // 验证 ID 唯一性(抽样检查)
        const sampleSize = Math.min(10000, size)
        const sample = ids.slice(0, sampleSize)
        const uniqueSample = new Set(sample.map((id) => id.toString()))
        expect(uniqueSample.size).toBe(sampleSize)

        // 清理
        ids.length = 0
      })
    }, 120000)

    it('应该在持续生成下不发生内存泄漏', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const duration = 30000 // 30 秒
      const batchSize = 10000

      console.log('\n=== 内存泄漏检测 (30秒) ===')

      // 强制 GC
      if (global.gc) {
        global.gc()
      }

      const initialMemory = process.memoryUsage()
      const startTime = Date.now()
      let iterations = 0
      const memSamples: number[] = []

      while (Date.now() - startTime < duration) {
        genid.nextBatch(batchSize)
        iterations++

        // 每 5 秒采样一次内存
        if (iterations % 50 === 0) {
          if (global.gc) {
            global.gc()
          }
          const mem = process.memoryUsage()
          const memUsed = (mem.heapUsed - initialMemory.heapUsed) / 1024 / 1024
          memSamples.push(memUsed)

          console.log(
            `${((Date.now() - startTime) / 1000).toFixed(0)}s: 内存增长 ${memUsed.toFixed(2)}MB`
          )
        }
      }

      if (global.gc) {
        global.gc()
      }

      const finalMemory = process.memoryUsage()
      const totalMemGrowth = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024

      // 计算内存增长趋势
      const firstHalfAvg =
        memSamples
          .slice(0, Math.floor(memSamples.length / 2))
          .reduce((a, b) => a + b, 0) /
        (memSamples.length / 2)
      const secondHalfAvg =
        memSamples.slice(Math.floor(memSamples.length / 2)).reduce((a, b) => a + b, 0) /
        (memSamples.length / 2)

      const memGrowthTrend = secondHalfAvg - firstHalfAvg

      console.log(`\n总内存增长: ${totalMemGrowth.toFixed(2)}MB`)
      console.log(`前半段平均: ${firstHalfAvg.toFixed(2)}MB`)
      console.log(`后半段平均: ${secondHalfAvg.toFixed(2)}MB`)
      console.log(`增长趋势: ${memGrowthTrend.toFixed(2)}MB`)

      // 内存增长应该稳定,不应该持续上升
      expect(Math.abs(memGrowthTrend)).toBeLessThan(20)
    }, 40000)
  })

  describe('多 Worker 并发压力测试', () => {
    it('应该处理 32 个 Worker 同时生成', () => {
      const workerCount = 32
      const idsPerWorker = 100000

      console.log(`\n=== ${workerCount} Worker 并发测试 ===`)

      const workers = Array.from(
        { length: workerCount },
        (_, i) => new GenidOptimized({ workerId: i })
      )

      const startTime = performance.now()
      const allIds: Set<string> = new Set()

      // 模拟并发(实际是顺序,但测量总性能)
      workers.forEach((worker, index) => {
        const workerStart = performance.now()
        const ids = worker.nextBatch(idsPerWorker, true)
        const workerDuration = performance.now() - workerStart

        console.log(
          `Worker ${index.toString().padStart(2)}: ${workerDuration.toFixed(2)}ms, ${Math.floor((idsPerWorker / workerDuration) * 1000).toLocaleString()} IDs/秒`
        )

        ids.forEach((id) => allIds.add(id.toString()))
      })

      const totalDuration = performance.now() - startTime
      const totalCount = workerCount * idsPerWorker

      console.log(`\n总耗时: ${totalDuration.toFixed(2)}ms`)
      console.log(`总生成数: ${totalCount.toLocaleString()}`)
      console.log(`唯一 ID 数: ${allIds.size.toLocaleString()}`)
      console.log(
        `总吞吐量: ${Math.floor((totalCount / totalDuration) * 1000).toLocaleString()} IDs/秒`
      )

      // 所有 ID 必须唯一
      expect(allIds.size).toBe(totalCount)
    }, 120000)
  })

  it('应该处理极小序列号位数的高频漂移', () => {
    const genid = new GenidOptimized({
      workerId: 1,
      seqBitLength: 3, // 只有 8 个序列号
      minSeqNumber: 5, // 可用序列号: 5, 6, 7 (3个)
    })

    const count = 100000

    console.log('\n=== 极小序列号压力测试 ===')
    console.log('可用序列号数: 3')

    const startTime = performance.now()
    const ids = genid.nextBatch(count, true)
    const duration = performance.now() - startTime

    const stats = genid.getStats()
    const uniqueIds = new Set(ids.map((id) => id.toString()))

    console.log(`生成数量: ${count.toLocaleString()}`)
    console.log(`耗时: ${duration.toFixed(2)}ms`)
    console.log(
      `吞吐量: ${Math.floor((count / duration) * 1000).toLocaleString()} IDs/秒`
    )
    console.log(`漂移次数: ${stats.overCostCount.toLocaleString()}`)
    console.log(`漂移率: ${((stats.overCostCount / count) * 100).toFixed(2)}%`)
    console.log(`唯一 ID: ${uniqueIds.size.toLocaleString()}`)

    // 所有 ID 应该唯一
    expect(uniqueIds.size).toBe(count)
  })

  it('应该验证生成 ID 的严格递增性', () => {
    const genid = new GenidOptimized({ workerId: 1 })
    const count = 10000

    console.log(`\n=== 严格递增性验证 (${(count / 1000).toFixed(0)}K IDs) ===`)

    const startTime = performance.now()
    let prevId = 0n
    let violations = 0
    const violationDetails: any[] = []

    // 关键优化: 分批生成并在批次间添加短暂延迟
    const batchSize = 100
    const batches = count / batchSize

    for (let batch = 0; batch < batches; batch++) {
      for (let i = 0; i < batchSize; i++) {
        const id = genid.nextBigId()

        if (id <= prevId) {
          violations++
          if (violations <= 5) {
            const parsedPrev = genid.parse(prevId)
            const parsedCurr = genid.parse(id)
            violationDetails.push({
              index: batch * batchSize + i,
              prevId: prevId.toString(),
              currId: id.toString(),
              parsedPrev,
              parsedCurr,
            })
            console.log(`违规 #${violations}: 批次 ${batch}, 位置 ${i}`)
            console.log(
              `  前一个: ${prevId} (时间戳: ${parsedPrev.timestampMs}, 序列: ${parsedPrev.sequence})`
            )
            console.log(
              `  当前: ${id} (时间戳: ${parsedCurr.timestampMs}, 序列: ${parsedCurr.sequence})`
            )
          }
        }

        prevId = id
      }

      // 每批次后短暂让出 CPU(可选,根据需要启用)
      // if (batch % 10 === 0) {
      //   await new Promise(resolve => setImmediate(resolve))
      // }
    }

    const duration = performance.now() - startTime

    console.log(`\n耗时: ${duration.toFixed(2)}ms`)
    console.log(`违规次数: ${violations}`)
    console.log(`违规率: ${((violations / count) * 100).toFixed(2)}%`)

    if (violations > 0 && violationDetails.length > 0) {
      console.log('\n违规详情:')
      violationDetails.forEach((detail, idx) => {
        console.log(`\n违规 ${idx + 1}:`)
        console.log(JSON.stringify(detail, null, 2))
      })
    }

    // 应该没有任何违规
    expect(violations).toBe(0)
  }, 60000)

  describe('恢复能力测试', () => {
    it('应该在统计重置后继续正常工作', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      console.log('\n=== 统计重置恢复测试 ===')

      // 第一阶段
      genid.nextBatch(100000)
      const stats1 = genid.getStats()
      console.log(`第一阶段: ${stats1.totalGenerated} IDs`)

      // 重置
      genid.resetStats()
      const stats2 = genid.getStats()
      console.log(`重置后: ${stats2.totalGenerated} IDs`)

      // 第二阶段
      const ids = genid.nextBatch(100000, true)
      const stats3 = genid.getStats()
      console.log(`第二阶段: ${stats3.totalGenerated} IDs`)

      // 验证唯一性
      const uniqueIds = new Set(ids.map((id) => id.toString()))

      expect(stats2.totalGenerated).toBe(0)
      expect(stats3.totalGenerated).toBe(100000)
      expect(uniqueIds.size).toBe(100000)
    })
  })

  describe('边界值压力测试', () => {
    it('应该处理 workerId 边界值', () => {
      const tests = [
        { workerId: 0, name: '最小 workerId' },
        { workerId: 63, name: '最大 workerId (6 bits)' },
      ]

      console.log('\n=== workerId 边界值测试 ===')

      tests.forEach(({ workerId, name }) => {
        const genid = new GenidOptimized({ workerId })
        const count = 10000

        const startTime = performance.now()
        const ids = genid.nextBatch(count, true)
        const duration = performance.now() - startTime

        const uniqueIds = new Set(ids.map((id) => id.toString()))
        if (ids[0] === undefined) {
          throw new Error('[GenidOptimized] 边界值测试失败')
        }
        const parsed = genid.parse(ids[0])

        console.log(
          `${name} (${workerId}): ${duration.toFixed(2)}ms, 唯一: ${uniqueIds.size}, workerId: ${parsed.workerId}`
        )

        expect(uniqueIds.size).toBe(count)
        expect(parsed.workerId).toBe(workerId)
      })
    })
  })

  describe('混合场景压力测试', () => {
    it('应该处理混合的生成方法调用', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const iterations = 100000

      console.log('\n=== 混合方法调用测试 ===')

      const allIds: Set<string> = new Set()
      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        // 随机使用不同的生成方法
        const method = i % 3
        let id: number | bigint

        if (method === 0) {
          id = genid.nextId()
        } else if (method === 1) {
          id = genid.nextNumber()
        } else {
          id = genid.nextBigId()
        }

        allIds.add(id.toString())
      }

      const duration = performance.now() - startTime

      console.log(`生成数量: ${iterations.toLocaleString()}`)
      console.log(`唯一 ID: ${allIds.size.toLocaleString()}`)
      console.log(`耗时: ${duration.toFixed(2)}ms`)
      console.log(
        `吞吐量: ${Math.floor((iterations / duration) * 1000).toLocaleString()} IDs/秒`
      )

      expect(allIds.size).toBe(iterations)
    })
  })
})
