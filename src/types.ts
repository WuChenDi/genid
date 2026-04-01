/** ID generation algorithm type */
export enum GenidMethod {
  /** Drift algorithm (recommended; can exceed per-millisecond sequence limit under high concurrency) */
  DRIFT = 1,
  /** Traditional algorithm (waits for next millisecond when sequence is exhausted) */
  TRADITIONAL = 2,
}

/** Options for constructing an ID generator */
export interface GenidOptions {
  /** Worker node ID (required; range: 0 to 2^workerIdBitLength-1) */
  workerId: number
  /** Algorithm type (default: DRIFT) */
  method?: GenidMethod
  /** Base timestamp in milliseconds (default: 2020-01-01) */
  baseTime?: number
  /** Bit length of worker ID (1-15, default: 6) */
  workerIdBitLength?: number
  /** Bit length of sequence number (3-21, default: 6) */
  seqBitLength?: number
  /** Maximum sequence number (default: 2^seqBitLength - 1) */
  maxSeqNumber?: number
  /** Minimum sequence number (default: 5; values 0-4 are reserved for clock rollback) */
  minSeqNumber?: number
  /** Maximum drift count (default: 2000) */
  topOverCostCount?: number
}

/** Internal resolved config (all fields required; produced by initConfig) */
export interface GenidConfig {
  workerId: number
  method: GenidMethod
  baseTime: number
  workerIdBitLength: number
  seqBitLength: number
  maxSeqNumber: number
  minSeqNumber: number
  topOverCostCount: number
}

/** Internal runtime statistics (BigInt used for large-number precision) */
export interface Stats {
  totalGenerated: bigint
  overCostCount: bigint
  turnBackCount: bigint
  startTime: number
}

/** ID parse result */
export interface ParseResult {
  /** Generation time */
  timestamp: Date
  /** Generation timestamp in milliseconds */
  timestampMs: number
  /** Worker node ID */
  workerId: number
  /** Sequence number */
  sequence: number
}

/** Public statistics result */
export interface StatsResult {
  totalGenerated: number
  overCostCount: number
  turnBackCount: number
  /** Uptime in milliseconds */
  uptimeMs: number
  avgPerSecond: number
  currentState: 'OVER_COST' | 'NORMAL'
}

/** Options for isValid validation */
export interface ValidateOptions {
  /** When true, requires the workerId to match the current instance (default: false) */
  strictWorkerId?: boolean
  /** The ID's generation time must not be earlier than this timestamp in milliseconds (default: baseTime) */
  afterTime?: number
}

/** Configuration info */
export interface ConfigResult {
  method: 'DRIFT' | 'TRADITIONAL'
  workerId: number
  /** Format: "0-63" */
  workerIdRange: string
  /** Format: "5-63" */
  sequenceRange: string
  maxSequence: number
  idsPerMillisecond: number
  baseTime: Date
  timestampBits: number
  workerIdBits: number
  sequenceBits: number
}
