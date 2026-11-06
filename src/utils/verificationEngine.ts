import {
  AnalysisCoverage,
  CategoryScore,
  CheckCategory,
  CheckFinding,
  CheckSeverity,
  CostModel,
  ExpectedImpactRange,
  MetricComparisonItem,
  MetricResultStatus,
  TableMetadata,
  TargetOutcomeStatus,
  VerificationChecklistItem,
  VerificationComparability,
  VerificationSession,
  VerificationStatus,
} from '../types.js';
import { DEFAULT_COST_MODEL } from './costModel.js';

// ---------------------------------------------------------------------------
// 1. Verification State Machine
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  pending_baseline: ['baseline_captured', 'cancelled'],
  baseline_captured: ['remediation_in_progress', 'cancelled'],
  remediation_in_progress: ['awaiting_verification', 'cancelled'],
  awaiting_verification: [
    'verified',
    'partially_verified',
    'not_improved',
    'regression_detected',
    'inconclusive',
    'remediation_in_progress',
    'cancelled',
  ],
  verified: ['awaiting_verification', 'cancelled'], // Allow re-verification / renewal
  partially_verified: ['awaiting_verification', 'remediation_in_progress', 'cancelled'],
  not_improved: ['awaiting_verification', 'remediation_in_progress', 'cancelled'],
  regression_detected: ['awaiting_verification', 'remediation_in_progress', 'cancelled'],
  inconclusive: ['awaiting_verification', 'remediation_in_progress', 'cancelled'],
  cancelled: [], // Terminal
};

