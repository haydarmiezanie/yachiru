import { CheckFinding } from '../../src/types.js';
import { CheckEvaluationContext } from './types.js';
import { escapeSqlString, escapeSqlIdentifier, formatBytes } from './helpers.js';

export function evaluateSystemChecks(ctx: CheckEvaluationContext): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const database = ctx.database;

  // 9. Server Settings Sanity (only evaluated if system.settings was accessible)
  if (ctx.settingsAvailable && ctx.settingsData.length > 0) {
    const maxMemSetting = ctx.settingsData.find((s) => s.name === 'max_memory_usage');
    if (maxMemSetting) {
      const maxMemBytes = Number(maxMemSetting.value);
      if (maxMemBytes > 0 && maxMemBytes < 4294967296) {
        // < 4GB
        findings.push({
          id: 'low_max_memory_usage',
          category: 'server_settings',
          category_name: 'Server & MergeTree Settings',
          title: `Restrictive 'max_memory_usage' setting (${formatBytes(maxMemBytes)})`,
          status: 'warning',
          metric_value: `max_memory_usage = ${formatBytes(maxMemBytes)}`,
          threshold: 'Threshold: ≥ 8GB recommended for analytical aggregation',
          evidence: `Current max_memory_usage per query is set to ${formatBytes(maxMemBytes)}. Analytical queries with large hash tables for GROUP BY may abort with MEMORY_LIMIT_EXCEEDED.`,
          impact: 'Complex JOINs, array aggregations, and window functions will be terminated prematurely.',
          recommendation_sql_or_text: `-- Update user profile settings or query session:\nSET max_memory_usage = 10000000000; -- 10 GB`,
          is_sql_recommendation: true,
        });
      } else {
        findings.push({
          id: 'server_settings_healthy',
          category: 'server_settings',
          category_name: 'Server & MergeTree Settings',
          title: 'Memory and thread settings within operational limits',
          status: 'good',
          metric_value: maxMemBytes > 0 ? `max_memory = ${formatBytes(maxMemBytes)}` : 'Default configuration',
          threshold: 'Threshold: Adequate memory ceilings',
          evidence: 'Core query memory and background thread settings align with analytical sizing recommendations.',
          impact: 'Balanced resource allocation across concurrent queries.',
          recommendation_sql_or_text: 'Server settings are configured properly.',
          is_sql_recommendation: false,
        });
      }
    }
  }

  // 10. Mutations Health (system.mutations)
  if (ctx.mutationsAvailable && ctx.mutationsData !== null) {
    let problemMutationsCount = 0;
    for (const m of ctx.mutationsData) {
      const createTimeMs = new Date(m.create_time).getTime();
      const ageHours = !isNaN(createTimeMs) ? Math.max(0, (Date.now() - createTimeMs) / (1000 * 60 * 60)) : 0;
      const hasFailReason = Boolean(m.latest_fail_reason && m.latest_fail_reason.trim() !== '');

      const mutationType = (m.command || '').trim().split(/\s+/)[0]?.toUpperCase() || 'MUTATION';
      const qualifiedTable = `${escapeSqlIdentifier(database)}.${escapeSqlIdentifier(m.table)}`;

      if (hasFailReason) {
        problemMutationsCount++;
        findings.push({
          id: `mutation_fail_${m.table}_${m.mutation_id}`,
          category: 'mutations',
          category_name: 'Table Mutations',
          title: `Mutation repeatedly failing on '${m.table}'`,
          table: m.table,
          status: 'critical',
          metric_value: `Parts to do: ${m.parts_to_do}`,
          threshold: 'Threshold: 0 failing mutations',
          evidence: `Mutation ID '${m.mutation_id}' on table '${qualifiedTable}' (${mutationType}) failed with reason: ${m.latest_fail_reason}.\nParts remaining: ${m.parts_to_do}. Predicate expression omitted for privacy compliance.`,
          impact: 'Stuck or failing mutations block subsequent ALTER/UPDATE commands and consume background merge threads.',
          recommendation_sql_or_text: `-- Inspect stuck mutation:\nSELECT * FROM system.mutations WHERE database = '${escapeSqlString(database)}' AND table = '${escapeSqlString(m.table)}';\n-- KILL MUTATION WHERE database = '${escapeSqlString(database)}' AND mutation_id = '${escapeSqlString(m.mutation_id)}';`,
          is_sql_recommendation: true,
        });
      } else if (ageHours >= ctx.mutationCriticalAgeHours) {
        problemMutationsCount++;
        findings.push({
          id: `mutation_long_${m.table}_${m.mutation_id}`,
          category: 'mutations',
          category_name: 'Table Mutations',
          title: `Critically long-running mutation on '${m.table}' (${ageHours.toFixed(1)}h)`,
          table: m.table,
          status: 'critical',
          metric_value: `${ageHours.toFixed(1)}h runtime`,
          threshold: `Threshold: < ${ctx.mutationCriticalAgeHours}h runtime`,
          evidence: `Mutation ID '${m.mutation_id}' on table '${qualifiedTable}' (${mutationType}) has been executing for ${ageHours.toFixed(1)} hours (started: ${m.create_time}).\nParts remaining: ${m.parts_to_do}. Predicate expression omitted for privacy compliance.`,
          impact: 'Long-running table mutations cause high disk I/O load and keep unmerged parts active across replicas.',
          recommendation_sql_or_text: `-- Check mutation progress in system.mutations:\nSELECT mutation_id, command, parts_to_do, is_done FROM system.mutations WHERE database = '${escapeSqlString(database)}' AND table = '${escapeSqlString(m.table)}';`,
          is_sql_recommendation: true,
        });
      } else if (ageHours >= ctx.mutationWarningAgeHours) {
        problemMutationsCount++;
        findings.push({
          id: `mutation_warn_${m.table}_${m.mutation_id}`,
          category: 'mutations',
          category_name: 'Table Mutations',
          title: `Long-running mutation on '${m.table}' (${ageHours.toFixed(1)}h)`,
          table: m.table,
          status: 'warning',
          metric_value: `${ageHours.toFixed(1)}h runtime`,
          threshold: `Threshold: < ${ctx.mutationWarningAgeHours}h runtime`,
          evidence: `Mutation ID '${m.mutation_id}' on table '${qualifiedTable}' (${mutationType}) has been executing for ${ageHours.toFixed(1)} hours (started: ${m.create_time}).\nParts remaining: ${m.parts_to_do}. Predicate expression omitted for privacy compliance.`,
          impact: 'Extended mutation runtimes compete with real-time background merges.',
          recommendation_sql_or_text: `-- Monitor mutation progress:\nSELECT mutation_id, command, parts_to_do, is_done FROM system.mutations WHERE database = '${escapeSqlString(database)}' AND table = '${escapeSqlString(m.table)}';`,
          is_sql_recommendation: true,
        });
      }
    }

    if (problemMutationsCount === 0) {
      findings.push({
        id: 'mutations_healthy',
        category: 'mutations',
        category_name: 'Table Mutations',
        title: 'No stuck or failing mutations',
        status: 'good',
        metric_value: `${ctx.mutationsData.length} pending mutations`,
        threshold: `Threshold: 0 failing mutations, max runtime < ${ctx.mutationWarningAgeHours}h`,
        evidence: `system.mutations reports 0 failing, stuck, or abnormally long-running mutations for database '${database}'.`,
        impact: 'All table ALTER UPDATE/DELETE mutations are completing cleanly.',
        recommendation_sql_or_text: 'Table mutation pipeline is operating normally.',
        is_sql_recommendation: false,
      });
    }
  }

  // 11. Disk Space & Storage Headroom (system.disks)
  if (ctx.disksAvailable && ctx.disksData !== null && ctx.disksData.length > 0) {
    let problemDisksCount = 0;
    let minFreePct = 100;

    for (const d of ctx.disksData) {
      const total = Number(d.total_space || 0);
      const free = Number(d.free_space || 0);
      const freePct = total > 0 ? (free / total) * 100 : 100;
      if (freePct < minFreePct) minFreePct = freePct;

      if (freePct < ctx.diskCriticalFreePct) {
        problemDisksCount++;
        findings.push({
          id: `disk_space_crit_${d.name}`,
          category: 'disk_space',
          category_name: 'Disk Space & Storage',
          title: `Disk '${d.name}' critically low on space (${freePct.toFixed(1)}% free)`,
          status: 'critical',
          metric_value: `${freePct.toFixed(1)}% free (${formatBytes(free)} / ${formatBytes(total)})`,
          threshold: `Threshold: ≥ ${ctx.diskCriticalFreePct}% free space`,
          evidence: `Storage volume '${d.name}' at path '${d.path}' has only ${formatBytes(free)} available out of ${formatBytes(total)} (${freePct.toFixed(1)}% free).`,
          impact: 'ClickHouse will reject incoming inserts and halt background merges with "No space left on device" when volume is full.',
          recommendation_sql_or_text: `-- Inspect largest partitions across active parts:\nSELECT table, partition, formatReadableSize(sum(bytes_on_disk)) AS size FROM system.parts WHERE active = 1 GROUP BY table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 10;\n-- Drop or detach historical partitions if applicable.`,
          is_sql_recommendation: true,
        });
      } else if (freePct < ctx.diskWarningFreePct) {
        problemDisksCount++;
        findings.push({
          id: `disk_space_warn_${d.name}`,
          category: 'disk_space',
          category_name: 'Disk Space & Storage',
          title: `Disk '${d.name}' running low on space (${freePct.toFixed(1)}% free)`,
          status: 'warning',
          metric_value: `${freePct.toFixed(1)}% free (${formatBytes(free)} / ${formatBytes(total)})`,
          threshold: `Threshold: ≥ ${ctx.diskWarningFreePct}% free space`,
          evidence: `Storage volume '${d.name}' at path '${d.path}' has ${formatBytes(free)} available out of ${formatBytes(total)} (${freePct.toFixed(1)}% free).`,
          impact: 'Storage volume is nearing capacity. Insufficient headroom can impede large table part compactions.',
          recommendation_sql_or_text: `-- Check largest tables on this storage volume:\nSELECT table, formatReadableSize(sum(bytes_on_disk)) AS size FROM system.parts WHERE active = 1 GROUP BY table ORDER BY sum(bytes_on_disk) DESC LIMIT 10;`,
          is_sql_recommendation: true,
        });
      }
    }

    if (problemDisksCount === 0) {
      findings.push({
        id: 'disks_healthy',
        category: 'disk_space',
        category_name: 'Disk Space & Storage',
        title: 'Adequate disk space across all storage volumes',
        status: 'good',
        metric_value: `All disks healthy (min ${minFreePct.toFixed(1)}% free)`,
        threshold: `Threshold: ≥ ${ctx.diskWarningFreePct}% free space`,
        evidence: `All ${ctx.disksData.length} storage volumes in system.disks have sufficient headroom (minimum free space is ${minFreePct.toFixed(1)}%).`,
        impact: 'Storage volumes have ample capacity for incoming parts, merges, and temporary sort buffers.',
        recommendation_sql_or_text: 'Disk space headroom is optimal.',
        is_sql_recommendation: false,
      });
    }
  }

  // 12. System Errors & Cluster Stability (system.errors)
  if (ctx.errorsAvailable && ctx.errorsData !== null) {
    let problemErrorsCount = 0;
    const windowCutoffMs = Date.now() - ctx.errorRecentWindowHours * 60 * 60 * 1000;

    for (const err of ctx.errorsData) {
      const errorTimeMs = new Date(err.last_error_time).getTime();
      const isRecent = !isNaN(errorTimeMs) && errorTimeMs >= windowCutoffMs;
      const errCount = Number(err.value || 0);

      if (isRecent) {
        if (errCount >= ctx.errorCriticalCount) {
          problemErrorsCount++;
          findings.push({
            id: `error_crit_${err.code}`,
            category: 'system_errors',
            category_name: 'System Errors & Stability',
            title: `Elevated ${err.name} errors (${errCount.toLocaleString()} occurrences)`,
            status: 'critical',
            metric_value: `${errCount.toLocaleString()} errors (last: ${err.last_error_time})`,
            threshold: `Threshold: < ${ctx.errorCriticalCount} occurrences in past ${ctx.errorRecentWindowHours}h`,
            evidence: `Error code ${err.code} (${err.name}) has occurred ${errCount.toLocaleString()} times.\nLast error time: ${err.last_error_time}.\nLast error message: ${err.last_error_message || 'None recorded'}.`,
            impact: 'Recurring critical error spikes indicate cluster instability, memory limits exceeded, or failing application queries.',
            recommendation_sql_or_text: `-- Inspect system.errors for full details on error code ${err.code}:\nSELECT * FROM system.errors WHERE code = ${err.code};\n-- Review server error log for stack traces.`,
            is_sql_recommendation: true,
          });
        } else if (errCount >= ctx.errorWarningCount) {
          problemErrorsCount++;
          findings.push({
            id: `error_warn_${err.code}`,
            category: 'system_errors',
            category_name: 'System Errors & Stability',
            title: `Elevated ${err.name} errors (${errCount.toLocaleString()} occurrences)`,
            status: 'warning',
            metric_value: `${errCount.toLocaleString()} errors (last: ${err.last_error_time})`,
            threshold: `Threshold: < ${ctx.errorWarningCount} occurrences in past ${ctx.errorRecentWindowHours}h`,
            evidence: `Error code ${err.code} (${err.name}) has occurred ${errCount.toLocaleString()} times.\nLast error time: ${err.last_error_time}.\nLast error message: ${err.last_error_message || 'None recorded'}.`,
            impact: `Frequent occurrences of ${err.name} indicate repeated client-side query syntax issues or transient resource constraints.`,
            recommendation_sql_or_text: `-- Inspect error code ${err.code} in system.errors:\nSELECT name, value, last_error_message, last_error_time FROM system.errors WHERE code = ${err.code};`,
            is_sql_recommendation: true,
          });
        }
      }
    }

    if (problemErrorsCount === 0) {
      findings.push({
        id: 'errors_healthy',
        category: 'system_errors',
        category_name: 'System Errors & Stability',
        title: 'Error rates within normal operational thresholds',
        status: 'good',
        metric_value: '0 elevated error spikes',
        threshold: `Threshold: < ${ctx.errorWarningCount} errors in past ${ctx.errorRecentWindowHours}h`,
        evidence: `system.errors reported no recurring error codes exceeding ${ctx.errorWarningCount} occurrences within the last ${ctx.errorRecentWindowHours} hours.`,
        impact: 'Server error pipeline is quiet and queries execute reliably.',
        recommendation_sql_or_text: 'System error frequency is optimal.',
        is_sql_recommendation: false,
      });
    }
  }

  return findings;
}
