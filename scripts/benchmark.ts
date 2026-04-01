/**
 * Environment capability probe.
 *
 * Measures the actual peak throughput of the current machine and outputs
 * a baseline report that can guide test threshold design.
 *
 * Usage:
 *   pnpm run benchmark
 */

import { GenidMethod, GenidOptimized } from '../src/index'

// ─── Helpers ─────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

function separator(title: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log('─'.repeat(60))
}

// ─── 1. Single-call throughput ───────────────────────────────────────

function probeSingleCall(): number {
  separator('1. Single-call throughput (nextId)')

  const genid = new GenidOptimized({ workerId: 1 })
  const warmup = 10_000
  for (let i = 0; i < warmup; i++) genid.nextId()

  const duration = 3_000
  const start = Date.now()
  let count = 0
  while (Date.now() - start < duration) {
    genid.nextId()
    count++
  }
  const elapsed = Date.now() - start
  const throughput = Math.floor((count / elapsed) * 1000)

  console.log(`  Duration:   ${elapsed}ms`)
  console.log(`  Generated:  ${fmt(count)}`)
  console.log(`  Throughput: ${fmt(throughput)} IDs/sec`)

  return throughput
}

// ─── 2. Batch throughput ─────────────────────────────────────────────

function probeBatch(): number {
  separator('2. Batch throughput (nextBatch)')

  const genid = new GenidOptimized({ workerId: 1 })
  const batchSizes = [100, 1_000, 10_000, 100_000]
  let bestThroughput = 0

  for (const size of batchSizes) {
    const iterations = Math.max(1, Math.floor(500_000 / size))
    const start = performance.now()
    for (let i = 0; i < iterations; i++) {
      genid.nextBatch(size)
    }
    const elapsed = performance.now() - start
    const total = size * iterations
    const throughput = Math.floor((total / elapsed) * 1000)
    bestThroughput = Math.max(bestThroughput, throughput)

    console.log(
      `  batch=${fmt(size).padStart(7)} × ${String(iterations).padStart(4)}  =>  ${fmt(throughput).padStart(12)} IDs/sec`,
    )
  }

  return bestThroughput
}

// ─── 3. Latency percentiles ─────────────────────────────────────────

function probeLatency() {
  separator('3. Single-call latency percentiles')

  const genid = new GenidOptimized({ workerId: 1 })
  const count = 100_000
  const latencies: number[] = new Array(count)

  // warmup
  for (let i = 0; i < 5_000; i++) genid.nextId()

  for (let i = 0; i < count; i++) {
    const s = performance.now()
    genid.nextId()
    latencies[i] = performance.now() - s
  }

  latencies.sort((a, b) => a - b)

  const p = (pct: number) => latencies[Math.floor(count * pct)]!
  const avg = latencies.reduce((a, b) => a + b, 0) / count

  console.log(`  Samples: ${fmt(count)}`)
  console.log(`  Avg:     ${fmtMs(avg)}`)
  console.log(`  P50:     ${fmtMs(p(0.5))}`)
  console.log(`  P95:     ${fmtMs(p(0.95))}`)
  console.log(`  P99:     ${fmtMs(p(0.99))}`)
  console.log(`  P99.9:   ${fmtMs(p(0.999))}`)
  console.log(`  Max:     ${fmtMs(latencies[count - 1]!)}`)

  return { avg, p99: p(0.99) }
}

// ─── 4. Algorithm comparison ─────────────────────────────────────────

function probeAlgorithms() {
  separator('4. Algorithm comparison (DRIFT vs TRADITIONAL)')

  const testMs = 2_000

  for (const method of [GenidMethod.DRIFT, GenidMethod.TRADITIONAL] as const) {
    const label = method === GenidMethod.DRIFT ? 'DRIFT' : 'TRADITIONAL'
    const genid = new GenidOptimized({ workerId: 1, method })

    const start = Date.now()
    let count = 0
    while (Date.now() - start < testMs) {
      genid.nextId()
      count++
    }
    const elapsed = Date.now() - start
    const throughput = Math.floor((count / elapsed) * 1000)
    const stats = genid.getStats()

    console.log(
      `  ${label.padEnd(12)} ${fmt(throughput).padStart(12)} IDs/sec   drift=${fmt(stats.overCostCount)}`,
    )
  }
}

// ─── 5. Sequence-constrained throughput ──────────────────────────────

function probeSequenceConfigs() {
  separator('5. Throughput by sequence bit length')

  const testMs = 2_000

  for (const seqBits of [3, 4, 6, 8, 10, 14]) {
    const genid = new GenidOptimized({ workerId: 1, seqBitLength: seqBits })
    const start = Date.now()
    let count = 0
    while (Date.now() - start < testMs) {
      genid.nextId()
      count++
    }
    const elapsed = Date.now() - start
    const throughput = Math.floor((count / elapsed) * 1000)
    const stats = genid.getStats()
    const maxSeq = (1 << seqBits) - 1

    console.log(
      `  seqBits=${String(seqBits).padStart(2)}  maxSeq=${String(maxSeq).padStart(5)}  =>  ${fmt(throughput).padStart(12)} IDs/sec   drift=${fmt(stats.overCostCount)}`,
    )
  }
}

// ─── 6. Memory footprint ─────────────────────────────────────────────

function probeMemory() {
  separator('6. Memory footprint')

  const genid = new GenidOptimized({ workerId: 1 })

  if (global.gc) global.gc()
  const before = process.memoryUsage().heapUsed

  const count = 1_000_000
  for (let i = 0; i < count; i++) genid.nextId()

  if (global.gc) global.gc()
  const after = process.memoryUsage().heapUsed
  const delta = (after - before) / 1024 / 1024

  console.log(`  Generated:    ${fmt(count)} IDs (not stored)`)
  console.log(`  Heap delta:   ${delta.toFixed(2)} MB`)
  console.log(`  Note: Run with --expose-gc for accurate GC-forced measurement`)
}

// ─── Main ────────────────────────────────────────────────────────────

function main() {
  console.log('='.repeat(60))
  console.log('  GenidOptimized — Environment Capability Probe')
  console.log(`  Node ${process.version} | ${process.platform} ${process.arch}`)
  console.log(`  Date: ${new Date().toISOString()}`)
  console.log('='.repeat(60))

  const singleThroughput = probeSingleCall()
  const batchThroughput = probeBatch()
  const { p99 } = probeLatency()
  probeAlgorithms()
  probeSequenceConfigs()
  probeMemory()

  // ─── Summary ───────────────────────────────────────────────────────

  separator('Summary — Recommended test thresholds')

  // Use 60% of measured peak as a safe threshold for CI
  const safeThreshold = Math.floor(singleThroughput * 0.6)
  const safeBatchThreshold = Math.floor(batchThroughput * 0.6)
  const safeP99 = Math.ceil(p99 * 3 * 10000) / 10000 // 3× headroom

  console.log(`  Peak single-call:        ${fmt(singleThroughput)} IDs/sec`)
  console.log(`  Peak batch:              ${fmt(batchThroughput)} IDs/sec`)
  console.log(
    `  Suggested min threshold: ${fmt(safeThreshold)} IDs/sec  (60% of peak)`,
  )
  console.log(
    `  Suggested batch threshold: ${fmt(safeBatchThreshold)} IDs/sec  (60% of peak)`,
  )
  console.log(`  Suggested P99 cap:       ${fmtMs(safeP99)}  (3× measured P99)`)
  console.log()
}

main()
