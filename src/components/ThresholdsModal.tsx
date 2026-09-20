import React from 'react';
import { X, BookOpen, ExternalLink, ShieldCheck, Sliders } from 'lucide-react';

interface ThresholdsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const THRESHOLDS_DOC = [
  {
    category: '1. Part Health & Compaction',
    systemTable: 'system.parts',
    metric: 'Active parts count per table',
    threshold: '≤ 80 parts (Optimal), 81–150 (Warning), > 150 (Critical)',
    isAdjustable: false,
    rationale:
      'ClickHouse MergeTree tables merge immutable parts in the background. If inserts are streamed too frequently (micro-batching), active parts accumulate. By default, ClickHouse starts delaying inserts at parts_to_delay_insert = 150 and raises a fatal "Too many parts in all data parts in table" error at parts_to_throw_insert = 300.',
  },
  {
    category: '2. Primary Key & ORDER BY',
    systemTable: 'system.tables, system.columns',
    metric: 'Sorting key tuple existence & column cardinality order',
    threshold: 'Non-empty ORDER BY required for > 100k rows; high-filter keys first',
    isAdjustable: false,
    rationale:
      'ClickHouse builds sparse primary indices (1 mark per 8,192 rows) ordered strictly by the ORDER BY tuple. Tables with ORDER BY tuple() cannot prune granules on WHERE filters, forcing complete table scans. Leading boolean or status columns with cardinality < 10 partition sparse marks poorly.',
  },
  {
    category: '3. Partitioning Strategy',
    systemTable: 'system.parts',
    metric: 'Total partitions per table',
    threshold: '≤ 300 partitions (Optimal), 301–1,000 (Warning), > 1,000 (Critical)',
    isAdjustable: false,
    rationale:
      'ClickHouse partitions are distinct physical directories on disk. Over-partitioning (e.g. daily partitioning over 4+ years = 1,460 partitions) creates hundreds of active file descriptors, multiplies background merge overhead, bloats metadata RAM, and significantly slows down server restarts.',
  },
  {
    category: '4. Compression Efficiency',
    systemTable: 'system.columns, system.parts_columns',
    metric: 'Compression ratio (Uncompressed bytes / Compressed bytes)',
    threshold: '≥ 1.5x for String/Array/Float; specialized codecs for time/deltas',
    isAdjustable: false,
    rationale:
      'Default LZ4 compression provides high decompression speed, but verbose string or JSON columns often achieve 3x–6x higher density with ZSTD(3). Monotonically increasing timestamps achieve 8x+ with DoubleDelta or T64 codecs. Low-cardinality strings (< 10,000 unique values) should use LowCardinality(String).',
  },
  {
    category: '5. Table Engine Sanity',
    systemTable: 'system.tables',
    metric: 'Storage Engine Type for analytical data',
    threshold: 'MergeTree-family for tables > 50k rows',
    isAdjustable: false,
    rationale:
      'Non-MergeTree engines like Log, TinyLog, or Memory lack primary indexing, column-level compression, multithreaded vectorized block reading, and disk durability across server restarts.',
  },
  {
    category: '6. Data Skipping Indices',
    systemTable: 'system.data_skipping_indices',
    metric: 'Secondary index coverage on tables > 1M rows',
    threshold: 'Presence of minmax, set, or bloom_filter indices for non-PK filter columns',
    isAdjustable: false,
    rationale:
      'When queries frequently filter by secondary IDs or UUIDs that cannot be placed in the primary ORDER BY prefix, secondary skipping indices (such as bloom_filter(0.01) GRANULARITY 4) enable ClickHouse to skip non-matching granules without decompressing column blocks.',
  },
  {
    category: '7. Query Performance & Pruning',
    systemTable: 'system.query_log',
    metric: 'Read Amplification Ratio (read_rows / result_rows)',
    threshold: '< 1,000x for filter queries; Latency ≤ 3,000ms; Memory ≤ 1GB',
    isAdjustable: true,
    configNote: 'Query duration and memory limits are adjustable in the connection form under "Show Additional Threshold Tunables". Read amplification (< 1,000x) is a fixed default.',
    rationale:
      'A query reading 10,000,000 rows to return 20 rows indicates poor index selectivity or unpruned full scans. Queries running for > 3s or consuming > 1GB memory during peak periods threaten cluster concurrency and should be reviewed for Materialized Views.',
  },
  {
    category: '8. Replication & Distributed Health',
    systemTable: 'system.replicas, system.distribution_queue',
    metric: 'is_readonly flag, replication queue size, absolute delay (s)',
    threshold: 'is_readonly = 0; queue_size ≤ 20; delay < 60s; send backlog < 100MB',
    isAdjustable: false,
    rationale:
      'A replica with is_readonly = 1 has lost synchronization with ClickHouse Keeper / ZooKeeper or has run out of disk space, halting all writes. Distributed tables with async send queue backlog indicate network stalls to remote shards.',
  },
  {
    category: '9. Server Settings Sanity',
    systemTable: 'system.settings',
    metric: 'max_memory_usage, max_threads, insert delays',
    threshold: 'max_memory_usage ≥ 8GB for large analytical workloads',
    isAdjustable: false,
    rationale:
      'Restrictive memory ceilings (e.g. max_memory_usage = 2GB) cause complex analytical GROUP BY and JOIN queries to crash with MEMORY_LIMIT_EXCEEDED. max_bytes_before_external_group_by should be configured to allow two-level spill to disk.',
  },
  {
    category: '10. Table Mutations & DDL',
    systemTable: 'system.mutations',
    metric: 'Stuck or failing table mutations (is_done = 0)',
    threshold: '0 failing mutations; runtime < 1h (Optimal), 1–6h (Warning), > 6h or fail reason (Critical)',
    isAdjustable: false,
    rationale:
      'ClickHouse mutations (ALTER ... UPDATE/DELETE) are heavy asynchronous background operations that rewrite entire data parts. Mutations with non-empty latest_fail_reason or running for hours block subsequent DDL and place extreme pressure on background merge threads.',
  },
  {
    category: '11. Disk Space & Storage Volumes',
    systemTable: 'system.disks',
    metric: 'Free disk space percentage per storage volume',
    threshold: '≥ 20% free (Optimal), 10–20% (Warning), < 10% (Critical)',
    isAdjustable: false,
    rationale:
      'ClickHouse requires temporary disk space to execute background part merges and buffer query result sets. If disk free space drops below 10%, ClickHouse triggers readonly failsafes or fails inserts with "No space left on device".',
  },
  {
    category: '12. System Errors & Cluster Stability',
    systemTable: 'system.errors',
    metric: 'Error frequency and recent exception counts in the last 24h',
    threshold: '< 100 occurrences (Optimal), 100–1,000 (Warning), > 1,000 (Critical)',
    isAdjustable: false,
    rationale:
      'The system.errors table tracks cumulative error counts across all ClickHouse subsystems. Spikes in specific error codes (e.g. MEMORY_LIMIT_EXCEEDED, TIMEOUT_EXCEEDED, CANNOT_ALLOCATE_MEMORY) identify recurring query crashes or infrastructure instability.',
  },
  {
    category: '13. Replication Queue & Sync Health',
    systemTable: 'system.replication_queue',
    metric: 'Queue backlog size and task retry counts on replicated tables',
    threshold: 'Queue size ≤ 50 tasks; task retries < 10 with 0 exceptions',
    isAdjustable: false,
    rationale:
      'The replication queue manages asynchronous part fetches and merges across ZooKeeper/Keeper replicas. Repeated failures (num_tries ≥ 10 with last_exception) indicate corrupted remote parts, network partitions, or keeper metadata divergence.',
  },
];

