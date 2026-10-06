import { AnalysisReport, CheckFinding, getModelDisplayName, formatCurrency } from '../types.js';
import { calculateReportCostSummary, loadCostModel } from './costModel.js';

export function generateMarkdownReport(report: AnalysisReport): string {
  const timestamp = new Date(report.timestamp).toUTCString();
  const summary = report.summary;
  const costSummary = report.cost_summary || calculateReportCostSummary(report.findings, report.tables, loadCostModel());

  let md = `# Yachiru — ClickHouse Database Optimization Report\n\n`;
  md += `> **Audit Generated:** ${timestamp}  \n`;
  md += `> **Database:** \`${report.database_name}\`  \n`;
  md += `> **ClickHouse Version:** \`${report.clickhouse_version}\` (${report.cluster_mode})  \n`;
  md += `> **Overall Score:** **${report.overall_score} / 100** — *${report.overall_verdict}*  \n`;
  md += `> **Hard Safety Guarantee:** 100% Read-Only Inspection. No mutating DDL executed.\n\n`;

  let sectionNum = 1;

  md += `## ${sectionNum++}. Executive Metrics Summary\n\n`;
  md += `| Metric | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Analyzed Tables** | ${summary.total_tables} |\n`;
  md += `| **Total Records** | ${summary.total_rows.toLocaleString()} |\n`;
  md += `| **Compressed Volume** | ${summary.total_size_compressed} |\n`;
  md += `| **Uncompressed Volume** | ${summary.total_size_uncompressed} |\n`;
  md += `| **Average Compression Ratio** | ${summary.avg_compression_ratio} |\n`;
  md += `| **Total Active Parts** | ${summary.total_parts.toLocaleString()} |\n`;
  md += `| **Critical Issues** | ${summary.critical_count} |\n`;
  md += `| **Warnings** | ${summary.warning_count} |\n`;
  md += `| **Optimal Checks** | ${summary.good_count} |\n\n`;

  if (costSummary && costSummary.totalMonthlySavings > 0) {
    md += `## ${sectionNum++}. Cost Optimization & Estimated Cloud ROI\n\n`;
    md += `| Metric | Estimated Impact |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Total Potential Monthly Savings** | **${formatCurrency(costSummary.totalMonthlySavings, costSummary.costModelUsed.currency)} / month** |\n`;
    md += `| **Projected Annual ROI (Run-rate)** | **${formatCurrency(costSummary.totalAnnualSavings, costSummary.costModelUsed.currency)} / year** |\n`;
    md += `| **Storage Cost Reduction** | ${formatCurrency(costSummary.storageMonthlySavings, costSummary.costModelUsed.currency)} / mo (${costSummary.storageBytesReducedFormatted} saved) |\n`;
    md += `| **Query & Compute Savings** | ${formatCurrency(costSummary.queryComputeMonthlySavings, costSummary.costModelUsed.currency)} / mo (${costSummary.queryBytesScannedDailyReducedFormatted} scan pruned) |\n`;
    md += `| **Identified Opportunities** | ${costSummary.totalOpportunitiesCount} (${costSummary.highImpactCount} high-impact) |\n\n`;
    md += `*Assumptions: Storage @ $${costSummary.costModelUsed.storagePricePerGBMonth}/GB-mo, Query scan @ $${costSummary.costModelUsed.queryCostPerTBScanned}/TB, Compute @ $${costSummary.costModelUsed.computePricePerCPUHour}/vCPU-hr.*\n\n`;
  }

  if (report.ai_narrative) {
    const modelTitle = getModelDisplayName(report.ai_narrative.model);
    md += `## ${sectionNum++}. AI Executive Narrative & Remediation Plan (${modelTitle})\n\n`;
    md += `### Summary\n${report.ai_narrative.executive_summary}\n\n`;
    md += `### Prioritized Action Plan\n`;
    report.ai_narrative.top_priorities.forEach((p) => {
      md += `**Priority ${p.priority}: ${p.title}**${p.target_table ? ` (Table: \`${p.target_table}\`)` : ''}\n`;
      md += `- *Why it matters:* ${p.why}\n`;
      md += `- *Action required:* ${p.action}\n\n`;
    });
    md += `### Workload Risk Assessment\n${report.ai_narrative.workload_risk_analysis}\n\n`;
  }

  md += `## ${sectionNum++}. Category Score Breakdown\n\n`;
  md += `| Category | Score | Critical | Warning | Optimal | Status |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;
  report.categories.forEach((c) => {
    md += `| **${c.name}** | ${c.score}/100 | ${c.critical_count} | ${c.warning_count} | ${c.good_count} | ${c.status.toUpperCase()} |\n`;
  });
  md += `\n`;

  const formatFinding = (f: CheckFinding, idx: number) => {
    const statusIcon = f.status === 'critical' ? '🔴 CRITICAL' : f.status === 'warning' ? '🟡 WARNING' : '🟢 OPTIMAL';
    let block = `### ${idx + 1}. [${statusIcon}] ${f.title}\n`;
    block += `- **Category:** ${f.category_name}\n`;
    if (f.table) block += `- **Target Table:** \`${f.table}\`\n`;
    block += `- **Observed Metric:** \`${f.metric_value}\`\n`;
    block += `- **Operational Threshold:** ${f.threshold}\n`;
    block += `- **Evidence:** ${f.evidence}\n`;
    block += `- **Technical Impact:** ${f.impact}\n`;
    if (f.cost_impact && f.cost_impact.estimatedMonthlySavings > 0) {
      block += `- **Potential Monthly Savings:** +${formatCurrency(f.cost_impact.estimatedMonthlySavings)} / month (Annual Run-rate: +${formatCurrency(f.cost_impact.annualProjectedSavings)}/yr, Confidence: ${f.cost_impact.confidence.toUpperCase()})\n`;
      block += `- **Calculation Basis:** ${f.cost_impact.methodology}\n`;
    }
    if (f.ai_root_cause) {
      block += `- **Root Cause:** ${f.ai_root_cause}\n`;
    }
    block += `\n`;
    if (f.recommendation_sql_or_text) {
      if (f.is_sql_recommendation) {
        block += `**Recommended SQL (Run manually on target cluster):**\n\`\`\`sql\n${f.recommendation_sql_or_text}\n\`\`\`\n\n`;
      } else {
        block += `**Recommendation:** ${f.recommendation_sql_or_text}\n\n`;
      }
    }
    block += `---\n\n`;
    return block;
  };

  const aiFindings = report.findings.filter((f) => f.is_ai_diagnosed);
  const deterministicFindings = report.findings.filter((f) => !f.is_ai_diagnosed);

  if (aiFindings.length > 0) {
    md += `## ${sectionNum++}. AI-Diagnosed Findings & Remediation\n\n`;
    aiFindings.forEach((f, idx) => {
      md += formatFinding(f, idx);
    });
  }

  md += `## ${sectionNum++}. Deterministic Findings & Evidence\n\n`;
  deterministicFindings.forEach((f, idx) => {
    md += formatFinding(f, idx);
  });

  md += `## ${sectionNum++}. Table Inventory & Physical Diagnostics\n\n`;
  md += `| Table | Engine | Rows | Compressed | Uncompressed | Ratio | Active Parts | Partitions | Sorting Key |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |\n`;
  report.tables.forEach((t) => {
    const uncompStr = (t.total_bytes_uncompressed / (1024 * 1024)).toFixed(1) + ' MB';
    const compStr = (t.total_bytes_compressed / (1024 * 1024)).toFixed(1) + ' MB';
    md += `| \`${t.name}\` | ${t.engine} | ${t.total_rows.toLocaleString()} | ${compStr} | ${uncompStr} | ${t.compression_ratio}x | ${t.active_parts} | ${t.partition_count} | \`${t.order_by_key}\` |\n`;
  });

  md += `\n\n*Generated by Yachiru ClickHouse Optimization Analyzer.*`;
  return md;
}
