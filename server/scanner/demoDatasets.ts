export interface MockClickHouseCluster {
  id: string;
  name: string;
  tagline: string;
  industry: string;
  version: string;
  database: string;
  totalTables: number;
  totalParts: number;
  totalRows: number;
  totalDiskSizeBytes: number;
  totalDiskSizeFormatted: string;
  uptimeSeconds: number;
  tables: Array<{
    database: string;
    name: string;
    engine: string;
    partition_key: string;
    sorting_key: string;
    primary_key: string;
    sampling_key: string;
    total_rows: number;
    total_bytes: number;
    parts_count: number;
    active_partitions: number;
    ttl_expression: string;
    comment: string;
  }>;
  columns: Array<{
    database: string;
    table: string;
    name: string;
    type: string;
    default_type: string;
    default_expression: string;
    data_compressed_bytes: number;
    data_uncompressed_bytes: number;
    compression_codec: string;
    cardinality_approx?: number;
    is_nullable: boolean;
  }>;
  parts: Array<{
    database: string;
    table: string;
    partition: string;
    name: string;
    part_type: string;
    active: number;
    rows: number;
    bytes_on_disk: number;
    modification_time: string;
  }>;
  merges: Array<{
    database: string;
    table: string;
    elapsed: number;
    progress: number;
    num_parts: number;
    total_size_bytes_compressed: number;
    memory_usage: number;
    is_mutation: number;
  }>;
  queryLog: Array<{
    query_id: string;
    event_time: string;
    query_duration_ms: number;
    query: string;
    tables: string[];
    columns: string[];
    read_rows: number;
    read_bytes: number;
    result_rows: number;
    result_bytes: number;
    memory_usage: number;
    exception_code: number;
    exception: string;
    user: string;
    read_rows_after_pk?: number;
    used_aggregate_functions?: boolean;
    frequency_per_hour: number;
  }>;
  settings: Array<{
    name: string;
    value: string;
    changed: number;
    description: string;
    type: string;
  }>;
}