export const ThresholdsModal: React.FC<ThresholdsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                ClickHouse Operational Thresholds & Mechanics Guide
              </h3>
              <p className="text-xs text-zinc-400">
                Official ClickHouse engine heuristics and optimization baselines used by Yachiru
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p>
                All thresholds are grounded in official ClickHouse operational best practices and default server configuration settings (<code className="font-mono text-zinc-200">system.settings</code> and <code className="font-mono text-zinc-200">system.merge_tree_settings</code>).
              </p>
              <p className="text-zinc-400">
                <span className="text-emerald-400 font-medium">Query duration</span> and <span className="text-emerald-400 font-medium">memory thresholds</span> are user-adjustable in the connection form under &ldquo;Show Additional Threshold Tunables&rdquo;. All other rows use fixed built-in defaults.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {THRESHOLDS_DOC.map((item, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-white">{item.category}</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded border font-medium flex items-center gap-1 ${
                        item.isAdjustable
                          ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {item.isAdjustable ? (
                        <>
                          <Sliders className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>Adjustable in the connection form</span>
                        </>
                      ) : (
                        <span>Fixed default — not currently editable in the UI</span>
                      )}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-rose-400">
                      {item.systemTable}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-amber-300/90 font-mono bg-amber-950/20 px-2.5 py-1 rounded border border-amber-500/20">
                  Threshold: {item.threshold}
                </div>

                {item.configNote && (
                  <div className="text-[11px] text-emerald-400/90 bg-emerald-950/20 px-2.5 py-1 rounded border border-emerald-500/20">
                    <span className="font-semibold text-emerald-300">Configuration:</span> {item.configNote}
                  </div>
                )}

                <p className="text-xs text-zinc-300 leading-relaxed pt-1">
                  {item.rationale}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
