import { CheckFinding } from '../../src/types.js';
import { CheckEvaluationContext } from './types.js';
import { escapeSqlString, formatBytes } from './helpers.js';

export function evaluatePartHealthChecks(ctx: CheckEvaluationContext): CheckFinding[] {
  const findings: CheckFinding[] = [];

  for (const [tableName, partInfo] of ctx.partsMap.entries()) {
    const activeParts = Number(partInfo.active_parts || 0);
    const tinyParts = Number(partInfo.tiny_parts_count || 0);
    const tinyRatio = activeParts > 0 ? tinyParts / activeParts : 0;

    if (activeParts > 150) {
      findings.push({
        id: `parts_count_${tableName}`,
        category: 'part_health',
        category_name: 'Part Health & Compaction',
        title: `Excessive active parts on table '${tableName}'`,
        table: tableName,
        status: 'critical',
        metric_value: `${activeParts} active parts`,
        threshold: 'Threshold: ≤ 150 parts per table',
        evidence: `Table '${tableName}' has ${activeParts} active unmerged parts (ClickHouse default starts delaying inserts at 150 and throws errors at 300).`,
        impact: 'High active part counts spike query memory, degrade vector read speed, and risk ClickHouse "Too many parts in all data parts in table" fatal insert rejection.',
        recommendation_sql_or_text: `-- Batch your inserts into chunks of 10,000-100,000 rows rather than streaming single-row inserts.\n-- To inspect pending merges:\nSELECT table, elapsed, progress, num_parts FROM system.merges WHERE table = '${escapeSqlString(tableName)}';`,
        is_sql_recommendation: true,
      });
    } else if (activeParts > 80) {
      findings.push({
        id: `parts_count_${tableName}`,
        category: 'part_health',
        category_name: 'Part Health & Compaction',
        title: `Elevated active parts count on '${tableName}'`,
        table: tableName,
        status: 'warning',
        metric_value: `${activeParts} active parts`,
        threshold: 'Threshold: ≤ 80 parts per table',
        evidence: `Table '${tableName}' has ${activeParts} active parts. Background merge operations may be lagging behind incoming insert rates.`,
        impact: `Queries against this table must open and decompress data streams from ${activeParts} separate part directories.`,
        recommendation_sql_or_text: `-- Check background merge velocity and memory consumption:\nSELECT table, count() as active_merges, sum(bytes_read_uncompressed) as total_read FROM system.merges WHERE table = '${escapeSqlString(tableName)}' GROUP BY table;`,
        is_sql_recommendation: true,
      });
    } else {
      findings.push({
        id: `parts_count_${tableName}`,
        category: 'part_health',
        category_name: 'Part Health & Compaction',
        title: `Part count within healthy parameters for '${tableName}'`,
        table: tableName,
        status: 'good',
        metric_value: `${activeParts} active parts`,
        threshold: 'Threshold: ≤ 80 parts per table',
        evidence: `${activeParts} active parts well below throttle threshold. Background merges are keeping pace with mutations.`,
        impact: 'Minimal disk seek overhead during primary key scans.',
        recommendation_sql_or_text: 'Current batching frequency is healthy. Maintain batch inserts of >= 10k rows.',
        is_sql_recommendation: false,
      });
    }

    if (activeParts > 40 && tinyRatio > 0.5) {
      findings.push({
        id: `tiny_parts_${tableName}`,
        category: 'part_health',
        category_name: 'Part Health & Compaction',
        title: `Micro-batching detected on '${tableName}' (${Math.round(tinyRatio * 100)}% tiny parts)`,
        table: tableName,
        status: 'warning',
        metric_value: `${tinyParts} of ${activeParts} parts are < 1MB`,
        threshold: 'Threshold: < 30% parts under 1MB',
        evidence: `${tinyParts} out of ${activeParts} active parts are under 1MB in size. Average part size is ${formatBytes(Number(partInfo.avg_part_size || 0))}.`,
        impact: 'Micro-batching causes write amplification. ClickHouse must repeatedly rewrite the same records in recursive merge levels.',
        recommendation_sql_or_text: `-- Introduce a client-side buffer (e.g., Vector, Kafka engine, or async_insert):\n-- If using ClickHouse 21.11+, consider enabling asynchronous inserts on the user/session:\nSET async_insert = 1;\nSET wait_for_async_insert = 1;`,
        is_sql_recommendation: true,
      });
    }
  }

  return findings;
}