export function isValidVerificationTransition(
  from: VerificationStatus,
  to: VerificationStatus
): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function assertValidVerificationTransition(
  from: VerificationStatus,
  to: VerificationStatus
): void {
  if (!isValidVerificationTransition(from, to)) {
    throw new Error(
      `Invalid verification state transition: cannot transition from '${from}' to '${to}'.`
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Safe Math & Formatting Helpers
// ---------------------------------------------------------------------------

export function calculateAbsoluteChange(
  before: number | null | undefined,
  after: number | null | undefined
): number | null {
  if (before === null || before === undefined || after === null || after === undefined) {
    return null;
  }
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return null;
  }
  return after - before;
}

export function calculatePercentageChange(
  before: number | null | undefined,
  after: number | null | undefined
): number | null {
  if (before === null || before === undefined || after === null || after === undefined) {
    return null;
  }
  if (!Number.isFinite(before) || !Number.isFinite(after)) {
    return null;
  }
  if (before === 0) {
    if (after === 0) return 0;
    return null; // Cannot compute percentage change from 0 baseline
  }
  const pct = ((after - before) / Math.abs(before)) * 100;
  return Number(pct.toFixed(2));
}

export function formatMetricValue(
  value: number | null | undefined,
  unit: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Not measured';
  }

  if (unit === 'bytes') {
    return formatBytes(value);
  }
  if (unit === 'ratio') {
    return `${value.toFixed(2)}x`;
  }
  if (unit === 'ms') {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)} s`;
    }
    return `${Math.round(value)} ms`;
  }
  if (unit === 'count' || unit === 'rows') {
    return Number(value).toLocaleString();
  }
  if (unit === 'pct') {
    return `${value.toFixed(1)}%`;
  }
  return `${value.toLocaleString()} ${unit}`;
}

export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const safeI = Math.min(i, sizes.length - 1);
  return `${(bytes / Math.pow(k, safeI)).toFixed(2)} ${sizes[safeI] || 'PB'}`;
}

// ---------------------------------------------------------------------------
// 3. Metric Comparison Evaluation
// ---------------------------------------------------------------------------

export function evaluateMetricStatus(
  percentageChange: number | null,
  higherIsBetter: boolean,
  thresholdPct: number = 3.0
): MetricResultStatus {
  if (percentageChange === null || !Number.isFinite(percentageChange)) {
    return 'insufficient_data';
  }

  if (higherIsBetter) {
    if (percentageChange >= thresholdPct) return 'improved';
    if (percentageChange <= -thresholdPct) return 'regressed';
    return 'unchanged';
  } else {
    // Lower is better (e.g. storage bytes, duration, rows, parts)
    if (percentageChange <= -thresholdPct) return 'improved';
    if (percentageChange >= thresholdPct) return 'regressed';
    return 'unchanged';
  }
}

export function buildMetricComparisonItem(
  metricKey: string,
  label: string,
  unit: string,
  before: number | null | undefined,
  after: number | null | undefined,
  higherIsBetter: boolean,
  caveat?: string
): MetricComparisonItem {
  const beforeVal = before !== undefined && before !== null && Number.isFinite(before) ? before : null;
  const afterVal = after !== undefined && after !== null && Number.isFinite(after) ? after : null;

  const absoluteChange = calculateAbsoluteChange(beforeVal, afterVal);
  const percentageChange = calculatePercentageChange(beforeVal, afterVal);

  const status =
    beforeVal === null || afterVal === null
      ? 'insufficient_data'
      : evaluateMetricStatus(percentageChange, higherIsBetter);

  let formattedChange = 'No change';
  if (percentageChange !== null) {
    const sign = percentageChange > 0 ? '+' : '';
    formattedChange = `${sign}${percentageChange.toFixed(1)}% (${formatMetricValue(absoluteChange, unit)})`;
  } else if (absoluteChange !== null) {
    const sign = absoluteChange > 0 ? '+' : '';
    formattedChange = `${sign}${formatMetricValue(absoluteChange, unit)}`;
  } else {
    formattedChange = '—';
  }

  return {
    metricKey,
    label,
    unit,
    beforeValue: beforeVal,
    afterValue: afterVal,
    absoluteChange,
    percentageChange,
    higherIsBetter,
    status,
    formattedBefore: formatMetricValue(beforeVal, unit),
    formattedAfter: formatMetricValue(afterVal, unit),
    formattedChange,
    caveat,
  };
}

// ---------------------------------------------------------------------------
// 4. Baseline Metric Extraction
// ---------------------------------------------------------------------------

export function extractBaselineMetrics(
  finding: CheckFinding,
  tables: TableMetadata[]
): {
  metrics: Record<string, number | string | null | undefined>;
  tableMeta?: TableMetadata;
  expectedImpact?: ExpectedImpactRange;
  riskLevel: 'low' | 'medium' | 'high';
  rollbackGuidance: string;
} {
  const tableMeta = finding.table
    ? tables.find((t) => t.name.toLowerCase() === finding.table!.toLowerCase())
    : undefined;

  const rawMetrics: Record<string, number | string | null | undefined> = {};

  // 1. Column metrics if available
  if (finding.metrics?.columnCompressedBytes !== undefined) {
    rawMetrics.column_compressed_bytes = finding.metrics.columnCompressedBytes;
  }
  if (finding.metrics?.columnUncompressedBytes !== undefined) {
    rawMetrics.column_uncompressed_bytes = finding.metrics.columnUncompressedBytes;
  }
  if (finding.metrics?.compressionRatio !== undefined) {
    rawMetrics.compression_ratio = finding.metrics.compressionRatio;
  }
  if (finding.metrics?.columnName) {
    rawMetrics.column_name = finding.metrics.columnName;
  }
  if (finding.metrics?.columnType) {
    rawMetrics.column_type = finding.metrics.columnType;
  }
  if (finding.metrics?.suggestedType) {
    rawMetrics.suggested_type = finding.metrics.suggestedType;
  }

  // 2. Query workload metrics if available
  if (finding.metrics?.queryReadBytes !== undefined) {
    rawMetrics.query_read_bytes = finding.metrics.queryReadBytes;
  }
  if (finding.metrics?.queryReadRows !== undefined) {
    rawMetrics.query_read_rows = finding.metrics.queryReadRows;
  }
  if (finding.metrics?.queryDurationMs !== undefined) {
    rawMetrics.query_duration_ms = finding.metrics.queryDurationMs;
  }
  if (finding.metrics?.queryAmplificationRatio !== undefined) {
    rawMetrics.query_amplification_ratio = finding.metrics.queryAmplificationRatio;
  }
  if (finding.metrics?.dailyExecutions !== undefined) {
    rawMetrics.daily_executions = finding.metrics.dailyExecutions;
  }
  if (finding.metrics?.dailyScannedBytes !== undefined) {
    rawMetrics.daily_scanned_bytes = finding.metrics.dailyScannedBytes;
  }

  // 3. Table metrics if available
  if (tableMeta) {
    rawMetrics.table_compressed_bytes = tableMeta.total_bytes_compressed;
    rawMetrics.table_uncompressed_bytes = tableMeta.total_bytes_uncompressed;
    rawMetrics.table_rows = tableMeta.total_rows;
    rawMetrics.active_parts = tableMeta.active_parts;
    rawMetrics.partition_count = tableMeta.partition_count;
    if (rawMetrics.compression_ratio === undefined) {
      rawMetrics.compression_ratio = tableMeta.compression_ratio;
    }
  }

  // 4. Determine Expected Impact Range based on category and finding evidence
  let expectedImpact: ExpectedImpactRange | undefined = undefined;
  const findingId = finding.id.toLowerCase();
  const title = finding.title.toLowerCase();

  if (findingId.includes('lowcard') || title.includes('lowcardinality')) {
    expectedImpact = {
      metricKey: 'column_compressed_bytes',
      minPercentage: 15,
      maxPercentage: 45,
      description: 'Expected 15–45% reduction in compressed storage and reduced dictionary memory footprint.',
    };
  } else if (findingId.includes('numeric_narrowing') || title.includes('narrowing')) {
    expectedImpact = {
      metricKey: 'column_compressed_bytes',
      minPercentage: 20,
      maxPercentage: 50,
      description: 'Expected 20–50% storage footprint reduction from narrowed integer bitwidth.',
    };
  } else if (findingId.includes('low_compression') || finding.category === 'compression') {
    expectedImpact = {
      metricKey: 'compression_ratio',
      minPercentage: 20,
      maxPercentage: 60,
      description: 'Expected 20–60% improvement in compression ratio from specialized codec.',
    };
  } else if (findingId.includes('pruning') || finding.category === 'query_performance') {
    expectedImpact = {
      metricKey: 'query_read_bytes',
      minPercentage: 40,
      maxPercentage: 90,
      description: 'Expected 40–90% reduction in query scan bytes with proper primary key pruning.',
    };
  } else if (finding.category === 'part_health') {
    expectedImpact = {
      metricKey: 'active_parts',
      minPercentage: 30,
      maxPercentage: 80,
      description: 'Expected 30–80% reduction in active part count following batching or partition tuning.',
    };
  }

  // 5. Risk level & Rollback guidance
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let rollbackGuidance = 'Verify data consistency before proceeding.';

  if (finding.category === 'primary_key') {
    riskLevel = 'high';
    rollbackGuidance =
      'Altering ORDER BY or primary key typically requires creating a new table and executing INSERT INTO ... SELECT, or ATTACH PARTITION. Retain the old table as a backup until verification scan succeeds.';
  } else if (finding.category === 'partitioning') {
    riskLevel = 'high';
    rollbackGuidance =
      'Partition key changes cannot be altered in-place on ClickHouse MergeTree tables. A new table definition and partition copy is required. Maintain the original table as fallback.';
  } else if (finding.category === 'table_engine') {
    riskLevel = 'medium';
    rollbackGuidance =
      'Engine changes require recreating the table. Keep the source table intact while verifying.';
  } else if (finding.category === 'compression') {
    riskLevel = 'medium';
    rollbackGuidance =
      'Codec alterations apply to newly inserted or merged parts. You can revert via ALTER TABLE MODIFY COLUMN ... CODEC(Default). Existing parts remain readable.';
  } else {
    riskLevel = 'low';
    rollbackGuidance =
      'Configuration or tuning command can be restored to prior defaults if performance degrades.';
  }

  return {
    metrics: rawMetrics,
    tableMeta,
    expectedImpact,
    riskLevel,
    rollbackGuidance,
  };
}

// ---------------------------------------------------------------------------
// 5. Extract Verification Metrics from an "After" Scan
// ---------------------------------------------------------------------------

export interface TargetColumnTelemetry {
  name: string;
  type?: string;
  data_compressed_bytes?: number;
  data_uncompressed_bytes?: number;
  compressedBytes?: number;
  uncompressedBytes?: number;
  compression_codec?: string;
}

export function extractAfterMetricsForSession(
  session: VerificationSession,
  afterReport: {
    scan_id: string;
    findings: CheckFinding[];
    tables: TableMetadata[];
    categories?: CategoryScore[];
    coverage?: AnalysisCoverage;
  },
  columnTelemetry?: TargetColumnTelemetry | null
): {
  afterMetrics: Record<string, number | string | null | undefined>;
  afterTableMeta?: TableMetadata;
  findingResolved: boolean;
  categoryCheckDidNotRun: boolean;
  resolutionNote?: string;
  tableMissing: boolean;
} {
  const targetTable = session.targetTable;
  const targetColumn = session.targetColumn;

  const afterTableMeta = targetTable
    ? afterReport.tables.find((t) => t.name.toLowerCase() === targetTable.toLowerCase())
    : undefined;

  const afterMetrics: Record<string, number | string | null | undefined> = {};

  // Check if matching finding still exists in after scan
  const matchingFinding = afterReport.findings.find(
    (f) =>
      f.id === session.findingId ||
      (f.category === session.findingCategory &&
        targetTable &&
        f.table?.toLowerCase() === targetTable.toLowerCase() &&
        (!targetColumn || f.metrics?.columnName?.toLowerCase() === targetColumn.toLowerCase()))
  );

  // Check if the finding's diagnostic category actually ran in the verification scan
  const targetCategory = session.findingCategory || (session as unknown as { category?: string }).category;
  let categoryCheckDidNotRun = false;
  let resolutionNote: string | undefined = undefined;

  if (afterReport.coverage && Array.isArray(afterReport.coverage.categories)) {
    const cov = afterReport.coverage.categories.find((c) => c.id === targetCategory);
    if (cov && cov.state !== 'evaluated') {
      categoryCheckDidNotRun = true;
      resolutionNote = `Category check '${targetCategory}' was ${cov.state} in verification scan (${cov.reason || 'check unavailable'}).`;
    }
  } else if (afterReport.categories && Array.isArray(afterReport.categories) && afterReport.categories.length > 0) {
    const ran = afterReport.categories.some((c) => c.category === targetCategory);
    if (!ran) {
      categoryCheckDidNotRun = true;
      resolutionNote = `Category check '${targetCategory}' did not run in verification scan.`;
    }
  }

  let findingResolved = false;

  if (afterTableMeta) {
    afterMetrics.table_compressed_bytes = afterTableMeta.total_bytes_compressed;
    afterMetrics.table_uncompressed_bytes = afterTableMeta.total_bytes_uncompressed;
    afterMetrics.table_rows = afterTableMeta.total_rows;
    afterMetrics.active_parts = afterTableMeta.active_parts;
    afterMetrics.partition_count = afterTableMeta.partition_count;
    afterMetrics.compression_ratio = afterTableMeta.compression_ratio;
  }

  if (matchingFinding?.metrics) {
    if (matchingFinding.metrics.columnCompressedBytes !== undefined) {
      afterMetrics.column_compressed_bytes = matchingFinding.metrics.columnCompressedBytes;
    }
    if (matchingFinding.metrics.columnUncompressedBytes !== undefined) {
      afterMetrics.column_uncompressed_bytes = matchingFinding.metrics.columnUncompressedBytes;
    }
    if (matchingFinding.metrics.compressionRatio !== undefined) {
      afterMetrics.compression_ratio = matchingFinding.metrics.compressionRatio;
    }
    if (matchingFinding.metrics.queryReadBytes !== undefined) {
      afterMetrics.query_read_bytes = matchingFinding.metrics.queryReadBytes;
    }
    if (matchingFinding.metrics.queryReadRows !== undefined) {
      afterMetrics.query_read_rows = matchingFinding.metrics.queryReadRows;
    }
    if (matchingFinding.metrics.queryDurationMs !== undefined) {
      afterMetrics.query_duration_ms = matchingFinding.metrics.queryDurationMs;
    }
    if (matchingFinding.metrics.dailyExecutions !== undefined) {
      afterMetrics.daily_executions = matchingFinding.metrics.dailyExecutions;
    }
    if (matchingFinding.metrics.dailyScannedBytes !== undefined) {
      afterMetrics.daily_scanned_bytes = matchingFinding.metrics.dailyScannedBytes;
    }
  } else if (!matchingFinding && !categoryCheckDidNotRun) {
    // Finding is no longer detected, and the category check was executed
    findingResolved = true;

    // Use direct column telemetry if available
    if (columnTelemetry) {
      const colComp = columnTelemetry.compressedBytes ?? columnTelemetry.data_compressed_bytes;
      const colUncomp = columnTelemetry.uncompressedBytes ?? columnTelemetry.data_uncompressed_bytes;
      if (typeof colComp === 'number' && Number.isFinite(colComp)) {
        afterMetrics.column_compressed_bytes = colComp;
      }
      if (typeof colUncomp === 'number' && Number.isFinite(colUncomp)) {
        afterMetrics.column_uncompressed_bytes = colUncomp;
      }
      if (columnTelemetry.type) {
        afterMetrics.column_type = columnTelemetry.type;
      }
    }
  }

  const tableMissing = Boolean(
    targetTable &&
      Array.isArray(afterReport.tables) &&
      afterReport.tables.length > 0 &&
      !afterTableMeta
  );

  return {
    afterMetrics,
    afterTableMeta,
    findingResolved,
    categoryCheckDidNotRun,
    resolutionNote,
    tableMissing,
  };
}

// ---------------------------------------------------------------------------
// 6. Compare Baseline and After Scans
// ---------------------------------------------------------------------------

export function compareVerificationSession(
  session: VerificationSession,
  afterScanId: string,
  afterMetrics: Record<string, number | string | null | undefined>,
  afterTableMeta?: TableMetadata,
  costModel: CostModel = DEFAULT_COST_MODEL,
  options?: {
    findingResolved?: boolean;
    categoryCheckDidNotRun?: boolean;
    tableMissing?: boolean;
  }
): {
  status: VerificationStatus;
  metricComparisons: MetricComparisonItem[];
  comparability: VerificationComparability;
  expectedImpact?: ExpectedImpactRange;
  measuredImpactSummary: NonNullable<VerificationSession['measuredImpactSummary']>;
  financialImpact?: NonNullable<VerificationSession['financialImpact']>;
} {
  const b = session.baselineMetrics;
  const a = afterMetrics;
  const comparisons: MetricComparisonItem[] = [];

  const confidenceReasons: string[] = [];
  const confoundingFactors: string[] = [];
  const caveats: string[] = [];
  let severeConfounder = false;

  // Check table existence
  if (options?.tableMissing) {
    severeConfounder = true;
    confoundingFactors.push(
      `Table '${session.targetTable}' was not found in the verification scan.`
    );
  } else if (session.targetTable && !afterTableMeta) {
    confoundingFactors.push(
      `Table '${session.targetTable}' was not found in the verification scan metadata.`
    );
  }

  // Row count stability check
  const beforeRows = typeof b.table_rows === 'number' ? b.table_rows : null;
  const afterRows = typeof a.table_rows === 'number' ? a.table_rows : null;

  if (beforeRows !== null && afterRows !== null) {
    if (beforeRows > 0 && afterRows > 0) {
      const rowRatio = afterRows / beforeRows;
      if (rowRatio < 0.7) {
        // Severe confounder: row count dropped drastically (>30% rows removed / ~70% row drop)
        severeConfounder = true;
        const pctDiff = ((afterRows - beforeRows) / beforeRows) * 100;
        confoundingFactors.push(
          `Table row count dropped drastically (${pctDiff.toFixed(1)}%), which invalidates storage reduction comparison (row deletion is not an optimization).`
        );
      } else if (rowRatio > 1.4) {
        const pctDiff = ((afterRows - beforeRows) / beforeRows) * 100;
        confoundingFactors.push(
          `Table row count changed significantly (+${pctDiff.toFixed(1)}%), which may confound absolute storage metrics.`
        );
      } else {
        confidenceReasons.push('Table row count is stable across baseline and verification scan (within ±30%).');
      }
    }
  }

  // Monitored Metric 1: Column Compressed Storage
  if (b.column_compressed_bytes !== undefined || a.column_compressed_bytes !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'column_compressed_bytes',
        'Column Compressed Footprint',
        'bytes',
        typeof b.column_compressed_bytes === 'number' ? b.column_compressed_bytes : null,
        typeof a.column_compressed_bytes === 'number' ? a.column_compressed_bytes : null,
        false
      )
    );
  }

  // Monitored Metric 2: Column Uncompressed Storage
  if (b.column_uncompressed_bytes !== undefined || a.column_uncompressed_bytes !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'column_uncompressed_bytes',
        'Column Uncompressed Footprint',
        'bytes',
        typeof b.column_uncompressed_bytes === 'number' ? b.column_uncompressed_bytes : null,
        typeof a.column_uncompressed_bytes === 'number' ? a.column_uncompressed_bytes : null,
        false
      )
    );
  }

  // Monitored Metric 3: Compression Ratio
  if (b.compression_ratio !== undefined || a.compression_ratio !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'compression_ratio',
        'Compression Ratio',
        'ratio',
        typeof b.compression_ratio === 'number' ? b.compression_ratio : null,
        typeof a.compression_ratio === 'number' ? a.compression_ratio : null,
        true
      )
    );
  }

  // Monitored Metric 4: Table Compressed Storage
  if (b.table_compressed_bytes !== undefined || a.table_compressed_bytes !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'table_compressed_bytes',
        'Table Total Compressed Storage',
        'bytes',
        typeof b.table_compressed_bytes === 'number' ? b.table_compressed_bytes : null,
        typeof a.table_compressed_bytes === 'number' ? a.table_compressed_bytes : null,
        false
      )
    );
  }

  // Monitored Metric 5: Active Parts
  if (b.active_parts !== undefined || a.active_parts !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'active_parts',
        'Active Parts Count',
        'count',
        typeof b.active_parts === 'number' ? b.active_parts : null,
        typeof a.active_parts === 'number' ? a.active_parts : null,
        false
      )
    );
  }

  // Monitored Metric 6: Query Read Bytes
  if (b.query_read_bytes !== undefined || a.query_read_bytes !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'query_read_bytes',
        'Query Bytes Scanned',
        'bytes',
        typeof b.query_read_bytes === 'number' ? b.query_read_bytes : null,
        typeof a.query_read_bytes === 'number' ? a.query_read_bytes : null,
        false
      )
    );
  }

  // Monitored Metric 7: Query Duration
  if (b.query_duration_ms !== undefined || a.query_duration_ms !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'query_duration_ms',
        'Average Query Duration',
        'ms',
        typeof b.query_duration_ms === 'number' ? b.query_duration_ms : null,
        typeof a.query_duration_ms === 'number' ? a.query_duration_ms : null,
        false
      )
    );
  }

  // Monitored Metric 8: Query Read Rows
  if (b.query_read_rows !== undefined || a.query_read_rows !== undefined) {
    comparisons.push(
      buildMetricComparisonItem(
        'query_read_rows',
        'Query Rows Scanned',
        'rows',
        typeof b.query_read_rows === 'number' ? b.query_read_rows : null,
        typeof a.query_read_rows === 'number' ? a.query_read_rows : null,
        false
      )
    );
  }

  // Check if we have any valid metric comparisons
  const validComparisons = comparisons.filter(
    (c) => c.status !== 'insufficient_data' && c.status !== 'not_comparable'
  );

  let status: VerificationStatus = 'inconclusive';

  const targetMetricKey = session.expectedImpact?.metricKey;
  const targetMetricComp = targetMetricKey
    ? comparisons.find((c) => c.metricKey === targetMetricKey)
    : undefined;

  const targetMetricCannotBeMeasured = Boolean(
    targetMetricKey &&
      (!targetMetricComp ||
        targetMetricComp.status === 'insufficient_data' ||
        targetMetricComp.status === 'not_comparable')
  );

  if (options?.categoryCheckDidNotRun) {
    status = 'inconclusive';
    caveats.push(
      'The category check for this optimization did not run in the verification scan (e.g. missing permissions or skipped check).'
    );
  } else if (targetMetricCannotBeMeasured) {
    status = 'inconclusive';
    caveats.push(`Targeted metric '${targetMetricKey}' could not be measured in the verification scan.`);
  } else if (severeConfounder) {
    status = 'inconclusive';
  } else if (validComparisons.length === 0) {
    status = 'inconclusive';
    caveats.push('Insufficient overlapping metrics between baseline and verification scan.');
  } else {
    const hasRegression = validComparisons.some((c) => c.status === 'regressed');
    const hasImprovement = validComparisons.some((c) => c.status === 'improved');
    const allImproved = validComparisons.every((c) => c.status === 'improved');

    if (hasRegression) {
      status = 'regression_detected';
    } else if (targetMetricComp && targetMetricComp.status === 'improved' && !hasRegression) {
      status = 'verified';
    } else if (options?.findingResolved && !hasRegression) {
      status = 'verified';
    } else if (allImproved) {
      status = 'verified';
    } else if (hasImprovement) {
      status = 'partially_verified';
    } else {
      status = 'not_improved';
    }
  }

  // Check confidence level
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (confoundingFactors.length > 0) {
    confidence = 'medium';
  }
  if (confoundingFactors.length > 1 || validComparisons.length === 0 || severeConfounder) {
    confidence = 'low';
  }
  if (status === 'inconclusive') {
    confidence = 'low';
  }

  const comparability: VerificationComparability = {
    isComparable: !severeConfounder && validComparisons.length > 0 && confoundingFactors.length <= 1,
    confidence,
    confidenceReasons:
      confidenceReasons.length > 0
        ? confidenceReasons
        : ['Target table and database metadata were successfully resolved.'],
    confoundingFactors,
    caveats,
  };

  // Check expected impact vs actual
  let expectedImpact = session.expectedImpact;
  if (expectedImpact) {
    const matchedComp = comparisons.find((c) => c.metricKey === expectedImpact?.metricKey);
    let targetOutcome: TargetOutcomeStatus = 'no_target_set';

    if (matchedComp && matchedComp.percentageChange !== null) {
      const pctReduction = -matchedComp.percentageChange; // For lower-is-better metrics

      if (matchedComp.status === 'regressed') {
        targetOutcome = 'regression_detected';
      } else if (matchedComp.status === 'unchanged') {
        targetOutcome = 'no_measurable_improvement';
      } else {
        const min = expectedImpact.minPercentage ?? 10;
        const max = expectedImpact.maxPercentage ?? 50;

        if (pctReduction >= max) {
          targetOutcome = 'target_achieved';
        } else if (pctReduction >= min) {
          targetOutcome = 'within_expected_range';
        } else if (pctReduction > 0) {
          targetOutcome = 'below_expected_improvement';
        } else {
          targetOutcome = 'no_measurable_improvement';
        }
      }
    } else {
      targetOutcome = 'inconclusive';
    }

    expectedImpact = {
      ...expectedImpact,
      targetAchievedStatus: targetOutcome,
    };
  }

  // Compute measured technical impact summary
  const colStorageComp = comparisons.find(
    (c) => c.metricKey === 'column_compressed_bytes' || c.metricKey === 'table_compressed_bytes'
  );
  const queryDurationComp = comparisons.find((c) => c.metricKey === 'query_duration_ms');

  const storageReductionBytes =
    colStorageComp && colStorageComp.absoluteChange !== null && colStorageComp.absoluteChange < 0
      ? Math.abs(colStorageComp.absoluteChange)
      : undefined;

  const storageReductionPercentage =
    colStorageComp && colStorageComp.percentageChange !== null && colStorageComp.percentageChange < 0
      ? Math.abs(colStorageComp.percentageChange)
      : undefined;

  const queryDurationReductionMs =
    queryDurationComp && queryDurationComp.absoluteChange !== null && queryDurationComp.absoluteChange < 0
      ? Math.abs(queryDurationComp.absoluteChange)
      : undefined;

  const queryDurationReductionPercentage =
    queryDurationComp && queryDurationComp.percentageChange !== null && queryDurationComp.percentageChange < 0
      ? Math.abs(queryDurationComp.percentageChange)
      : undefined;

  let summaryText = 'No measurable improvement detected.';
  if (status === 'verified') {
    summaryText = `Optimization successfully verified. ${
      storageReductionBytes ? `${formatBytes(storageReductionBytes)} storage reduction measured.` : ''
    } ${
      queryDurationReductionPercentage
        ? `${queryDurationReductionPercentage.toFixed(1)}% query latency improvement.`
        : ''
    }`.trim();
  } else if (status === 'partially_verified') {
    summaryText = 'Partial optimization verified: some indicators improved while others remained unchanged.';
  } else if (status === 'regression_detected') {
    summaryText = 'Regression detected: one or more monitored metrics worsened following the change.';
  } else if (status === 'inconclusive') {
    summaryText = 'Verification is inconclusive due to missing or non-comparable telemetry data.';
  }

  const isFindingResolvedOutcome = Boolean(options?.findingResolved && status === 'verified');

  const measuredImpactSummary = {
    storageReductionBytes,
    storageReductionPercentage,
    queryDurationReductionMs,
    queryDurationReductionPercentage,
    summaryText,
    overallOutcome: isFindingResolvedOutcome
      ? ('finding_resolved' as const)
      : status === 'verified'
      ? ('verified' as const)
      : status === 'partially_verified'
      ? ('partially_verified' as const)
      : status === 'regression_detected'
      ? ('regression_detected' as const)
      : status === 'not_improved'
      ? ('not_improved' as const)
      : ('inconclusive' as const),
    findingResolved: Boolean(options?.findingResolved),
  };

  // Compute Financial Impact (strictly separated from technical metrics)
  let financialImpact: NonNullable<VerificationSession['financialImpact']> | undefined = undefined;
  if (storageReductionBytes && costModel.storagePricePerGBMonth > 0) {
    const gbReduced = storageReductionBytes / (1024 * 1024 * 1024);
    const estimatedMonthlySavings = Number((gbReduced * costModel.storagePricePerGBMonth).toFixed(2));

    financialImpact = {
      estimatedMonthlySavings,
      pricingModelApplied: {
        storagePricePerGBMonth: costModel.storagePricePerGBMonth,
        computePricePerCPUHour: costModel.computePricePerCPUHour,
        queryCostPerTBScanned: costModel.queryCostPerTBScanned,
      },
      caveat:
        'Financial estimate represents on-disk storage cost reduction based on your configured rate ($' +
        costModel.storagePricePerGBMonth +
        '/GB-mo). Latency improvements are technical benefits not billed per hour.',
    };
  }

  return {
    status,
    metricComparisons: comparisons,
    comparability,
    expectedImpact,
    measuredImpactSummary,
    financialImpact,
  };
}

// ---------------------------------------------------------------------------
// 7. Initial Checklist Generator
// ---------------------------------------------------------------------------

export function createDefaultChecklist(): VerificationChecklistItem[] {
  return [
    {
      id: 'step_review_finding',
      label: 'Review finding diagnostic and understand root cause',
      completed: true,
      completedAt: new Date().toISOString(),
    },
    {
      id: 'step_review_sql',
      label: 'Inspect recommended SQL and verify schema compatibility',
      completed: false,
    },
    {
      id: 'step_apply_change',
      label: 'Apply the remediation in ClickHouse via clickhouse-client or admin console',
      completed: false,
    },
    {
      id: 'step_confirm_execution',
      label: 'Confirm change execution completed without errors',
      completed: false,
    },
    {
      id: 'step_run_rescan',
      label: 'Run a verification scan to measure before vs after impact',
      completed: false,
    },
  ];
}
