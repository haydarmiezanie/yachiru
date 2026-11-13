import { CheckFinding } from '../../src/types.js';
import { CheckEvaluationContext } from './types.js';
import { escapeSqlString, formatBytes } from './helpers.js';

export function evaluateReplicationChecks(ctx: CheckEvaluationContext): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const database = ctx.database;

  // 8. Replication & Distributed Health (only evaluated if system.replicas was accessible)
  if (ctx.replicationAvailable) {
    if (ctx.replicasData.length > 0) {
      for (const r of ctx.replicasData) {
        if (Number(r.is_readonly) === 1) {
          findings.push({
            id: `replica_readonly_${r.table}`,
            category: 'replication_distributed',
            category_name: 'Replication & Distributed Backlog',
            title: `Replica is in READ-ONLY mode for table '${r.table}'`,
            table: r.table,
            status: 'critical',
            metric_value: 'is_readonly = 1',
            threshold: 'Threshold: is_readonly = 0',
            evidence: `system.replicas reports table '${r.table}' is readonly. ZooKeeper/ClickHouse Keeper connection dropped or disk full.`,
            impact: 'Mutations, inserts, and merges are halted on this replica.',
            recommendation_sql_or_text: `-- Check Keeper cluster status and disk space:\nSELECT * FROM system.zookeeper WHERE path = '/clickhouse' LIMIT 5;\nSELECT * FROM system.disks;`,
            is_sql_recommendation: true,
          });
        }
        if (Number(r.queue_size) > 20) {
          findings.push({
            id: `replica_queue_${r.table}`,
            category: 'replication_distributed',
            category_name: 'Replication & Distributed Backlog',
            title: `Replication queue backlog on '${r.table}'`,
            table: r.table,
            status: 'warning',
            metric_value: `Queue size: ${r.queue_size}`,
            threshold: 'Threshold: ≤ 20 queued tasks',
            evidence: `Replication queue has ${r.queue_size} pending items with absolute delay of ${r.absolute_delay || 0}s.`,
            impact: 'Follower replica is serving stale data to distributed queries.',
            recommendation_sql_or_text: `-- Inspect replication queue errors:\nSELECT type, num_tries, last_exception FROM system.replication_queue WHERE table = '${escapeSqlString(r.table)}' ORDER BY create_time DESC LIMIT 10;`,
            is_sql_recommendation: true,
          });
        }
      }
    } else {
      findings.push({
        id: 'replication_status',
        category: 'replication_distributed',
        category_name: 'Replication & Distributed Backlog',
        title: 'Replication health verified (or standalone instance)',
        status: 'good',
        metric_value: 'No replication backlog',
        threshold: 'Threshold: Clean queues',
        evidence: 'No active replication stalls or read-only replica states detected in system.replicas.',
        impact: 'High write availability.',
        recommendation_sql_or_text: 'Replication state is normal.',
        is_sql_recommendation: false,
      });
    }
  }

  if (ctx.distributionData.length > 0) {
    for (const dq of ctx.distributionData) {
      const isBlocked = Number(dq.is_blocked) === 1;
      const dataFiles = Number(dq.data_files || 0);
      const dataBytes = Number(dq.data_compressed_bytes || 0);

      if (isBlocked || dataFiles > 50) {
        findings.push({
          id: `dist_queue_error_${dq.table}`,
          category: 'replication_distributed',
          category_name: 'Replication & Distributed Backlog',
          title: `Distributed insert queue error/blocked on '${dq.table}'`,
          table: dq.table,
          status: 'warning',
          metric_value: `Files: ${dataFiles}, Blocked: ${dq.is_blocked}`,
          threshold: 'Threshold: error_count = 0, is_blocked = 0',
          evidence: `system.distribution_queue reported ${dataFiles} pending files (${formatBytes(dataBytes)}) for distributed table '${dq.table}'. Blocked: ${dq.is_blocked}.`,
          impact: 'Async inserts across distributed remote shards are failing or stalled.',
          recommendation_sql_or_text: `-- Check distributed queue status:\nSELECT * FROM system.distribution_queue WHERE table = '${escapeSqlString(dq.table)}';\n-- Inspect network latency to remote shards.`,
          is_sql_recommendation: true,
        });
      }
    }
  }

  // 13. Replication Queue Backlog (system.replication_queue)
  if (
    ctx.replicationQueueAvailable &&
    (ctx.replicasData.length > 0 || ctx.replicationQueueData.length > 0)
  ) {
    let problemQueueCount = 0;

    for (const rq of ctx.replicationQueueData) {
      const tries = Number(rq.num_tries || 0);
      const hasException = Boolean(rq.last_exception && rq.last_exception.trim() !== '');

      if (tries >= ctx.replicationQueueMaxRetries && hasException) {
        problemQueueCount++;
        findings.push({
          id: `rep_queue_fail_${rq.table}_${rq.type}`,
          category: 'replication_queue',
          category_name: 'Replication Queue & Retries',
          title: `Replication queue entry repeatedly failing on '${rq.table}'`,
          table: rq.table,
          status: 'critical',
          metric_value: `${tries} retries`,
          threshold: `Threshold: < ${ctx.replicationQueueMaxRetries} retries with 0 exceptions`,
          evidence: `Replication action '${rq.type}' on table '${rq.table}' has failed ${tries} times (created: ${rq.create_time}).\nException: ${rq.last_exception}`,
          impact: 'Failed replication queue tasks block subsequent part syncs, leading to replica divergence and stale queries.',
          recommendation_sql_or_text: `-- Inspect stuck task in replication_queue:\nSELECT type, num_tries, last_exception, create_time FROM system.replication_queue WHERE database = '${escapeSqlString(database)}' AND table = '${escapeSqlString(rq.table)}' ORDER BY num_tries DESC LIMIT 5;`,
          is_sql_recommendation: true,
        });
      }
    }

    const queueByTable = new Map<string, number>();
    for (const rq of ctx.replicationQueueData) {
      queueByTable.set(rq.table, (queueByTable.get(rq.table) || 0) + 1);
    }

    for (const [tableName, count] of queueByTable.entries()) {
      if (count > ctx.replicationQueueWarningSize) {
        problemQueueCount++;
        findings.push({
          id: `rep_queue_backlog_${tableName}`,
          category: 'replication_queue',
          category_name: 'Replication Queue & Retries',
          title: `Replication queue backlog on '${tableName}'`,
          table: tableName,
          status: 'warning',
          metric_value: `${count} pending tasks`,
          threshold: `Threshold: ≤ ${ctx.replicationQueueWarningSize} tasks`,
          evidence: `Table '${tableName}' has ${count} pending actions in system.replication_queue. Replica synchronization is lagging.`,
          impact: 'High replication backlog delays data visibility on read replicas.',
          recommendation_sql_or_text: `-- Check queue tasks distribution:\nSELECT type, count() FROM system.replication_queue WHERE database = '${escapeSqlString(database)}' AND table = '${escapeSqlString(tableName)}' GROUP BY type;`,
          is_sql_recommendation: true,
        });
      }
    }

    if (problemQueueCount === 0) {
      findings.push({
        id: 'replication_queue_healthy',
        category: 'replication_queue',
        category_name: 'Replication Queue & Retries',
        title: ctx.replicationQueueData.length === 0 ? 'Replication queue is clear' : 'Replication tasks processing normally',
        status: 'good',
        metric_value: `${ctx.replicationQueueData.length} pending tasks`,
        threshold: `Threshold: ≤ ${ctx.replicationQueueWarningSize} tasks, 0 retry failures`,
        evidence: `system.replication_queue has ${ctx.replicationQueueData.length} pending tasks with 0 recurring retry failures.`,
        impact: 'Replicas are keeping pace with part mutations and merges.',
        recommendation_sql_or_text: 'Replication queue is healthy.',
        is_sql_recommendation: false,
      });
    }
  }

  return findings;
}
