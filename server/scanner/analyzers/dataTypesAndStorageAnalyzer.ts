import { RawClusterData } from '../clickhouseClient.js';
import { Finding } from '../../../src/types/yachiru.js';
import { DIMENSION_METADATA, formatBytes } from './analyzerUtils.js';

export function analyzeDataTypesAndStorage(data: RawClusterData, nextId: (code: string) => string): Finding[] {
  const findings: Finding[] = [];
  const dim = 'data_types_and_storage';
  const dimName = DIMENSION_METADATA[dim].name;

  // 5.1 Nullable Column Overuse
  const nullableCols = data.columns.filter((c) => c.type && c.type.startsWith('Nullable('));
  if (nullableCols.length > 5) {
    const tableCounts: Record<string, number> = {};
    for (const c of nullableCols) {
      tableCounts[c.table] = (tableCounts[c.table] || 0) + 1;
    }

    const mostImpactedTable = Object.entries(tableCounts).sort((a, b) => b[1] - a[1])[0];
    const impactedTableName = mostImpactedTable ? mostImpactedTable[0] : (nullableCols[0]?.table || 'table');
    const tableNullableCols = nullableCols.filter((c) => c.table === impactedTableName);
    const targetDb = data.database || data.tables.find((t) => t.name === impactedTableName)?.database || 'default';

    // Generate accurate alter statements from actual column names
    const sampleCol = tableNullableCols[0];
    const innerType = sampleCol.type.replace(/^Nullable\((.*)\)$/, '$1');

    findings.push({
      id: nextId('DTS'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'warning',
      title: `Excessive Nullable Columns (${tableNullableCols.length} in table '${impactedTableName}')`,
      tableName: impactedTableName,
      what: `Found ${tableNullableCols.length} Nullable(...) columns in table '${impactedTableName}' (e.g. ${tableNullableCols.slice(0, 3).map((c) => c.name).join(', ')}). In total, ${nullableCols.length} Nullable columns exist across the database.`,
      whyTechnical: `Nullable types in ClickHouse create a separate null mask stream (.null file) alongside the data column. This introduces additional file descriptors, prevents optimal vectorization (SIMD) in aggregation functions, and degrades compression ratios by 15-30%.`,
      whyNarrative: `Using Nullable adds a hidden byte flag for every single row. In ClickHouse, it is standard practice to use domain-specific defaults (e.g. '' for empty String, 0 for numeric, 1970-01-01 for Date) instead of Nullable.`,
      recommendationSummary: `Convert Nullable columns to default values and non-null types.`,
      recommendationSql: `-- Convert '${sampleCol.name}' to non-nullable type
ALTER TABLE ${targetDb}.${impactedTableName}
MODIFY COLUMN ${sampleCol.name} ${innerType} DEFAULT ${innerType.includes('String') ? "''" : '0'};`,
      estimatedImpact: {
        metric: 'Storage & Vectorization Speed',
        magnitude: '15% - 30% storage savings',
        description: 'Eliminates .null files and enables vectorized SIMD processing.',
      },
      metrics: {
        impactedTable: impactedTableName,
        nullableCount: tableNullableCols.length,
        columns: tableNullableCols.map((c) => c.name),
      },
      relativePriority: {
        rank: 3,
        effort: 'Medium',
        impact: 'Medium',
        justification: 'Removing Nullable improves query memory efficiency and reduces disk footprints.',
      },
    });
  }

  // 5.2 Missing LowCardinality on repetitive String columns
  const stringCols = data.columns.filter((c) => c.type === 'String');
  const lowCardCandidates = stringCols.filter((c) =>
    c.name.includes('status') ||
    c.name.includes('type') ||
    c.name.includes('category') ||
    c.name.includes('country') ||
    c.name.includes('platform') ||
    c.name.includes('currency')
  );

  if (lowCardCandidates.length > 0) {
    const candidate = lowCardCandidates[0];
    const targetDb = data.database || data.tables.find((t) => t.name === candidate.table)?.database || 'default';

    findings.push({
      id: nextId('DTS'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'warning',
      title: `Candidate for LowCardinality: Column '${candidate.table}.${candidate.name}'`,
      tableName: candidate.table,
      what: `Column '${candidate.name}' in table '${candidate.table}' is stored as standard 'String' (${formatBytes(candidate.data_compressed_bytes || 0)} compressed). Column name indicates repetitive discrete values.`,
      whyTechnical: `LowCardinality(String) creates a dictionary-encoded integer index for unique string tokens. For columns with < 10,000 unique values, this yields 3x-8x higher compression and faster GROUP BY / WHERE filtering.`,
      whyNarrative: `Columns like status, country, or category repeat the same strings over and over. LowCardinality converts these into a numeric dictionary, saving disk space and speeding up aggregations.`,
      recommendationSummary: `Convert column '${candidate.name}' to LowCardinality(String).`,
      recommendationSql: `-- Convert column to LowCardinality dictionary encoding
ALTER TABLE ${targetDb}.${candidate.table}
MODIFY COLUMN ${candidate.name} LowCardinality(String);`,
      estimatedImpact: {
        metric: 'Column Storage & Aggregation Speed',
        magnitude: '3x - 5x compression boost',
        description: `Shrinks '${candidate.name}' disk size and accelerates GROUP BY filtering.`,
      },
      metrics: {
        table: candidate.table,
        column: candidate.name,
        compressedBytes: candidate.data_compressed_bytes,
        uncompressedBytes: candidate.data_uncompressed_bytes,
      },
      relativePriority: {
        rank: 2,
        effort: 'Low',
        impact: 'High',
        justification: 'LowCardinality conversion can be run online with immediate storage and speed gains.',
      },
    });
  }

  // 5.3 Missing Compression Codecs (ZSTD / Gorilla / Delta)
  const uncodecedBigCols = data.columns.filter(
    (c) => (!c.compression_codec || c.compression_codec === 'NONE') && (c.data_uncompressed_bytes > 1_000_000_000)
  );

  if (uncodecedBigCols.length > 0) {
    const bigCol = uncodecedBigCols[0];
    const isFloat = bigCol.type.includes('Float');
    const isIntOrDate = bigCol.type.includes('Int') || bigCol.type.includes('Date') || bigCol.type.includes('Time');
    const suggestedCodec = isFloat ? 'Gorilla, ZSTD(3)' : isIntOrDate ? 'Delta, ZSTD(3)' : 'ZSTD(3)';
    const targetDb = data.database || data.tables.find((t) => t.name === bigCol.table)?.database || 'default';

    findings.push({
      id: nextId('DTS'),
      dimension: dim,
      dimensionName: dimName,
      severity: 'warning',
      title: `Missing Specialized Compression Codec on '${bigCol.table}.${bigCol.name}' (${formatBytes(bigCol.data_uncompressed_bytes)})`,
      tableName: bigCol.table,
      what: `Column '${bigCol.name}' in table '${bigCol.table}' has ${formatBytes(bigCol.data_uncompressed_bytes)} of uncompressed data with default LZ4/NONE codec.`,
      whyTechnical: `Specialized codecs (Delta for monotonically increasing series, Gorilla for floating-point metrics, and ZSTD for high-density text/integers) achieve 2x-4x better compression ratios than default LZ4.`,
      whyNarrative: `By adding specialized compression (like Delta or Gorilla with ZSTD), you can reduce disk footprint by up to 50% without meaningful CPU penalty.`,
      recommendationSummary: `Apply CODEC(${suggestedCodec}) to column '${bigCol.name}'.`,
      recommendationSql: `-- Apply specialized compression codec
ALTER TABLE ${targetDb}.${bigCol.table}
MODIFY COLUMN ${bigCol.name} CODEC(${suggestedCodec});`,
      estimatedImpact: {
        metric: 'Column Storage Reduction',
        magnitude: '30% - 60% disk savings',
        description: `Shrinks column disk footprint from ${formatBytes(bigCol.data_uncompressed_bytes)} significantly.`,
      },
      metrics: {
        table: bigCol.table,
        column: bigCol.name,
        type: bigCol.type,
        uncompressedBytes: bigCol.data_uncompressed_bytes,
      },
      relativePriority: {
        rank: 3,
        effort: 'Low',
        impact: 'Medium',
        justification: 'Specialized codecs reduce disk storage and I/O bus bandwidth.',
      },
    });
  }

  return findings;
}
