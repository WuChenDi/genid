import { describe, it, expect } from 'vitest'
import { GenidOptimized } from '../src'
import { GenidMethod } from '../src/types'

/**
 * 性能测试套件
 *
 * pnpm run test:performance
 */
describe('GenidOptimized - 性能测试', () => {
  describe('吞吐量测试', () => {
    it('应该测量单线程最大吞吐量 (5秒)', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const duration = 5000
      const startTime = Date.now()
      let count = 0

      while (Date.now() - startTime < duration) {
        genid.nextId()
        count++
      }

      const actualDuration = Date.now() - startTime
      const throughput = (count / actualDuration) * 1000

      console.log('\n=== 吞吐量测试结果 ===')
      console.log(`测试时长: ${actualDuration}ms`)
      console.log(`总生成数: ${count.toLocaleString()} IDs`)
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)

      // 基准: 应该能达到至少 10万/秒
      expect(throughput).toBeGreaterThan(100000)
    })

    it('应该测量批量生成的吞吐量', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const batchSize = 10000
      const iterations = 100

      const startTime = performance.now()

      for (let i = 0; i < iterations; i++) {
        genid.nextBatch(batchSize)
      }

      const duration = performance.now() - startTime
      const totalCount = batchSize * iterations
      const throughput = (totalCount / duration) * 1000

      console.log('\n=== 批量生成吞吐量 ===')
      console.log(`批次大小: ${batchSize}`)
      console.log(`批次数量: ${iterations}`)
      console.log(`总生成数: ${totalCount.toLocaleString()} IDs`)
      console.log(`总耗时: ${duration.toFixed(2)}ms`)
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)

      expect(throughput).toBeGreaterThan(100000)
    })
    it('应该对比不同批次大小的性能', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const batchSizes = [100, 500, 1000, 5000, 10000]
      const results: any[] = []

      console.log('\n=== 不同批次大小性能对比 ===')

      batchSizes.forEach((size) => {
        const startTime = performance.now()
        genid.nextBatch(size)
        const duration = performance.now() - startTime
        const throughput = (size / duration) * 1000

        results.push({ size, duration, throughput })

        console.log(
          `批次 ${size.toString().padStart(6)}: ${duration.toFixed(3)}ms, ${Math.floor(throughput).toLocaleString().padStart(10)} IDs/秒`
        )
      })

      // 验证所有批次都有良好性能
      results.forEach((result) => {
        expect(result.throughput).toBeGreaterThan(50000) // 所有批次都应该 > 5万/秒
      })
    })
  })

  describe('延迟测试', () => {
    it('应该测量单次生成的延迟分布', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const iterations = 100000
      const latencies: number[] = []

      // 预热
      for (let i = 0; i < 1000; i++) {
        genid.nextId()
      }

      // 实际测试
      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        genid.nextId()
        latencies.push(performance.now() - start)
      }

      latencies.sort((a, b) => a - b)

      const p50 = latencies[Math.floor(iterations * 0.5)]
      const p95 = latencies[Math.floor(iterations * 0.95)]
      const p99 = latencies[Math.floor(iterations * 0.99)]
      const p999 = latencies[Math.floor(iterations * 0.999)]
      const max = latencies[iterations - 1]
      const avg = latencies.reduce((a, b) => a + b, 0) / iterations

      console.log(`\n=== 延迟分布 (${iterations.toLocaleString()} 次测试) ===`)
      console.log(`平均延迟: ${avg.toFixed(4)}ms`)
      console.log(`P50 延迟: ${p50.toFixed(4)}ms`)
      console.log(`P95 延迟: ${p95.toFixed(4)}ms`)
      console.log(`P99 延迟: ${p99.toFixed(4)}ms`)
      console.log(`P99.9 延迟: ${p999.toFixed(4)}ms`)
      console.log(`最大延迟: ${max.toFixed(4)}ms`)

      // P99 延迟应该小于 0.1ms
      expect(p99).toBeLessThan(0.1)
    })

    it('应该测量不同方法的延迟差异', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const iterations = 10000

      const methods = ['nextId', 'nextNumber', 'nextBigId'] as const
      const results: Record<string, number> = {}

      console.log('\n=== 不同方法延迟对比 ===')

      methods.forEach((method) => {
        const latencies: number[] = []

        for (let i = 0; i < iterations; i++) {
          const start = performance.now()
          genid[method]()
          latencies.push(performance.now() - start)
        }

        const avg = latencies.reduce((a, b) => a + b, 0) / iterations
        results[method] = avg

        console.log(`${method.padEnd(12)}: ${avg.toFixed(4)}ms`)
      })

      // 所有方法的延迟都应该很低
      Object.values(results).forEach((latency) => {
        expect(latency).toBeLessThan(0.01)
      })
    })
  })

  describe('持续负载测试', () => {
    it('应该在持续高负载下保持稳定性能 (30秒)', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const testDuration = 30000 // 30秒
      const batchSize = 1000
      const startTime = Date.now()
      let totalGenerated = 0
      const throughputSamples: number[] = []

      console.log(`\n=== 持续负载测试 (${testDuration / 1000}秒) ===`)

      let lastSampleTime = startTime
      let lastSampleCount = 0

      while (Date.now() - startTime < testDuration) {
        genid.nextBatch(batchSize)
        totalGenerated += batchSize

        // 每秒采样一次吞吐量
        if (Date.now() - lastSampleTime >= 1000) {
          const currentCount = totalGenerated
          const throughput =
            (currentCount - lastSampleCount) / ((Date.now() - lastSampleTime) / 1000)
          throughputSamples.push(throughput)

          lastSampleTime = Date.now()
          lastSampleCount = currentCount
        }
      }

      const actualDuration = Date.now() - startTime
      const avgThroughput = (totalGenerated / actualDuration) * 1000
      const stats = genid.getStats()

      console.log(`总耗时: ${actualDuration}ms`)
      console.log(`总生成: ${totalGenerated.toLocaleString()} IDs`)
      console.log(`平均吞吐量: ${Math.floor(avgThroughput).toLocaleString()} IDs/秒`)
      console.log(`漂移次数: ${stats.overCostCount}`)
      console.log(`时钟回拨: ${stats.turnBackCount}`)

      if (throughputSamples.length > 0) {
        const maxThroughput = Math.max(...throughputSamples)
        const minThroughput = Math.min(...throughputSamples)
        const variance = ((maxThroughput - minThroughput) / avgThroughput) * 100

        console.log(
          `吞吐量波动: ${variance.toFixed(2)}% (最大: ${Math.floor(maxThroughput).toLocaleString()}, 最小: ${Math.floor(minThroughput).toLocaleString()})`
        )
      }

      expect(avgThroughput).toBeGreaterThan(100000)
    }, 35000) // 设置超时时间
  })

  describe('内存占用测试', () => {
    it('应该测量生成大量 ID 的内存占用', () => {
      const genid = new GenidOptimized({ workerId: 1 })

      // 获取初始内存
      if (global.gc) {
        global.gc()
      }
      const initialMemory = process.memoryUsage()

      // 生成大量 ID (不保存到数组中)
      const count = 10000000 // 1000万
      console.log(`\n=== 内存占用测试 (生成 ${(count / 1000000).toFixed(0)}M IDs) ===`)

      const startTime = Date.now()
      for (let i = 0; i < count; i++) {
        genid.nextId()
      }
      const duration = Date.now() - startTime

      // 获取最终内存
      if (global.gc) {
        global.gc()
      }
      const finalMemory = process.memoryUsage()

      const memoryIncrease = {
        heapUsed: (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024,
        external: (finalMemory.external - initialMemory.external) / 1024 / 1024,
      }

      console.log(`生成耗时: ${duration}ms`)
      console.log(
        `吞吐量: ${Math.floor((count / duration) * 1000).toLocaleString()} IDs/秒`
      )
      console.log(`堆内存增长: ${memoryIncrease.heapUsed.toFixed(2)} MB`)
      console.log(`外部内存增长: ${memoryIncrease.external.toFixed(2)} MB`)

      // 内存增长应该很小 (主要是统计数据)
      expect(memoryIncrease.heapUsed).toBeLessThan(10)
    })

    it('应该测量批量生成时的内存效率', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const batchSizes = [1000, 10000, 100000]

      console.log('\n=== 批量生成内存效率 ===')

      batchSizes.forEach((size) => {
        if (global.gc) {
          global.gc()
        }

        const before = process.memoryUsage().heapUsed
        const ids = genid.nextBatch(size)
        const after = process.memoryUsage().heapUsed

        const memoryPerID = (after - before) / size / 1024 // KB per ID

        console.log(
          `批次 ${size.toString().padStart(6)}: ${memoryPerID.toFixed(3)} KB/ID`
        )

        // 清理数组
        ids.length = 0
      })
    })
  })

  describe('算法对比测试', () => {
    it('应该对比漂移算法 vs 传统算法的性能', () => {
      const testDuration = 3000
      const results: Record<string, any> = {}

      console.log(`\n=== 算法性能对比 (${testDuration / 1000}秒) ===`)

      // 测试漂移算法
      const driftGenid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.DRIFT,
      })

      let startTime = Date.now()
      let driftCount = 0
      while (Date.now() - startTime < testDuration) {
        driftGenid.nextId()
        driftCount++
      }
      const driftDuration = Date.now() - startTime
      const driftStats = driftGenid.getStats()

      results.drift = {
        count: driftCount,
        duration: driftDuration,
        throughput: (driftCount / driftDuration) * 1000,
        overCostCount: driftStats.overCostCount,
      }

      // 测试传统算法
      const traditionalGenid = new GenidOptimized({
        workerId: 1,
        method: GenidMethod.TRADITIONAL,
      })

      startTime = Date.now()
      let traditionalCount = 0
      while (Date.now() - startTime < testDuration) {
        traditionalGenid.nextId()
        traditionalCount++
      }
      const traditionalDuration = Date.now() - startTime
      const traditionalStats = traditionalGenid.getStats()

      results.traditional = {
        count: traditionalCount,
        duration: traditionalDuration,
        throughput: (traditionalCount / traditionalDuration) * 1000,
        overCostCount: traditionalStats.overCostCount,
      }

      console.log('漂移算法:')
      console.log(`  生成数量: ${results.drift.count.toLocaleString()}`)
      console.log(
        `  吞吐量: ${Math.floor(results.drift.throughput).toLocaleString()} IDs/秒`
      )
      console.log(`  漂移次数: ${results.drift.overCostCount}`)

      console.log('传统算法:')
      console.log(`  生成数量: ${results.traditional.count.toLocaleString()}`)
      console.log(
        `  吞吐量: ${Math.floor(results.traditional.throughput).toLocaleString()} IDs/秒`
      )
      console.log(`  漂移次数: ${results.traditional.overCostCount}`)

      const improvement =
        ((results.drift.throughput - results.traditional.throughput) /
          results.traditional.throughput) *
        100
      console.log(`性能提升: ${improvement > 0 ? '+' : ''}${improvement.toFixed(2)}%`)

      // 两种算法都应该有良好的性能
      expect(results.drift.throughput).toBeGreaterThan(100000)
      expect(results.traditional.throughput).toBeGreaterThan(100000)
    })
  })

  describe('序列号耗尽场景测试', () => {
    it('应该测量序列号耗尽时的性能影响', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        seqBitLength: 4, // 小序列号,容易触发漂移
        minSeqNumber: 5,
      })

      const count = 50000
      console.log('\n=== 序列号耗尽性能测试 ===')

      const startTime = performance.now()
      genid.nextBatch(count)
      const duration = performance.now() - startTime

      const stats = genid.getStats()
      const throughput = (count / duration) * 1000

      console.log(`生成数量: ${count.toLocaleString()}`)
      console.log(`耗时: ${duration.toFixed(2)}ms`)
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)
      console.log(`漂移次数: ${stats.overCostCount}`)
      console.log(`漂移率: ${((stats.overCostCount / count) * 100).toFixed(2)}%`)

      // 即使频繁漂移,性能仍应该可接受
      expect(throughput).toBeGreaterThan(50000)
    })

    it('应该测量不同序列号位数的性能', () => {
      const seqBitLengths = [4, 6, 8, 10]
      const testCount = 10000

      console.log('\n=== 不同序列号位数性能对比 ===')

      seqBitLengths.forEach((seqBits) => {
        const genid = new GenidOptimized({
          workerId: 1,
          seqBitLength: seqBits,
        })

        const startTime = performance.now()
        genid.nextBatch(testCount)
        const duration = performance.now() - startTime

        const stats = genid.getStats()
        const throughput = (testCount / duration) * 1000

        console.log(
          `序列号位数 ${seqBits.toString().padStart(2)}: 吞吐量 ${Math.floor(throughput).toLocaleString().padStart(10)} IDs/秒, 漂移 ${stats.overCostCount}`
        )
      })
    })
  })

  describe('多 Worker 性能测试', () => {
    it('应该测量多个 Worker 独立生成的性能', () => {
      const workerCount = 8
      const idsPerWorker = 100000

      console.log('\n=== 多 Worker 性能测试 ===')
      console.log(`Worker 数量: ${workerCount}`)
      console.log(`每个 Worker: ${idsPerWorker.toLocaleString()} IDs`)

      const workers = Array.from(
        { length: workerCount },
        (_, i) => new GenidOptimized({ workerId: i })
      )

      const startTime = performance.now()

      // 模拟并发生成(顺序执行,但测量总时间)
      const allIds: Set<string> = new Set()
      workers.forEach((worker) => {
        const ids = worker.nextBatch(idsPerWorker)
        ids.forEach((id) => allIds.add(id.toString()))
      })

      const duration = performance.now() - startTime
      const totalCount = workerCount * idsPerWorker
      const throughput = (totalCount / duration) * 1000

      console.log(`总生成数: ${totalCount.toLocaleString()}`)
      console.log(`总耗时: ${duration.toFixed(2)}ms`)
      console.log(`总吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)
      console.log(`唯一 ID 数: ${allIds.size.toLocaleString()}`)

      // 所有 ID 应该唯一
      expect(allIds.size).toBe(totalCount)
    })
  })

  describe('解析性能测试', () => {
    it('应该测量 ID 解析的性能', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const ids = genid.nextBatch(10000, true)

      console.log('\n=== ID 解析性能测试 ===')

      const startTime = performance.now()
      ids.forEach((id) => {
        genid.parse(id)
      })
      const duration = performance.now() - startTime

      const throughput = (ids.length / duration) * 1000

      console.log(`解析数量: ${ids.length.toLocaleString()}`)
      console.log(`耗时: ${duration.toFixed(2)}ms`)
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} 次/秒`)

      // 解析性能应该很高
      expect(throughput).toBeGreaterThan(100000)
    })

    it('应该对比不同类型 ID 的解析性能', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const count = 10000

      const numberIds = genid.nextBatch(count, false)
      const bigIntIds = genid.nextBatch(count, true)
      const stringIds = bigIntIds.map((id) => id.toString())

      console.log('\n=== 不同类型 ID 解析性能 ===')

      const types = [
        { name: 'Number', ids: numberIds },
        { name: 'BigInt', ids: bigIntIds },
        { name: 'String', ids: stringIds },
      ]

      types.forEach(({ name, ids }) => {
        const startTime = performance.now()
        ids.forEach((id) => genid.parse(id))
        const duration = performance.now() - startTime
        const throughput = (count / duration) * 1000

        console.log(
          `${name.padEnd(8)}: ${Math.floor(throughput).toLocaleString().padStart(10)} 次/秒`
        )
      })
    })
  })

  describe('边界性能测试', () => {
    it('应该测量极小配置下的性能', () => {
      const genid = new GenidOptimized({
        workerId: 0,
        workerIdBitLength: 1,
        seqBitLength: 3,
        minSeqNumber: 5,
      })

      const count = 10000
      const startTime = performance.now()
      genid.nextBatch(count)
      const duration = performance.now() - startTime

      const throughput = (count / duration) * 1000

      console.log('\n=== 极小配置性能 ===')
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)

      expect(throughput).toBeGreaterThan(10000)
    })

    it('应该测量极大配置下的性能', () => {
      const genid = new GenidOptimized({
        workerId: 1,
        workerIdBitLength: 1,
        seqBitLength: 21,
      })

      const count = 10000
      const startTime = performance.now()
      genid.nextBatch(count)
      const duration = performance.now() - startTime

      const throughput = (count / duration) * 1000

      console.log('\n=== 极大配置性能 ===')
      console.log(`吞吐量: ${Math.floor(throughput).toLocaleString()} IDs/秒`)

      expect(throughput).toBeGreaterThan(50000)
    })
  })

  describe('统计功能性能影响', () => {
    it('应该测量统计收集对性能的影响', () => {
      const genid = new GenidOptimized({ workerId: 1 })
      const count = 100000

      const startTime = performance.now()
      genid.nextBatch(count)
      const duration = performance.now() - startTime

      // 频繁获取统计信息
      const statStartTime = performance.now()
      for (let i = 0; i < 10000; i++) {
        genid.getStats()
      }
      const statDuration = performance.now() - statStartTime

      console.log('\n=== 统计功能性能影响 ===')
      console.log(`生成 ${count.toLocaleString()} IDs: ${duration.toFixed(2)}ms`)
      console.log(`获取统计 10000 次: ${statDuration.toFixed(2)}ms`)
      console.log(`单次统计耗时: ${(statDuration / 10000).toFixed(4)}ms`)

      // 获取统计应该非常快
      expect(statDuration / 10000).toBeLessThan(0.01)
    })
  })
})
