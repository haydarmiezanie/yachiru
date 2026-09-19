import { AnalysisReport } from '../types.js';

export const DEVELOPER_EMAIL = 'haydarsaja@gmail.com';
export const DEVELOPER_LINKEDIN = 'https://www.linkedin.com/in/haydar-miezanie-abdul-jamil-916302162/';
export const MAILTO_BODY_LIMIT = 1500;

/**
 * Builds diagnostic summary using an STRICT EXPLICIT ALLOWLIST.
 * Never includes raw ConnectionConfig or sensitive secrets/credentials.
 */
export function buildDiagnosticSummary(report?: AnalysisReport | null): string {
  const lines: string[] = [];
  lines.push('--- Diagnostic Information ---');
  lines.push('App: Yachiru');

  const userAgent =
    typeof navigator !== 'undefined' && navigator.userAgent
      ? navigator.userAgent
      : 'Unknown / Non-browser environment';
  lines.push(`User Agent: ${userAgent}`);

  if (report) {
    lines.push(`Overall Score: ${report.overall_score ?? 'N/A'}/100`);
    lines.push(`Overall Verdict: ${report.overall_verdict ?? 'N/A'}`);

    if (report.clickhouse_version) {
      lines.push(`ClickHouse Version: ${report.clickhouse_version}`);
    }

    if (report.summary) {
      const crit = report.summary.critical_count ?? 0;
      const warn = report.summary.warning_count ?? 0;
      const good = report.summary.good_count ?? 0;
      lines.push(`Findings by Severity: Critical: ${crit}, Warning: ${warn}, Good: ${good}`);
    }

    // List category names and titles ONLY (never narrative text, raw queries, or remediation_sql)
    if (Array.isArray(report.findings) && report.findings.length > 0) {
      lines.push(`Finding Titles (${report.findings.length}):`);
      for (const finding of report.findings) {
        const categoryLabel = finding.category_name || finding.category || 'General';
        const title = finding.title || 'Untitled Check';
        lines.push(`- [${categoryLabel}] ${title}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generates the full report text.
 * If includeDiagnostics is false, returns ONLY the user's typed description.
 */
export function generateFeedbackReport(
  feedbackType: 'bug' | 'feature',
  userDescription: string,
  includeDiagnostics: boolean,
  report?: AnalysisReport | null
): string {
  const cleanDescription = userDescription.trim();

  // Acceptance criteria: When unchecked, generated report contains ONLY the user's typed text.
  if (!includeDiagnostics) {
    return cleanDescription;
  }

  const header = feedbackType === 'bug' ? 'Yachiru Bug Report' : 'Yachiru Feature Request';
  const diagnosticBlock = buildDiagnosticSummary(report);

  if (!cleanDescription) {
    return `[${header}]\n\n${diagnosticBlock}`;
  }

  return `[${header}]\n\nDescription:\n${cleanDescription}\n\n${diagnosticBlock}`;
}

/**
 * Constructs a safe mailto URL with URL encoding and length limit guards.
 */
export function buildMailtoUrl(
  feedbackType: 'bug' | 'feature',
  fullReportText: string,
  userDescription: string
): { url: string; isLong: boolean } {
  const subject = feedbackType === 'bug' ? 'Yachiru Bug Report' : 'Yachiru Feature Request';
  const isLong = fullReportText.length > MAILTO_BODY_LIMIT;

  let bodyToSend = fullReportText;
  if (isLong) {
    const desc = userDescription.trim();
    bodyToSend = `${desc}\n\n[Note: The full report exceeds 1,500 characters and was copied to your clipboard to prevent email client URL truncation. Please paste (Ctrl+V / Cmd+V) below this line:]\n\n`;
  }

  const url = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyToSend)}`;
  return { url, isLong };
}