export const DEMO_CLUSTERS: Record<string, MockClickHouseCluster> = {
  apex_ecommerce: {
    id: 'apex_ecommerce',
    name: 'Apex Commerce Analytics Cluster',
    tagline: 'High-volume Multi-tenant Clickstream & Orders Data Warehouse',
    industry: 'E-Commerce & Retail',
    version: '24.3.2.31 (official build)',
    database: 'ecommerce_analytics',
    totalTables: 8,
    totalParts: 428,
    totalRows: 142500000,
    totalDiskSizeBytes: 89400000000, // ~89.4 GB
    totalDiskSizeFormatted: '89.4 GB',
    uptimeSeconds: 86400 * 14,
    tables: [
      {
        database: 'ecommerce_analytics',
        name: 'events_clickstream',
        engine: 'MergeTree',
        partition_key: 'toYYYYMM(event_time)',
        sorting_key: 'event_time, event_id', // Problem: tenant_id and session_id are filtered frequently but absent from sorting key
        primary_key: 'event_time',
        sampling_key: '',
        total_rows: 98000000,
        total_bytes: 62400000000,
        parts_count: 146, // Merge pressure: small inserts!
        active_partitions: 6,
        ttl_expression: '', // Problem: no TTL on massive 98M time-series table
        comment: 'Main user raw clickstream tracking table',
      },
      {
        database: 'ecommerce_analytics',
        name: 'orders',
        engine: 'ReplacingMergeTree(updated_at)',
        partition_key: 'toYYYYMM(order_date)',
        sorting_key: 'merchant_id, order_id, order_date',
        primary_key: 'merchant_id, order_id',
        sampling_key: '',
        total_rows: 32000000,
        total_bytes: 19800000000,
        parts_count: 38,
        active_partitions: 12,
        ttl_expression: 'order_date + INTERVAL 3 YEAR TO DISK \'cold_storage\'',
        comment: 'Orders master record with status updates',
      },
      {
        database: 'ecommerce_analytics',
        name: 'cart_events_staging',
        engine: 'Log', // Problem: Log engine used for a 12M rows high write staging table
        partition_key: '',
        sorting_key: '',
        primary_key: '',
        sampling_key: '',
        total_rows: 12500000,
        total_bytes: 7200000000,
        parts_count: 1,
        active_partitions: 1,
        ttl_expression: '',
        comment: 'Temporary staging table for cart events',
      },
    ],
    columns: [
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'event_id',
        type: 'UUID',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 1400000000,
        data_uncompressed_bytes: 1568000000,
        compression_codec: 'NONE', // Codec candidate
        is_nullable: false,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'tenant_id',
        type: 'UInt64', // Numeric oversized: tenant count is < 5000 (UInt16 suffices)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 784000000,
        data_uncompressed_bytes: 784000000,
        compression_codec: 'NONE',
        cardinality_approx: 2400,
        is_nullable: false,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'user_agent',
        type: 'Nullable(String)', // Nullable overuse
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 4200000000,
        data_uncompressed_bytes: 12500000000,
        compression_codec: 'NONE',
        is_nullable: true,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'utm_source',
        type: 'Nullable(String)', // LowCardinality candidate + Nullable overuse
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 1800000000,
        data_uncompressed_bytes: 3800000000,
        compression_codec: 'NONE',
        cardinality_approx: 18,
        is_nullable: true,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'utm_campaign',
        type: 'Nullable(String)',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 2100000000,
        data_uncompressed_bytes: 4200000000,
        compression_codec: 'NONE',
        cardinality_approx: 120,
        is_nullable: true,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'device_type',
        type: 'String', // Candidate for LowCardinality(String)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 900000000,
        data_uncompressed_bytes: 2900000000,
        compression_codec: 'NONE',
        cardinality_approx: 4, // only 'mobile', 'desktop', 'tablet', 'bot'
        is_nullable: false,
      },
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        name: 'event_time',
        type: 'DateTime',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 390000000,
        data_uncompressed_bytes: 784000000,
        compression_codec: 'NONE', // Missing DoubleDelta, ZSTD codec for monotonic time!
        is_nullable: false,
      },
      {
        database: 'ecommerce_analytics',
        table: 'orders',
        name: 'order_status',
        type: 'UInt64', // Oversized integer: only values 0-5
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 256000000,
        data_uncompressed_bytes: 256000000,
        compression_codec: 'NONE',
        cardinality_approx: 6,
        is_nullable: false,
      },
      {
        database: 'ecommerce_analytics',
        table: 'orders',
        name: 'discount_amount',
        type: 'Nullable(Float64)', // Gorilla codec + Nullable overuse
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 256000000,
        data_uncompressed_bytes: 256000000,
        compression_codec: 'NONE',
        is_nullable: true,
      },
    ],
    parts: [
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        partition: '202608',
        name: '202608_1_146_3',
        part_type: 'Compact',
        active: 1,
        rows: 98000000,
        bytes_on_disk: 62400000000,
        modification_time: '2026-08-31 06:12:00',
      },
      // 146 active parts in single partition (indicates frequent single-record inserts)
      ...Array.from({ length: 145 }).map((_, i) => ({
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        partition: '202608',
        name: `202608_${i + 147}_${i + 147}_0`,
        part_type: 'Compact',
        active: 1,
        rows: 240,
        bytes_on_disk: 180000,
        modification_time: '2026-08-31 06:30:00',
      })),
    ],
    merges: [
      {
        database: 'ecommerce_analytics',
        table: 'events_clickstream',
        elapsed: 412, // Merge elapsed > 300s
        progress: 0.18,
        num_parts: 48,
        total_size_bytes_compressed: 14200000000,
        memory_usage: 2400000000,
        is_mutation: 0,
      },
    ],
    queryLog: [
      {
        query_id: 'q_ec_001',
        event_time: '2026-08-31 06:40:12',
        query_duration_ms: 3840,
        query: 'SELECT count(), uniq(session_id) FROM events_clickstream WHERE tenant_id = 1042 AND event_time >= now() - INTERVAL 7 DAY GROUP BY device_type',
        tables: ['events_clickstream'],
        columns: ['tenant_id', 'event_time', 'session_id', 'device_type'],
        read_rows: 48500000, // Scanned 48.5M rows for 4 result rows! ORDER BY is (event_time, event_id), tenant_id is not leading
        read_rows_after_pk: 48500000,
        read_bytes: 3800000000,
        result_rows: 4,
        result_bytes: 128,
        memory_usage: 1200000000,
        exception_code: 0,
        exception: '',
        user: 'reporting_app',
        used_aggregate_functions: true,
        frequency_per_hour: 4500, // Highly repetitive query
      },
      {
        query_id: 'q_ec_002',
        event_time: '2026-08-31 06:35:00',
        query_duration_ms: 5400,
        query: 'SELECT toStartOfHour(event_time) AS hr, count(*) AS total_hits, sum(case when event_name = \'purchase\' then 1 else 0 end) FROM events_clickstream WHERE event_time >= today() - 30 GROUP BY hr',
        tables: ['events_clickstream'],
        columns: ['event_time', 'event_name'],
        read_rows: 92000000, // Full scan on massive aggregation
        read_rows_after_pk: 92000000,
        read_bytes: 8400000000,
        result_rows: 720,
        result_bytes: 24000,
        memory_usage: 1900000000,
        exception_code: 0,
        exception: '',
        user: 'dashboard_service',
        used_aggregate_functions: true,
        frequency_per_hour: 1200, // High redundant compute -> Candidate for Materialized View
      },
      {
        query_id: 'q_ec_003',
        event_time: '2026-08-31 06:20:00',
        query_duration_ms: 2900,
        query: 'SELECT * FROM cart_events_staging WHERE cart_id = \'c_99428\' LIMIT 1',
        tables: ['cart_events_staging'],
        columns: ['cart_id'],
        read_rows: 12500000, // Full scan on Log table
        read_rows_after_pk: 12500000,
        read_bytes: 7200000000,
        result_rows: 1,
        result_bytes: 512,
        memory_usage: 600000000,
        exception_code: 0,
        exception: '',
        user: 'checkout_api',
        used_aggregate_functions: false,
        frequency_per_hour: 800,
      },
    ],
    settings: [
      {
        name: 'max_threads',
        value: '16',
        changed: 1,
        description: 'The maximum number of threads to execute the request.',
        type: 'UInt64',
      },
      {
        name: 'background_pool_size',
        value: '8', // Too low for 146 parts per partition and active merges
        changed: 1,
        description: 'Number of threads for background operations.',
        type: 'UInt64',
      },
      {
        name: 'max_memory_usage',
        value: '10000000000', // 10 GB
        changed: 1,
        description: 'Maximum RAM per query.',
        type: 'UInt64',
      },
      {
        name: 'optimize_trivial_approximate_count_query',
        value: '1',
        changed: 0,
        description: 'Optimization for count()',
        type: 'Bool',
      },
    ],
  },

  nexus_iot: {
    id: 'nexus_iot',
    name: 'Nexus IoT Telemetry & Diagnostics',
    tagline: 'High-frequency Sensor Monitoring & Edge Gateway Timeseries',
    industry: 'IoT & Smart Manufacturing',
    version: '24.1.5.12 (official build)',
    database: 'telemetry_db',
    totalTables: 6,
    totalParts: 1350,
    totalRows: 1240000000, // 1.24 Billion rows
    totalDiskSizeBytes: 240000000000, // 240 GB
    totalDiskSizeFormatted: '240.0 GB',
    uptimeSeconds: 86400 * 45,
    tables: [
      {
        database: 'telemetry_db',
        name: 'sensor_metrics_raw',
        engine: 'MergeTree',
        partition_key: 'toYYYYMMDD(timestamp)', // Massive Partition Explosion: 1,095 partitions across 3 years!
        sorting_key: 'timestamp, device_id',
        primary_key: 'timestamp',
        sampling_key: '',
        total_rows: 1150000000,
        total_bytes: 215000000000,
        parts_count: 1280, // Over 1,200 active partitions
        active_partitions: 1095,
        ttl_expression: '', // No TTL for raw high-rate metrics
        comment: 'Sub-second raw voltage, temperature, vibration sensor streams',
      },
      {
        database: 'telemetry_db',
        name: 'device_state_snapshots',
        engine: 'ReplacingMergeTree(version)',
        partition_key: 'toYYYYMM(snapshot_date)',
        sorting_key: 'site_id, device_id',
        primary_key: 'site_id, device_id',
        sampling_key: '',
        total_rows: 90000000,
        total_bytes: 25000000000,
        parts_count: 70,
        active_partitions: 6,
        ttl_expression: 'snapshot_date + INTERVAL 1 YEAR',
        comment: 'Daily aggregated device health snapshots',
      },
    ],
    columns: [
      {
        database: 'telemetry_db',
        table: 'sensor_metrics_raw',
        name: 'voltage',
        type: 'Float64', // Missing Gorilla codec for float timeseries (Gorilla saves ~65% storage)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 18400000000,
        data_uncompressed_bytes: 92000000000,
        compression_codec: 'NONE',
        is_nullable: false,
      },
      {
        database: 'telemetry_db',
        table: 'sensor_metrics_raw',
        name: 'temperature',
        type: 'Float32', // Missing Gorilla codec
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 14200000000,
        data_uncompressed_bytes: 46000000000,
        compression_codec: 'NONE',
        is_nullable: false,
      },
      {
        database: 'telemetry_db',
        table: 'sensor_metrics_raw',
        name: 'sensor_tag',
        type: 'String', // Candidate for LowCardinality(String)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 12000000000,
        data_uncompressed_bytes: 34000000000,
        compression_codec: 'NONE',
        cardinality_approx: 32,
        is_nullable: false,
      },
      {
        database: 'telemetry_db',
        table: 'sensor_metrics_raw',
        name: 'device_uuid',
        type: 'FixedString(36)',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 28000000000,
        data_uncompressed_bytes: 41400000000,
        compression_codec: 'NONE',
        cardinality_approx: 150000,
        is_nullable: false,
      },
    ],
    parts: [
      {
        database: 'telemetry_db',
        table: 'sensor_metrics_raw',
        partition: '20260831',
        name: '20260831_1_22_1',
        part_type: 'Wide',
        active: 1,
        rows: 2400000,
        bytes_on_disk: 480000000,
        modification_time: '2026-08-31 05:45:00',
      },
    ],
    merges: [],
    queryLog: [
      {
        query_id: 'q_iot_001',
        event_time: '2026-08-31 06:15:22',
        query_duration_ms: 12400,
        query: 'SELECT avg(voltage), max(temperature) FROM sensor_metrics_raw WHERE device_uuid = \'e94b28a1-872f-45b0-96f3-10ba48cc0041\' AND timestamp >= now() - INTERVAL 24 HOUR',
        tables: ['sensor_metrics_raw'],
        columns: ['device_uuid', 'timestamp', 'voltage', 'temperature'],
        read_rows: 45000000, // Scans full 24hr partitions because device_uuid has no skip index and is not in primary key
        read_rows_after_pk: 45000000,
        read_bytes: 3200000000,
        result_rows: 1,
        result_bytes: 32,
        memory_usage: 3400000000,
        exception_code: 0,
        exception: '',
        user: 'fleet_manager_api',
        used_aggregate_functions: true,
        frequency_per_hour: 2800,
      },
    ],
    settings: [
      {
        name: 'max_threads',
        value: '4', // Bottleneck on high core hardware
        changed: 1,
        description: 'The maximum number of threads to execute the request.',
        type: 'UInt64',
      },
      {
        name: 'background_pool_size',
        value: '4', // Inadequate for 1,000+ partitions
        changed: 1,
        description: 'Number of threads for background operations.',
        type: 'UInt64',
      },
      {
        name: 'max_memory_usage',
        value: '20000000000',
        changed: 0,
        description: 'Maximum RAM per query.',
        type: 'UInt64',
      },
    ],
  },

  finpulse_ledger: {
    id: 'finpulse_ledger',
    name: 'FinPulse Payment Core & Ledger',
    tagline: 'Double-entry Financial Transactions & Fraud Stream Auditing',
    industry: 'FinTech & Banking',
    version: '24.2.1.20',
    database: 'ledger_core',
    totalTables: 5,
    totalParts: 180,
    totalRows: 68000000,
    totalDiskSizeBytes: 42000000000,
    totalDiskSizeFormatted: '42.0 GB',
    uptimeSeconds: 86400 * 30,
    tables: [
      {
        database: 'ledger_core',
        name: 'transactions',
        engine: 'ReplacingMergeTree(updated_at)',
        partition_key: 'toYYYYMM(created_at)',
        sorting_key: 'account_id, created_at, tx_id',
        primary_key: 'account_id, created_at',
        sampling_key: '',
        total_rows: 55000000,
        total_bytes: 34000000000,
        parts_count: 52,
        active_partitions: 18,
        ttl_expression: '',
        comment: 'Financial ledger transactions stream',
      },
      {
        database: 'ledger_core',
        name: 'fraud_alerts',
        engine: 'MergeTree',
        partition_key: 'toYYYYMM(created_at)',
        sorting_key: 'risk_level, created_at',
        primary_key: 'risk_level',
        sampling_key: '',
        total_rows: 13000000,
        total_bytes: 8000000000,
        parts_count: 28,
        active_partitions: 6,
        ttl_expression: 'created_at + INTERVAL 180 DAY',
        comment: 'Real-time rule engine alerts',
      },
    ],
    columns: [
      {
        database: 'ledger_core',
        table: 'transactions',
        name: 'tx_hash',
        type: 'String', // Missing Bloom Filter Skip Index
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 3200000000,
        data_uncompressed_bytes: 5500000000,
        compression_codec: 'NONE',
        cardinality_approx: 55000000,
        is_nullable: false,
      },
      {
        database: 'ledger_core',
        table: 'transactions',
        name: 'status_code',
        type: 'UInt64', // Oversized integer: only 4 statuses (SUCCESS, PENDING, REJECTED, REFUNDED)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 440000000,
        data_uncompressed_bytes: 440000000,
        compression_codec: 'NONE',
        cardinality_approx: 4,
        is_nullable: false,
      },
      {
        database: 'ledger_core',
        table: 'transactions',
        name: 'currency',
        type: 'String', // Candidate for LowCardinality(String) (only ~15 currencies)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 680000000,
        data_uncompressed_bytes: 1650000000,
        compression_codec: 'NONE',
        cardinality_approx: 15,
        is_nullable: false,
      },
      {
        database: 'ledger_core',
        table: 'transactions',
        name: 'note_nullable',
        type: 'Nullable(String)',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 1800000000,
        data_uncompressed_bytes: 4200000000,
        compression_codec: 'NONE',
        is_nullable: true,
      },
    ],
    parts: [
      {
        database: 'ledger_core',
        table: 'transactions',
        partition: '202608',
        name: '202608_1_52_2',
        part_type: 'Compact',
        active: 1,
        rows: 55000000,
        bytes_on_disk: 34000000000,
        modification_time: '2026-08-31 04:00:00',
      },
    ],
    merges: [],
    queryLog: [
      {
        query_id: 'q_fin_001',
        event_time: '2026-08-31 06:30:11',
        query_duration_ms: 4100,
        query: 'SELECT * FROM transactions WHERE tx_hash = \'0x8a9bf34cd871e92a01\' LIMIT 1',
        tables: ['transactions'],
        columns: ['tx_hash'],
        read_rows: 55000000, // Full scan on 55M rows for 1 row lookup!
        read_rows_after_pk: 55000000,
        read_bytes: 34000000000,
        result_rows: 1,
        result_bytes: 480,
        memory_usage: 2100000000,
        exception_code: 0,
        exception: '',
        user: 'support_portal',
        used_aggregate_functions: false,
        frequency_per_hour: 1600,
      },
      {
        query_id: 'q_fin_002',
        event_time: '2026-08-31 06:10:00',
        query_duration_ms: 6800,
        query: 'SELECT merchant_id, sum(amount) AS total_vol, count() AS tx_count FROM transactions FINAL WHERE created_at >= today() - 7 GROUP BY merchant_id',
        tables: ['transactions'],
        columns: ['merchant_id', 'amount', 'created_at'],
        read_rows: 14000000,
        read_rows_after_pk: 14000000,
        read_bytes: 2800000000,
        result_rows: 450,
        result_bytes: 18000,
        memory_usage: 2800000000,
        exception_code: 0,
        exception: '',
        user: 'settlement_worker',
        used_aggregate_functions: true,
        frequency_per_hour: 300,
      },
    ],
    settings: [
      {
        name: 'max_threads',
        value: '16',
        changed: 0,
        description: 'The maximum number of threads to execute the request.',
        type: 'UInt64',
      },
      {
        name: 'max_memory_usage',
        value: '2147483648', // 2 GB - dangerously low for heavy group by / FINAL queries!
        changed: 1,
        description: 'Maximum RAM per query.',
        type: 'UInt64',
      },
    ],
  },

  cloudtrace_logs: {
    id: 'cloudtrace_logs',
    name: 'CloudTrace Observability Platform',
    tagline: 'Distributed Kubernetes Application Logs & Traces',
    industry: 'DevOps & Observability',
    version: '24.3.1.1',
    database: 'observability_logs',
    totalTables: 4,
    totalParts: 310,
    totalRows: 380000000,
    totalDiskSizeBytes: 98000000000,
    totalDiskSizeFormatted: '98.0 GB',
    uptimeSeconds: 86400 * 20,
    tables: [
      {
        database: 'observability_logs',
        name: 'container_logs',
        engine: 'MergeTree',
        partition_key: 'toYYYYMM(timestamp)',
        sorting_key: 'cluster_id, namespace, timestamp',
        primary_key: 'cluster_id, namespace',
        sampling_key: '',
        total_rows: 350000000,
        total_bytes: 91000000000,
        parts_count: 188, // High merge pressure
        active_partitions: 4,
        ttl_expression: '', // No TTL for massive container logs
        comment: 'Stdout/stderr container application logs',
      },
      {
        database: 'observability_logs',
        name: 'audit_events_temp',
        engine: 'TinyLog', // TinyLog for 30M rows table!
        partition_key: '',
        sorting_key: '',
        primary_key: '',
        sampling_key: '',
        total_rows: 30000000,
        total_bytes: 7000000000,
        parts_count: 1,
        active_partitions: 1,
        ttl_expression: '',
        comment: 'Security audit events staging table',
      },
    ],
    columns: [
      {
        database: 'observability_logs',
        table: 'container_logs',
        name: 'service_name',
        type: 'String', // LowCardinality candidate (~45 microservices)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 8400000000,
        data_uncompressed_bytes: 28000000000,
        compression_codec: 'NONE',
        cardinality_approx: 45,
        is_nullable: false,
      },
      {
        database: 'observability_logs',
        table: 'container_logs',
        name: 'log_level',
        type: 'String', // LowCardinality candidate ('INFO', 'WARN', 'ERROR', 'DEBUG')
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 4200000000,
        data_uncompressed_bytes: 14000000000,
        compression_codec: 'NONE',
        cardinality_approx: 5,
        is_nullable: false,
      },
      {
        database: 'observability_logs',
        table: 'container_logs',
        name: 'region',
        type: 'String', // LowCardinality candidate ('us-east-1', 'eu-west-1', etc.)
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 5100000000,
        data_uncompressed_bytes: 17500000000,
        compression_codec: 'NONE',
        cardinality_approx: 8,
        is_nullable: false,
      },
      {
        database: 'observability_logs',
        table: 'container_logs',
        name: 'message',
        type: 'String',
        default_type: '',
        default_expression: '',
        data_compressed_bytes: 42000000000,
        data_uncompressed_bytes: 160000000000,
        compression_codec: 'NONE', // Missing CODEC(ZSTD(6)) for cold log text
        is_nullable: false,
      },
    ],
    parts: [
      {
        database: 'observability_logs',
        table: 'container_logs',
        partition: '202608',
        name: '202608_1_188_3',
        part_type: 'Wide',
        active: 1,
        rows: 350000000,
        bytes_on_disk: 91000000000,
        modification_time: '2026-08-31 06:22:00',
      },
    ],
    merges: [
      {
        database: 'observability_logs',
        table: 'container_logs',
        elapsed: 480, // Stuck merge > 400s
        progress: 0.12,
        num_parts: 62,
        total_size_bytes_compressed: 28000000000,
        memory_usage: 4200000000,
        is_mutation: 0,
      },
    ],
    queryLog: [
      {
        query_id: 'q_log_001',
        event_time: '2026-08-31 06:38:00',
        query_duration_ms: 8900,
        query: 'SELECT count(), service_name FROM container_logs WHERE log_level = \'ERROR\' AND timestamp >= now() - INTERVAL 1 HOUR GROUP BY service_name',
        tables: ['container_logs'],
        columns: ['log_level', 'timestamp', 'service_name'],
        read_rows: 85000000, // Scans full partition because log_level is not in PK and has no skip index
        read_rows_after_pk: 85000000,
        read_bytes: 6800000000,
        result_rows: 18,
        result_bytes: 576,
        memory_usage: 2400000000,
        exception_code: 0,
        exception: '',
        user: 'grafana_alerting',
        used_aggregate_functions: true,
        frequency_per_hour: 7200,
      },
    ],
    settings: [
      {
        name: 'max_threads',
        value: '16',
        changed: 0,
        description: 'The maximum number of threads to execute the request.',
        type: 'UInt64',
      },
      {
        name: 'background_pool_size',
        value: '16',
        changed: 0,
        description: 'Number of threads for background operations.',
        type: 'UInt64',
      },
    ],
  },
};
