/**
 * Canonical SQL escaping, read-only SQL enforcement, byte formatting, and column-token helpers.
 * All server modules and diagnostic checks must import these helpers from here so security
 * guarantees never diverge across copies.
 */

/**
 * Safely strips single-quoted string literals, backtick identifiers, and SQL comments before
 * inspecting SQL for forbidden mutating keywords. This prevents false positives
 * when legitimate database/table names contain substring keywords (e.g. 'create-db',
 * 'drop_logs', 'insert-stream') while strictly ensuring no actual DDL/DML statements
 * can be smuggled outside string boundaries.
 */
export function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Safely escapes any string for inclusion inside a ClickHouse single-quoted string literal ('...').
 *
 * Order of replacement is critical:
 * 1. Backslashes ('\') MUST be replaced first with '\\' to prevent quote-escaping bypasses.
 * 2. Single quotes ("'") are replaced with "\'".
 * 3. Control characters (null byte, newline, carriage return, tab) are escaped.
 */
export function escapeSqlString(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Safely escapes and wraps an identifier (database name, table name, column name)
 * in ClickHouse backticks (`...`).
 */
export function escapeSqlIdentifier(ident: string): string {
  if (typeof ident !== 'string' || ident.length === 0) {
    throw new Error('ClickHouse identifier cannot be empty');
  }
  if (ident.includes('\0')) {
    throw new Error('ClickHouse identifier cannot contain null bytes');
  }
  const escaped = ident.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `\`${escaped}\``;
}

/**
 * Hard safety validator: Ensure any query string is strictly a read-only SELECT / SHOW / DESCRIBE.
 */
export function assertReadOnlySql(sql: string): void {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed) && !/^SHOW\b/i.test(trimmed) && !/^DESCRIBE\b/i.test(trimmed)) {
    throw new Error(`SECURITY EXCEPTION: Only SELECT/SHOW statements are allowed. Attempted: ${sql.substring(0, 40)}...`);
  }

  const codeOnly = stripLiteralsAndComments(trimmed);

  const forbiddenPatterns = [
    /\bALTER\b/i,
    /\bDROP\b/i,
    /\bTRUNCATE\b/i,
    /\bINSERT\b/i,
    /\bDELETE\b/i,
    /\bUPDATE\b/i,
    /\bCREATE\b/i,
    /\bRENAME\b/i,
    /\bATTACH\b/i,
    /\bDETACH\b/i,
    /\bKILL\b/i,
    /\bOPTIMIZE\b/i,
    /\bSYSTEM\s+(DROP|FLUSH|RELOAD|SHUTDOWN|STOP|START)/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(codeOnly)) {
      throw new Error(`SECURITY EXCEPTION: Mutating SQL keyword detected. Query blocked.`);
    }
  }
}

/**
 * Format byte sizes into human-readable strings.
 */
export function formatBytes(bytes: number): string {
  if (isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i] || 'PB'}`;
}

/**
 * Splits a column name into distinct tokens on underscores, hyphens, non-alphanumeric chars,
 * and camelCase boundaries (e.g. "report_id" -> ["report", "id"], "postBody" -> ["post", "body"]).
 */
export function tokenizeColumnName(name: string): string[] {
  const separated = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return separated.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Matches a column name against a list of target keywords by whole token or delimited subphrase.
 * Avoids substring false positives like "report_id" matching "port" or "post_body" matching "os".
 */
export function matchesColumnTokens(name: string, targetTerms: string[]): boolean {
  const lowerName = name.toLowerCase();
  const tokens = tokenizeColumnName(name);
  const tokenSet = new Set(tokens);

  for (const term of targetTerms) {
    const lowerTerm = term.toLowerCase();
    if (lowerTerm.includes('_')) {
      const regex = new RegExp(`(^|[_\\-])${lowerTerm}([_\\-]|$)`, 'i');
      if (regex.test(lowerName)) {
        return true;
      }
    } else {
      if (tokenSet.has(lowerTerm)) {
        return true;
      }
    }
  }
  return false;
}
