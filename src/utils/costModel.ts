/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Yachiru Cost Savings Estimator
 *
 * Core financial calculation engine converting ClickHouse database optimization
 * findings into defensible, reproducible monthly and annual dollar savings.
 *
 * Strict Architectural Separation:
 * Finding + Database Metrics + Configured Cost Model -> CostImpact -> UI / Dashboard / History
 */

import { CheckFinding, TableMetadata } from '../types.js';

export interface CostModel {
  /** Storage price in USD per GB-month (default $0.12, AWS EBS gp3 / ClickHouse Cloud tier) */
  storagePricePerGBMonth: number;
  /** Compute price in USD per vCPU-hour (default $0.048) */
  computePricePerCPUHour: number;
  /** Compute RAM price in USD per GB-hour (default $0.006) */
  computePricePerGBHour: number;
  /** Analytical query scanning cost in USD per TB scanned (default $5.00) */
  queryCostPerTBScanned: number;
  /** Display currency (default 'USD') */
  currency: string;
  /** True if prices were customized by the user, false if default assumptions */
  isCustomPricing?: boolean;
}

export const DEFAULT_COST_MODEL: CostModel = {
  storagePricePerGBMonth: 0.12,
  computePricePerCPUHour: 0.048,
  computePricePerGBHour: 0.006,
  queryCostPerTBScanned: 0, // Default to 0: ClickHouse Cloud and self-hosted bill on compute & storage, not per TB scanned
  currency: 'USD',
  isCustomPricing: false,
};

export const COST_MODEL_STORAGE_KEY = 'yachiru_cost_model';

export type CostConfidence = 'high' | 'medium' | 'low';
export type CostCategory = 'storage' | 'compute' | 'query' | 'mixed';

export interface CalculationStep {
  label: string;
  value: string;
  detail?: string;
}

export interface CostImpact {
  category: CostCategory;
  currentMonthlyCost?: number;
  estimatedMonthlyCostAfter?: number;
  estimatedMonthlySavings: number;
  savingsPercentage?: number;
  annualProjectedSavings: number; // monthly * 12
  savingsRange?: {
    minMonthlySavings: number;
    maxMonthlySavings: number;
    minBytesReduced?: number;
    maxBytesReduced?: number;
    minFormatted?: string;
    maxFormatted?: string;
  };
  resourceReduction: {
    bytes?: number;
    bytesFormatted?: string;
    percentage?: number;
    cpuHoursMonthly?: number;
    queryBytesScannedDaily?: number;
    queryBytesScannedMonthly?: number;
    queryBytesScannedFormatted?: string;
    rows?: number;
  };
  confidence: CostConfidence;
  confidenceReason: string;
  assumptions: string[];
  methodology: string;
  calculationBasis?: string;
  recommendedAction?: string;
  calculationSteps: CalculationStep[];
  optimizationGroup: string; // Grouping key to prevent double-counting across findings
  isEstimable: boolean;
  technicalReductionOnlyText?: string;
  pricingSource?: string;
}

export interface RankedOpportunity {
  findingId: string;
  title: string;
  table?: string;
  category: string;
  categoryName: string;
  severity: string;
  costImpact: CostImpact;
}

export interface ReportCostSummary {
  totalMonthlySavings: number;
  totalAnnualSavings: number;
  storageMonthlySavings: number;
  storageBytesReduced: number;
  storageBytesReducedFormatted: string;
  queryComputeMonthlySavings: number;
  queryBytesScannedDailyReduced: number;
  queryBytesScannedDailyReducedFormatted: string;
  totalOpportunitiesCount: number;
  highImpactCount: number; // monthly savings >= $25
  confidenceBreakdown: {
    high: number;
    medium: number;
    low: number;
  };
  topOpportunities: RankedOpportunity[];
  costModelUsed: CostModel;
}

/**
 * Loads the active CostModel from browser localStorage or returns DEFAULT_COST_MODEL.
 */
export function loadCostModel(): CostModel {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_COST_MODEL };
  }
  try {
    const raw = window.localStorage.getItem(COST_MODEL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_COST_MODEL };
    const parsed = JSON.parse(raw);
    return {
      storagePricePerGBMonth: Number(parsed.storagePricePerGBMonth) >= 0 ? Number(parsed.storagePricePerGBMonth) : DEFAULT_COST_MODEL.storagePricePerGBMonth,
      computePricePerCPUHour: Number(parsed.computePricePerCPUHour) >= 0 ? Number(parsed.computePricePerCPUHour) : DEFAULT_COST_MODEL.computePricePerCPUHour,
      computePricePerGBHour: Number(parsed.computePricePerGBHour) >= 0 ? Number(parsed.computePricePerGBHour) : DEFAULT_COST_MODEL.computePricePerGBHour,
      queryCostPerTBScanned: Number(parsed.queryCostPerTBScanned) >= 0 ? Number(parsed.queryCostPerTBScanned) : DEFAULT_COST_MODEL.queryCostPerTBScanned,
      currency: typeof parsed.currency === 'string' && parsed.currency.trim() ? parsed.currency.trim() : DEFAULT_COST_MODEL.currency,
      isCustomPricing: true,
    };
  } catch {
    return { ...DEFAULT_COST_MODEL };
  }
}

/**
 * Persists a customized CostModel to localStorage and dispatches a change event.
 */
export function saveCostModel(model: Partial<CostModel>): CostModel {
  const current = loadCostModel();
  const updated: CostModel = {
    storagePricePerGBMonth: model.storagePricePerGBMonth !== undefined && Number(model.storagePricePerGBMonth) >= 0 ? Number(model.storagePricePerGBMonth) : current.storagePricePerGBMonth,
    computePricePerCPUHour: model.computePricePerCPUHour !== undefined && Number(model.computePricePerCPUHour) >= 0 ? Number(model.computePricePerCPUHour) : current.computePricePerCPUHour,
    computePricePerGBHour: model.computePricePerGBHour !== undefined && Number(model.computePricePerGBHour) >= 0 ? Number(model.computePricePerGBHour) : current.computePricePerGBHour,
    queryCostPerTBScanned: model.queryCostPerTBScanned !== undefined && Number(model.queryCostPerTBScanned) >= 0 ? Number(model.queryCostPerTBScanned) : current.queryCostPerTBScanned,
    currency: model.currency || current.currency,
    isCustomPricing: true,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(COST_MODEL_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('yachiru-cost-model-changed', { detail: updated }));
    } catch (e) {
      console.warn('Failed to save cost model to localStorage:', e);
    }
  }

  return updated;
}

/**
 * Resets the CostModel back to factory default assumptions.
 */
export function resetCostModel(): CostModel {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(COST_MODEL_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent('yachiru-cost-model-changed', { detail: DEFAULT_COST_MODEL }));
    } catch {
      // ignore
    }
  }
  return { ...DEFAULT_COST_MODEL };
}

/**
 * Formats a byte quantity into a human-readable string (B, KB, MB, GB, TB).
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let val = bytes;
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(val >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Formats a financial amount in currency with defensible rounding (no fake precision).
 * e.g. $14.52, $142, $1,240
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    return '$0.00';
  }
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  if (amount < 10) {
    return `${symbol}${amount.toFixed(2)}`;
  } else if (amount < 100) {
    return `${symbol}${amount.toFixed(2)}`;
  } else {
    // For values >= $100, whole dollar rounding avoids false impression of penny precision
    return `${symbol}${Math.round(amount).toLocaleString()}`;
  }
}

/**
 * Parses size strings like "8.4 GB", "500 MB", "14.2 GB", "1,460" into bytes or numbers.
 */
export function parseBytesFromText(text: string): number | null {
  if (!text) return null;
  const match = text.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)/i);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
    PB: 1024 * 1024 * 1024 * 1024 * 1024,
  };
  return num * (multipliers[unit] || 1);
}

/**
 * Calculates the cost impact for an individual finding based on observed metrics,
 * evidence strings, table metadata, and configured pricing model.
 *
 * Never fabricates numbers. If insufficient data exists, returns technical impact only.
 */
export function calculateFindingCostImpact(
  finding: CheckFinding,
  tableMetadataList?: TableMetadata[],
  costModel: CostModel = DEFAULT_COST_MODEL
): CostImpact | null {
  // Only warning or critical findings can generate savings (good checks are already optimal)
  if (finding.status === 'good') {
    return null;
  }

  const tableMeta = finding.table && tableMetadataList
    ? tableMetadataList.find((t) => t.name === finding.table)
    : undefined;

  const storagePricePerGB = costModel.storagePricePerGBMonth ?? DEFAULT_COST_MODEL.storagePricePerGBMonth;
  const queryPricePerTB = costModel.queryCostPerTBScanned ?? DEFAULT_COST_MODEL.queryCostPerTBScanned;
  const computePricePerCPU = costModel.computePricePerCPUHour ?? DEFAULT_COST_MODEL.computePricePerCPUHour;
  const computePricePerGBRAM = costModel.computePricePerGBHour ?? DEFAULT_COST_MODEL.computePricePerGBHour;
  const pricingSource = costModel.isCustomPricing ? 'User configured pricing' : 'Default assumption';

  const fullText = `${finding.id} ${finding.title} ${finding.evidence} ${finding.recommendation_sql_or_text} ${finding.metric_value}`.toLowerCase();

  // =========================================================================
  // 1. DATA TYPE & SCHEMA OPTIMIZATION: LowCardinality
  // =========================================================================
  const isLowCardinality =
    finding.category !== 'primary_key' &&
    (/lowcard_candidate/i.test(finding.id) ||
      /lowcardinality/i.test(finding.title) ||
      /low-cardinality/i.test(finding.title) ||
      (finding.category === 'compression' && /lowcardinality/i.test(finding.recommendation_sql_or_text)));

  if (isLowCardinality && finding.table) {
    const colName =
      finding.metrics?.columnName ||
      (() => {
        const match = finding.title.match(/['`]([^'`]+)\.([^'`]+)['`]/) || finding.evidence.match(/column ['`]([^'`]+)['`]/i);
        return match ? match[2] || match[1] : 'column';
      })();

    // Extract cardinality if observed
    const cardinality =
      finding.metrics?.distinctValues ??
      (() => {
        const cardMatch = finding.evidence.match(/cardinality[:\s]+(\d+)/i) || finding.evidence.match(/(\d+)\s+distinct\s+values/i);
        return cardMatch ? parseInt(cardMatch[1], 10) : undefined;
      })();

    const isNameOnly =
      finding.metrics?.isNameOnlyCandidate ??
      (/candidate based on column name only/i.test(finding.evidence) || (cardinality === undefined && !/cardinality/i.test(finding.evidence)));

    // Determine column COMPRESSED size only - storage is billed on compressed bytes!
    let colCompressedBytes: number | null = null;
    let usedRegexFallback = false;
    if (finding.metrics?.columnCompressedBytes && finding.metrics.columnCompressedBytes > 0) {
      colCompressedBytes = finding.metrics.columnCompressedBytes;
    } else {
      // Must match COMPRESSED bytes explicitly - never uncompressed!
      const compMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*compressed/i);
      if (compMatch) {
        colCompressedBytes = parseBytesFromText(`${compMatch[1]} ${compMatch[2]}`);
        usedRegexFallback = true;
      }
    }

    // If only an uncompressed figure is available, the finding is not estimable for storage cost
    if (!colCompressedBytes) {
      const uncompMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*uncompressed/i);
      const uncompBytes = finding.metrics?.columnUncompressedBytes ?? (uncompMatch ? parseBytesFromText(`${uncompMatch[1]} ${uncompMatch[2]}`) : null);
      if (uncompBytes) {
        return {
          category: 'storage',
          estimatedMonthlySavings: 0,
          annualProjectedSavings: 0,
          isEstimable: false,
          confidence: 'low',
          confidenceReason: 'Only uncompressed footprint is known; ClickHouse storage is billed on compressed bytes. Storage cost savings cannot be calculated without compressed on-disk footprint.',
          assumptions: [
            `Uncompressed footprint: ${formatBytes(uncompBytes)}.`,
            'Compressed on-disk footprint is unknown from metadata.',
            'Storage is billed on compressed disk footprint.',
          ],
          methodology: 'Storage cost calculation requires compressed on-disk footprint.',
          calculationBasis: `Column uses ${formatBytes(uncompBytes)} uncompressed. Compressed disk footprint is unknown; financial impact unavailable.`,
          recommendedAction: `ALTER TABLE ${finding.table} MODIFY COLUMN ${colName} LowCardinality(String);`,
          calculationSteps: [
            { label: 'Uncompressed Size', value: formatBytes(uncompBytes) },
            { label: 'Compressed Size', value: 'Unknown (not observed)' },
            { label: 'Estimated Monthly Savings', value: 'Unavailable (requires compressed size)' },
          ],
          optimizationGroup: `table:${finding.table}:col:${colName}:schema`,
          resourceReduction: {
            bytes: 0,
            bytesFormatted: '0 B',
            percentage: 0,
          },
          technicalReductionOnlyText: `Column uses ${formatBytes(uncompBytes)} uncompressed. Compressed on-disk bytes unknown; financial savings cannot be calculated.`,
          pricingSource,
        };
      }
      return null;
    }

    if (colCompressedBytes && colCompressedBytes > 5 * 1024 * 1024) {
      // Nominal point estimate calculated from compressed bytes (70% nominal compaction factor)
      const reductionPercentage = 70;
      const reductionBytes = colCompressedBytes * (reductionPercentage / 100);
      const reductionGB = reductionBytes / (1024 * 1024 * 1024);
      const monthlySavings = reductionGB * storagePricePerGB;
      const currentMonthlyCost = (colCompressedBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
      const afterMonthlyCost = ((colCompressedBytes - reductionBytes) / (1024 * 1024 * 1024)) * storagePricePerGB;

      // Honest wide low-high band for LowCardinality on-disk savings:
      // Compressed on-disk gains are smaller/variable because LZ4/ZSTD already deduplicate repeated strings.
      // Wide range: 20% (low) to 70% (high).
      const minReductionBytes = colCompressedBytes * 0.20;
      const maxReductionBytes = colCompressedBytes * 0.70;
      const minSavings = (minReductionBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
      const maxSavings = (maxReductionBytes / (1024 * 1024 * 1024)) * storagePricePerGB;

      return {
        category: 'storage',
        currentMonthlyCost: Math.round(currentMonthlyCost * 100) / 100,
        estimatedMonthlyCostAfter: Math.round(afterMonthlyCost * 100) / 100,
        estimatedMonthlySavings: Math.round(monthlySavings * 100) / 100,
        savingsPercentage: reductionPercentage,
        annualProjectedSavings: Math.round(monthlySavings * 12 * 100) / 100,
        savingsRange: {
          minMonthlySavings: Math.round(minSavings * 100) / 100,
          maxMonthlySavings: Math.round(maxSavings * 100) / 100,
          minBytesReduced: minReductionBytes,
          maxBytesReduced: maxReductionBytes,
          minFormatted: formatBytes(minReductionBytes),
          maxFormatted: formatBytes(maxReductionBytes),
        },
        resourceReduction: {
          bytes: reductionBytes,
          bytesFormatted: formatBytes(reductionBytes),
          percentage: reductionPercentage,
        },
        confidence: usedRegexFallback ? 'low' : (isNameOnly ? 'medium' : (cardinality && cardinality <= 10000 ? 'medium' : 'low')),
        confidenceReason: usedRegexFallback
          ? 'Column compressed footprint was parsed from evidence text regex fallback; confidence capped at low.'
          : (isNameOnly
            ? 'Candidate identified from column name convention only; cardinality was not inspected. If verified distinct count is below ~10,000, LowCardinality dictionary indexing typically yields 20%–70% compressed on-disk reduction.'
            : (cardinality
              ? `Column distinct count is ${cardinality.toLocaleString()} values. Replacing repeated strings with dictionary indices typically yields 20%–70% compressed on-disk reduction depending on string length and compression codec.`
              : 'LowCardinality replaces repeating String values with dictionary keys, yielding 20%–70% compressed on-disk reduction.')),
        assumptions: [
          `Current column compressed footprint: ${formatBytes(colCompressedBytes)}${cardinality ? ` (Cardinality: ${cardinality})` : ''}.`,
          isNameOnly ? 'Assumed candidate based on column name convention; cardinality was not inspected.' : 'LowCardinality replaces repeated strings with dictionary indices.',
          'Expected on-disk compressed reduction ranges between 20% and 70% depending on string length and existing LZ4/ZSTD compression.',
          `Storage price: $${storagePricePerGB.toFixed(2)} / GB-month (Source: ${pricingSource}).`,
          'Zero data growth assumed (steady-state current footprint).',
        ],
        methodology: `Storage reduction = Column compressed size (${formatBytes(colCompressedBytes)}) × dictionary compaction factor. Monthly savings = Reduction (GB) × Storage price.`,
        calculationBasis: `Current column: ${formatBytes(colCompressedBytes)} compressed → Estimated optimized: ${formatBytes(colCompressedBytes - reductionBytes)} (~${reductionPercentage}% reduction, range: 20%–70%).`,
        recommendedAction: `-- Verify cardinality first:\nSELECT uniq(${colName}) FROM ${finding.table};\n-- If uniq count < 10000:\nALTER TABLE ${finding.table} MODIFY COLUMN ${colName} LowCardinality(String);`,
        calculationSteps: [
          { label: 'Current Column Footprint (Compressed)', value: formatBytes(colCompressedBytes) },
          { label: 'Observed Cardinality', value: cardinality ? `${cardinality.toLocaleString()} distinct values` : 'Uninspected (name-only heuristic)' },
          { label: 'Optimization', value: 'LowCardinality(String) Dictionary Index' },
          { label: 'Estimated Compaction Range', value: '20%–70% on-disk reduction' },
          { label: 'Potential Storage Reduction', value: formatBytes(reductionBytes) },
          { label: 'Storage Rate', value: `$${storagePricePerGB.toFixed(2)} / GB-month`, detail: `Source: ${pricingSource}` },
          { label: 'Estimated Monthly Savings', value: `${formatCurrency(monthlySavings, costModel.currency)} (Range: ${formatCurrency(minSavings, costModel.currency)}–${formatCurrency(maxSavings, costModel.currency)})` },
        ],
        optimizationGroup: `table:${finding.table}:col:${colName}:schema`,
        isEstimable: true,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 2. DATA TYPE & SCHEMA OPTIMIZATION: Numeric Type Narrowing (Int64 -> Int32, UInt64 -> UInt32, Float64 -> Float32)
  // =========================================================================
  const isNumericNarrowing =
    /(?:int64\s*(?:→|->)\s*int32|uint64\s*(?:→|->)\s*uint32|float64\s*(?:→|->)\s*float32)/i.test(fullText) ||
    /numeric_narrowing/i.test(finding.id) ||
    /oversized integer/i.test(fullText);

  if (isNumericNarrowing && finding.table) {
    const colName =
      finding.metrics?.columnName ||
      (() => {
        const match = finding.title.match(/['`]([^'`]+)\.([^'`]+)['`]/) || finding.evidence.match(/column ['`]([^'`]+)['`]/i);
        return match ? match[2] || match[1] : 'column';
      })();

    // Target type: Int32 or UInt32
    const targetType = finding.metrics?.suggestedType || (/uint64/i.test(fullText) ? 'UInt32' : 'Int32');

    let colCompressedBytes: number | null = null;
    if (finding.metrics?.columnCompressedBytes && finding.metrics.columnCompressedBytes > 0) {
      colCompressedBytes = finding.metrics.columnCompressedBytes;
    } else {
      // Must match COMPRESSED bytes explicitly - never uncompressed!
      const compMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*compressed/i);
      if (compMatch) {
        colCompressedBytes = parseBytesFromText(`${compMatch[1]} ${compMatch[2]}`);
      }
    }

    if (!colCompressedBytes) {
      return null;
    }

    if (colCompressedBytes && colCompressedBytes > 5 * 1024 * 1024) {
      // Int64/UInt64 is 8 bytes; Int32/UInt32 is 4 bytes. Raw reduction is 50%.
      // Accounting for ClickHouse columnar compression (LZ4/DoubleDelta), net compressed storage shrinks by ~40%.
      const netReductionPct = 40;
      const reductionBytes = colCompressedBytes * (netReductionPct / 100);
      const reductionGB = reductionBytes / (1024 * 1024 * 1024);
      const monthlySavings = reductionGB * storagePricePerGB;
      const currentMonthlyCost = (colCompressedBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
      const afterMonthlyCost = ((colCompressedBytes - reductionBytes) / (1024 * 1024 * 1024)) * storagePricePerGB;

      // Honest range
      const minSavings = (colCompressedBytes * 0.25 / (1024 * 1024 * 1024)) * storagePricePerGB;
      const maxSavings = (colCompressedBytes * 0.45 / (1024 * 1024 * 1024)) * storagePricePerGB;

      return {
        category: 'storage',
        currentMonthlyCost: Math.round(currentMonthlyCost * 100) / 100,
        estimatedMonthlyCostAfter: Math.round(afterMonthlyCost * 100) / 100,
        estimatedMonthlySavings: Math.round(monthlySavings * 100) / 100,
        savingsPercentage: netReductionPct,
        annualProjectedSavings: Math.round(monthlySavings * 12 * 100) / 100,
        savingsRange: {
          minMonthlySavings: Math.round(minSavings * 100) / 100,
          maxMonthlySavings: Math.round(maxSavings * 100) / 100,
          minBytesReduced: colCompressedBytes * 0.25,
          maxBytesReduced: colCompressedBytes * 0.45,
          minFormatted: formatBytes(colCompressedBytes * 0.25),
          maxFormatted: formatBytes(colCompressedBytes * 0.45),
        },
        resourceReduction: {
          bytes: reductionBytes,
          bytesFormatted: formatBytes(reductionBytes),
          percentage: netReductionPct,
        },
        confidence: 'low',
        confidenceReason: 'Candidate identified from column name convention only; actual min/max values were not inspected. If verified to fit within 32-bit limits, narrowing raw type width from 8 bytes to 4 bytes can reduce storage.',
        assumptions: [
          `Current column footprint: ${formatBytes(colCompressedBytes)} compressed.`,
          'Assumed values fit within 32-bit range based on column name heuristic; actual value range was not inspected.',
          'Raw type width reduced from 8 bytes/value (64-bit) to 4 bytes/value (32-bit) — 50% raw reduction.',
          'Accounted for ClickHouse columnar integer compression (estimated ~25%–45% net compressed storage reduction).',
          `Storage price: $${storagePricePerGB.toFixed(2)} / GB-month (Source: ${pricingSource}).`,
        ],
        methodology: 'Reduction = Column compressed bytes × 40% net compaction factor. Monthly savings = Reduction (GB) × Storage price.',
        calculationBasis: `Type width: 8 bytes → 4 bytes (50% raw reduction, ~40% compressed reduction). Footprint: ${formatBytes(colCompressedBytes)} → ${formatBytes(colCompressedBytes - reductionBytes)}.`,
        recommendedAction: `-- Verify value range first:\nSELECT min(${colName}), max(${colName}) FROM ${finding.table};\n-- If values fit in 32-bit limits:\nALTER TABLE ${finding.table} MODIFY COLUMN ${colName} ${targetType};`,
        calculationSteps: [
          { label: 'Current Column Size', value: formatBytes(colCompressedBytes) },
          { label: 'Current Type Width', value: '8 bytes (Int64 / UInt64)' },
          { label: 'Target Type Width', value: `4 bytes (${targetType})` },
          { label: 'Raw Width Reduction', value: '50% (4 bytes saved per row)' },
          { label: 'Net Compressed Reduction', value: '~40% after columnar compression (range 25%–45%)' },
          { label: 'Potential Storage Saved', value: formatBytes(reductionBytes) },
          { label: 'Storage Rate', value: `$${storagePricePerGB.toFixed(2)} / GB-month`, detail: `Source: ${pricingSource}` },
          { label: 'Estimated Monthly Savings', value: formatCurrency(monthlySavings, costModel.currency) },
        ],
        optimizationGroup: `table:${finding.table}:col:${colName}:schema`,
        isEstimable: true,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 3. DATA TYPE & SCHEMA OPTIMIZATION: Date / DateTime (String -> Date, String -> DateTime, DateTime64 -> DateTime)
  // =========================================================================
  const isDateOptimization =
    /(?:string\s*(?:→|->)\s*date|string\s*(?:→|->)\s*datetime|datetime64\s*(?:→|->)\s*datetime)/i.test(fullText) ||
    /date_type_candidate/i.test(finding.id) ||
    /string date/i.test(fullText);

  if (isDateOptimization && finding.table) {
    const colName =
      finding.metrics?.columnName ||
      (() => {
        const match = finding.title.match(/['`]([^'`]+)\.([^'`]+)['`]/) || finding.evidence.match(/column ['`]([^'`]+)['`]/i);
        return match ? match[2] || match[1] : 'column';
      })();

    let colBytes: number | null = null;
    if (finding.metrics?.columnCompressedBytes && finding.metrics.columnCompressedBytes > 0) {
      colBytes = finding.metrics.columnCompressedBytes;
    } else {
      const compMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*compressed/i);
      if (compMatch) {
        colBytes = parseBytesFromText(`${compMatch[1]} ${compMatch[2]}`);
      }
    }

    if (!colBytes) {
      return null;
    }

    if (colBytes && colBytes > 5 * 1024 * 1024) {
      const isDateOnly = /date/i.test(finding.recommendation_sql_or_text) && !/datetime/i.test(finding.recommendation_sql_or_text);
      const targetType = isDateOnly ? 'Date' : 'DateTime';
      const reductionPercentage = 60;
      const reductionBytes = colBytes * (reductionPercentage / 100);
      const reductionGB = reductionBytes / (1024 * 1024 * 1024);
      const monthlySavings = reductionGB * storagePricePerGB;

      return {
        category: 'storage',
        currentMonthlyCost: Math.round(((colBytes / (1024 * 1024 * 1024)) * storagePricePerGB) * 100) / 100,
        estimatedMonthlyCostAfter: Math.round((((colBytes - reductionBytes) / (1024 * 1024 * 1024)) * storagePricePerGB) * 100) / 100,
        estimatedMonthlySavings: Math.round(monthlySavings * 100) / 100,
        savingsPercentage: reductionPercentage,
        annualProjectedSavings: Math.round(monthlySavings * 12 * 100) / 100,
        resourceReduction: {
          bytes: reductionBytes,
          bytesFormatted: formatBytes(reductionBytes),
          percentage: reductionPercentage,
        },
        confidence: 'low',
        confidenceReason: `Candidate identified from column name convention; value range was not inspected. Converting String temporal representations to native ${targetType} (2-4 bytes) can reduce storage and enable binary date indexing.`,
        assumptions: [
          `Current column footprint: ${formatBytes(colBytes)} compressed.`,
          'Candidate identified based on column name heuristic; string values were not inspected.',
          `Converting to native ${targetType} (${isDateOnly ? '2 bytes' : '4 bytes'} fixed width vs variable String).`,
          `Estimated ~${reductionPercentage}% storage reduction.`,
          `Storage price: $${storagePricePerGB.toFixed(2)} / GB-month (Source: ${pricingSource}).`,
        ],
        methodology: `Storage reduction = Column size × ${reductionPercentage}% temporal compaction. Monthly savings = Reduction (GB) × Storage price.`,
        calculationBasis: `String format → native ${targetType}. Reduction: ${formatBytes(colBytes)} → ${formatBytes(colBytes - reductionBytes)}.`,
        recommendedAction: `ALTER TABLE ${finding.table} MODIFY COLUMN ${colName} ${targetType};`,
        calculationSteps: [
          { label: 'Current Column Footprint', value: formatBytes(colBytes) },
          { label: 'Current Representation', value: 'Generic String' },
          { label: 'Target Native Type', value: `${targetType} (${isDateOnly ? '2 bytes' : '4 bytes'})` },
          { label: 'Estimated Compaction', value: `~${reductionPercentage}% storage reduction` },
          { label: 'Potential Storage Saved', value: formatBytes(reductionBytes) },
          { label: 'Storage Rate', value: `$${storagePricePerGB.toFixed(2)} / GB-month`, detail: `Source: ${pricingSource}` },
          { label: 'Estimated Monthly Savings', value: formatCurrency(monthlySavings, costModel.currency) },
        ],
        optimizationGroup: `table:${finding.table}:col:${colName}:schema`,
        isEstimable: true,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 4. COMPRESSION OPTIMIZATION: Codec Optimization (e.g. low_compression_*, Suboptimal compression)
  // =========================================================================
  if (finding.category === 'compression' || finding.id.includes('compression') || finding.id.includes('low_compression')) {
    let uncompressedBytes: number | null = null;
    let compressedBytes: number | null = null;
    let usedRegexFallback = false;

    if (
      finding.metrics?.columnCompressedBytes &&
      finding.metrics?.columnUncompressedBytes &&
      finding.metrics.columnCompressedBytes > 0 &&
      finding.metrics.columnUncompressedBytes > 0
    ) {
      compressedBytes = finding.metrics.columnCompressedBytes;
      uncompressedBytes = finding.metrics.columnUncompressedBytes;
    } else if (tableMeta && tableMeta.total_bytes_uncompressed > 0 && tableMeta.total_bytes_compressed > 0) {
      uncompressedBytes = tableMeta.total_bytes_uncompressed;
      compressedBytes = tableMeta.total_bytes_compressed;
    } else {
      const uncompMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*uncompressed/i);
      const compMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)\s*compressed/i);
      if (uncompMatch && compMatch) {
        uncompressedBytes = parseBytesFromText(`${uncompMatch[1]} ${uncompMatch[2]}`);
        compressedBytes = parseBytesFromText(`${compMatch[1]} ${compMatch[2]}`);
        usedRegexFallback = true;
      }
    }

    if (uncompressedBytes && compressedBytes && compressedBytes > 0 && uncompressedBytes >= compressedBytes) {
      const currentRatio = uncompressedBytes / compressedBytes;
      // Target compression ratio with ZSTD(3) / specialized codec:
      // Typically 3.5x to 4.5x for text/JSON, or 2.5x to 3.0x for mixed data
      const targetRatio = currentRatio < 1.3 ? 3.8 : Math.max(2.5, currentRatio * 2.2);
      const minTargetRatio = targetRatio * 0.85;
      const maxTargetRatio = targetRatio * 1.15;

      const estimatedOptimizedCompressedBytes = uncompressedBytes / targetRatio;
      const potentialReductionBytes = Math.max(0, compressedBytes - estimatedOptimizedCompressedBytes);

      const minReductionBytes = Math.max(0, compressedBytes - (uncompressedBytes / minTargetRatio));
      const maxReductionBytes = Math.max(0, compressedBytes - (uncompressedBytes / maxTargetRatio));

      if (potentialReductionBytes > 10 * 1024 * 1024) { // Only if > 10MB
        const reductionGB = potentialReductionBytes / (1024 * 1024 * 1024);
        const monthlySavings = reductionGB * storagePricePerGB;
        const currentMonthlyCost = (compressedBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
        const afterMonthlyCost = (estimatedOptimizedCompressedBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
        const savingsPct = Math.round((potentialReductionBytes / compressedBytes) * 100);

        const minSavings = (minReductionBytes / (1024 * 1024 * 1024)) * storagePricePerGB;
        const maxSavings = (maxReductionBytes / (1024 * 1024 * 1024)) * storagePricePerGB;

        const colNameMatch = finding.title.match(/['`]([^'`]+)\.([^'`]+)['`]/) || finding.evidence.match(/column ['`]([^'`]+)['`]/i);
        const colName = colNameMatch ? colNameMatch[2] || colNameMatch[1] : 'column';

        return {
          category: 'storage',
          currentMonthlyCost: Math.round(currentMonthlyCost * 100) / 100,
          estimatedMonthlyCostAfter: Math.round(afterMonthlyCost * 100) / 100,
          estimatedMonthlySavings: Math.round(monthlySavings * 100) / 100,
          savingsPercentage: savingsPct,
          annualProjectedSavings: Math.round(monthlySavings * 12 * 100) / 100,
          savingsRange: {
            minMonthlySavings: Math.round(minSavings * 100) / 100,
            maxMonthlySavings: Math.round(maxSavings * 100) / 100,
            minBytesReduced: minReductionBytes,
            maxBytesReduced: maxReductionBytes,
            minFormatted: formatBytes(minReductionBytes),
            maxFormatted: formatBytes(maxReductionBytes),
          },
          resourceReduction: {
            bytes: potentialReductionBytes,
            bytesFormatted: formatBytes(potentialReductionBytes),
            percentage: savingsPct,
          },
          confidence: usedRegexFallback ? 'low' : 'medium',
          confidenceReason: usedRegexFallback
            ? 'Column compression metrics were parsed from evidence text regex fallback; confidence capped at low.'
            : `Observed current uncompressed (${formatBytes(uncompressedBytes)}) and compressed (${formatBytes(compressedBytes)}) sizes are directly measured. Target compression ratio (~${targetRatio.toFixed(1)}x) is derived from ClickHouse ZSTD columnar benchmarks.`,
          assumptions: [
            `Current storage: ${formatBytes(compressedBytes)} (observed compression ratio: ${currentRatio.toFixed(2)}x).`,
            `Expected compression ratio with ZSTD(3): ~${targetRatio.toFixed(1)}x (range: ${minTargetRatio.toFixed(1)}x–${maxTargetRatio.toFixed(1)}x).`,
            `Storage cost based on configured rate: $${storagePricePerGB.toFixed(2)} / GB-month (Source: ${pricingSource}).`,
            'Zero data growth assumed (steady-state current footprint).',
          ],
          methodology: `Storage reduction = Current compressed bytes - (Uncompressed bytes / Target compression ratio ${targetRatio.toFixed(1)}x). Monthly savings = Reduction (GB) × Storage price.`,
          calculationBasis: `Current compressed storage: ${formatBytes(compressedBytes)} → Estimated optimized: ${formatBytes(estimatedOptimizedCompressedBytes)} (saving ${formatBytes(potentialReductionBytes)} / ${savingsPct}%).`,
          recommendedAction: finding.table ? `ALTER TABLE ${finding.table} MODIFY COLUMN ${colName} CODEC(ZSTD(3));` : 'Apply ZSTD(3) compression codec.',
          calculationSteps: [
            { label: 'Current Compressed Size', value: formatBytes(compressedBytes) },
            { label: 'Observed Compression Ratio', value: `${currentRatio.toFixed(2)}x` },
            { label: 'Target Ratio with ZSTD Codec', value: `${targetRatio.toFixed(1)}x`, detail: 'ZSTD level 3 standard benchmark' },
            { label: 'Estimated Optimized Size', value: formatBytes(estimatedOptimizedCompressedBytes) },
            { label: 'Potential Storage Reduction', value: `${formatBytes(potentialReductionBytes)} (-${savingsPct}%)` },
            { label: 'Configured Storage Rate', value: `$${storagePricePerGB.toFixed(2)} / GB-month`, detail: `Source: ${pricingSource}` },
            { label: 'Estimated Monthly Savings', value: `${formatCurrency(monthlySavings, costModel.currency)} (Range: ${formatCurrency(minSavings, costModel.currency)}–${formatCurrency(maxSavings, costModel.currency)})` },
          ],
          optimizationGroup: `table:${finding.table || 'global'}:col:${colName}:compression`,
          isEstimable: true,
          pricingSource,
        };
      }
    }
  }

  // =========================================================================
  // 5. PRIMARY KEY / EMPTY ORDER BY (e.g. user_audit_logs with ORDER BY tuple())
  // =========================================================================
  if (finding.category === 'primary_key' && (/order by tuple\(\)/i.test(String(finding.metric_value)) || /empty order by/i.test(finding.title.toLowerCase()))) {
    const tableSize = tableMeta?.total_bytes_compressed || 0;
    return {
      category: 'mixed',
      estimatedMonthlySavings: 0,
      annualProjectedSavings: 0,
      isEstimable: false,
      confidence: 'low',
      confidenceReason: 'Table uses unsorted ORDER BY tuple(). Compound sorting enables sparse index pruning and improves compression, but financial savings cannot be projected without an empirical sorting benchmark.',
      assumptions: [
        `Table size: ${formatBytes(tableSize || undefined)}.`,
        'Compound ORDER BY allows run-length and delta compression across adjacent sorted rows.',
        'Enables sparse primary index pruning to avoid full-table scans.',
        'Exact compression and I/O savings depend on row ordering; financial estimate not fabricated.',
      ],
      methodology: 'Sorting optimization efficiency requires empirical benchmark.',
      calculationBasis: `Table '${finding.table}' has unsorted storage. Recreating with compound ORDER BY improves compression and pruning; financial impact unavailable.`,
      recommendedAction: `Recreate table '${finding.table}' with compound ORDER BY matching query filter columns.`,
      calculationSteps: [
        { label: 'Current Table Footprint', value: formatBytes(tableSize || undefined) },
        { label: 'Current ORDER BY', value: 'tuple() (unsorted)' },
        { label: 'Estimated Financial Impact', value: 'Technical impact only (benchmark required)' },
      ],
      optimizationGroup: `table:${finding.table}:sorting`,
      resourceReduction: {
        percentage: 25,
      },
      technicalReductionOnlyText: `Table uses unsorted ORDER BY tuple(). Compound sorting enables index pruning and improves compression; exact financial savings requires benchmark.`,
      pricingSource,
    };
  }

  // =========================================================================
  // 6. MEMORY ENGINE MISUSE (e.g. session_cache in RAM)
  // =========================================================================
  if (finding.category === 'table_engine' && /Memory/i.test(String(finding.metric_value)) && /RAM/i.test(finding.evidence)) {
    let ramBytes: number | null = null;
    let usedRegexFallback = false;

    if (finding.metrics?.ramBytes && finding.metrics.ramBytes > 0) {
      ramBytes = finding.metrics.ramBytes;
    } else if (tableMeta && tableMeta.total_bytes_uncompressed > 0) {
      ramBytes = tableMeta.total_bytes_uncompressed;
    } else {
      const ramMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(MB|GB)\s*RAM/i);
      if (ramMatch) {
        ramBytes = parseBytesFromText(`${ramMatch[1]} ${ramMatch[2]}`);
        usedRegexFallback = true;
      }
    }

    if (ramBytes && ramBytes > 50 * 1024 * 1024) {
      const ramGB = ramBytes / (1024 * 1024 * 1024);
      // Compute RAM cost: 730 hours/month * computePricePerGBRAM ($0.006/GB-hr) = ~$4.38/GB-mo RAM
      const monthlyRamCost = ramGB * 730 * computePricePerGBRAM;
      // MergeTree will compress the data to ~25% on disk
      const diskCost = (ramGB * 0.25) * storagePricePerGB;
      const netMonthlySavings = Math.max(0, monthlyRamCost - diskCost);

      return {
        category: 'compute',
        currentMonthlyCost: Math.round(monthlyRamCost * 100) / 100,
        estimatedMonthlyCostAfter: Math.round(diskCost * 100) / 100,
        estimatedMonthlySavings: Math.round(netMonthlySavings * 100) / 100,
        savingsPercentage: Math.round((netMonthlySavings / monthlyRamCost) * 100),
        annualProjectedSavings: Math.round(netMonthlySavings * 12 * 100) / 100,
        resourceReduction: {
          bytes: ramBytes,
          bytesFormatted: `${ramGB.toFixed(1)} GB RAM freed`,
          percentage: 85,
        },
        confidence: usedRegexFallback ? 'low' : 'medium',
        confidenceReason: usedRegexFallback
          ? 'Memory table RAM footprint was extracted via text pattern fallback; confidence capped at low.'
          : 'Memory table RAM allocation is directly measured. Freeing RAM directly reduces host sizing tier requirements.',
        assumptions: [
          `RAM consumed: ${ramGB.toFixed(2)} GB uncompressed in ClickHouse memory.`,
          `Host RAM pricing: $${computePricePerGBRAM.toFixed(3)} / GB-hour ($${(computePricePerGBRAM * 730).toFixed(2)}/GB-month).`,
          'MergeTree disk storage: ~0.25x of raw RAM footprint.',
        ],
        methodology: 'Monthly savings = (Freed RAM GB × 730 hrs × RAM price/GB-hr) - (Disk storage cost).',
        calculationBasis: `${ramGB.toFixed(2)} GB RAM freed from server memory → relocated to compressed NVMe/EBS disk.`,
        recommendedAction: `Migrate '${finding.table}' from Memory engine to MergeTree engine.`,
        calculationSteps: [
          { label: 'Current RAM Allocated', value: `${ramGB.toFixed(2)} GB` },
          { label: 'Current Monthly RAM Cost', value: formatCurrency(monthlyRamCost, costModel.currency) },
          { label: 'Target MergeTree Disk Cost', value: formatCurrency(diskCost, costModel.currency) },
          { label: 'Net Monthly Compute Savings', value: formatCurrency(netMonthlySavings, costModel.currency) },
        ],
        optimizationGroup: `table:${finding.table}:engine_ram`,
        isEstimable: true,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 7. QUERY / COMPUTE WORKLOAD SAVINGS (system.query_log)
  // =========================================================================
  if (finding.category === 'query_performance' || finding.id.includes('query_poor_pruning') || finding.id.includes('missing_skip_idx')) {
    let dailyTBRead: number | null = null;
    let executionsPerDay: number | null = finding.metrics?.dailyExecutions ?? null;
    let avgDurationSec: number | null = finding.metrics?.queryDurationMs ? finding.metrics.queryDurationMs / 1000 : null;
    let perQueryBytes: number | null = finding.metrics?.queryReadBytes ?? null;
    let usedRegexFallback = false;

    if (finding.metrics?.dailyScannedBytes && finding.metrics.dailyScannedBytes > 0) {
      dailyTBRead = finding.metrics.dailyScannedBytes / (1024 * 1024 * 1024 * 1024);
    }

    const dailyWorkloadMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*(?:read\/day|scanned\/day)/i);
    const execCountMatch = finding.evidence.match(/([\d,]+)\s*(?:executions\/day|runs\/day)/i);
    const durationMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(?:sec|seconds)\s*(?:average|avg|duration)/i);
    const readPerQueryMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|PB)\s*read/i);

    if (!executionsPerDay && execCountMatch) {
      executionsPerDay = parseInt(execCountMatch[1].replace(/,/g, ''), 10);
      usedRegexFallback = true;
    }
    if (!avgDurationSec && durationMatch) {
      avgDurationSec = parseFloat(durationMatch[1]);
      usedRegexFallback = true;
    }
    if (!perQueryBytes && readPerQueryMatch) {
      perQueryBytes = parseBytesFromText(`${readPerQueryMatch[1]} ${readPerQueryMatch[2]}`);
      usedRegexFallback = true;
    }

    if (!dailyTBRead && dailyWorkloadMatch) {
      const bytes = parseBytesFromText(`${dailyWorkloadMatch[1]} ${dailyWorkloadMatch[2]}`);
      if (bytes) {
        dailyTBRead = bytes / (1024 * 1024 * 1024 * 1024);
        usedRegexFallback = true;
      }
    } else if (!dailyTBRead && perQueryBytes && executionsPerDay) {
      // ONLY compute dailyTBRead if executionsPerDay is genuinely known! Never invent 500!
      dailyTBRead = (perQueryBytes * executionsPerDay) / (1024 * 1024 * 1024 * 1024);
    }

    const isHighAmp = /amplification/i.test(fullText) || /ratio\s*(?:>|over)?\s*[\d,]+x/i.test(fullText);
    const reductionPercentage = isHighAmp ? 85 : 40;

    // If daily workload is NOT known (e.g. per-query read is known, but executions/day is unknown):
    if (dailyTBRead === null || dailyTBRead <= 0) {
      if (perQueryBytes) {
        return {
          category: 'query',
          estimatedMonthlySavings: 0,
          annualProjectedSavings: 0,
          isEstimable: false,
          confidence: 'low',
          confidenceReason: 'Per-query scanned volume is measured from query_log, but daily execution frequency is unknown. Financial impact cannot be computed without workload frequency.',
          assumptions: [
            `Scanned per query: ${formatBytes(perQueryBytes)}.`,
            'Workload frequency (executions/day) is unknown from metadata.',
            'No assumed execution frequency substituted.',
          ],
          methodology: 'Workload frequency required for financial projection.',
          calculationBasis: `Query scanned ${formatBytes(perQueryBytes)}. Daily frequency is unknown, so financial impact cannot be calculated without workload volume.`,
          recommendedAction: finding.table ? `Add skip index or compound ORDER BY on '${finding.table}' to enable granule pruning.` : 'Optimize query EXPLAIN plan and indexes.',
          calculationSteps: [
            { label: 'Scanned Per Query', value: formatBytes(perQueryBytes) },
            { label: 'Daily Execution Frequency', value: 'Unknown (not observed)' },
            { label: 'Estimated Financial Impact', value: 'Technical impact only (frequency unknown)' },
          ],
          optimizationGroup: `query:${finding.id}`,
          resourceReduction: {
            percentage: reductionPercentage,
          },
          technicalReductionOnlyText: `Query scanned ${formatBytes(perQueryBytes)}. Workload frequency is unknown; financial impact cannot be calculated without execution count.`,
          pricingSource,
        };
      }
      return null;
    }

    // Daily TB read is known!
    const dailyTBReduced = dailyTBRead * (reductionPercentage / 100);
    const dailyBytesReduced = dailyTBReduced * (1024 * 1024 * 1024 * 1024);
    const monthlyTBReduced = dailyTBReduced * 30;

    if (queryPricePerTB > 0) {
      const monthlySavings = monthlyTBReduced * queryPricePerTB;
      const currentMonthlyCost = dailyTBRead * 30 * queryPricePerTB;
      const afterMonthlyCost = (dailyTBRead - dailyTBReduced) * 30 * queryPricePerTB;

      return {
        category: 'query',
        currentMonthlyCost: Math.round(currentMonthlyCost * 100) / 100,
        estimatedMonthlyCostAfter: Math.round(afterMonthlyCost * 100) / 100,
        estimatedMonthlySavings: Math.round(monthlySavings * 100) / 100,
        savingsPercentage: reductionPercentage,
        annualProjectedSavings: Math.round(monthlySavings * 12 * 100) / 100,
        resourceReduction: {
          queryBytesScannedDaily: dailyBytesReduced,
          queryBytesScannedMonthly: dailyBytesReduced * 30,
          queryBytesScannedFormatted: `${dailyTBReduced.toFixed(2)} TB/day`,
          percentage: reductionPercentage,
        },
        confidence: usedRegexFallback ? 'low' : 'medium',
        confidenceReason: usedRegexFallback
          ? 'Query scan volume was extracted via evidence regex fallback; confidence capped at low.'
          : `Read amplification and scanned volume (${dailyTBRead.toFixed(2)} TB/day) are derived from query_log metrics with ${executionsPerDay ? `${executionsPerDay.toLocaleString()} daily executions` : 'measured workload'}.`,
        assumptions: [
          `Current workload: ${executionsPerDay ? `~${executionsPerDay.toLocaleString()} executions/day` : 'Measured workload'}${avgDurationSec ? `, ${avgDurationSec.toFixed(1)}s avg duration` : ''}.`,
          `Scanned data volume: ${dailyTBRead.toFixed(2)} TB read/day.`,
          `Granule pruning / secondary indexing eliminates ~${reductionPercentage}% of unneeded block reads.`,
          `Query scanning rate: $${queryPricePerTB.toFixed(2)} / TB scanned (Source: ${pricingSource}).`,
        ],
        methodology: `Reduction = Daily scanned TB (${dailyTBRead.toFixed(2)} TB) × ${reductionPercentage}% pruning factor × 30 days. Monthly savings = Scanned TB reduced × Query price/TB.`,
        calculationBasis: `Workload: ${dailyTBRead.toFixed(2)} TB/day → Optimized: ${(dailyTBRead - dailyTBReduced).toFixed(2)} TB/day (Reduction: ${dailyTBReduced.toFixed(2)} TB/day).`,
        recommendedAction: finding.table ? `Add skip index or compound ORDER BY on '${finding.table}' to enable granule pruning.` : 'Optimize query EXPLAIN plan and indexes.',
        calculationSteps: [
          { label: 'Current Workload', value: `${dailyTBRead.toFixed(2)} TB read/day` },
          { label: 'Query Volume', value: executionsPerDay ? `${executionsPerDay.toLocaleString()} executions/day` : 'Measured volume' },
          { label: 'Pruning Reduction', value: `~${reductionPercentage}% of scanned bytes` },
          { label: 'Workload Reduction', value: `${dailyTBReduced.toFixed(2)} TB read/day` },
          { label: 'Monthly Scanned Volume Saved', value: `${monthlyTBReduced.toFixed(2)} TB/month` },
          { label: 'Query Scan Rate', value: `$${queryPricePerTB.toFixed(2)} / TB scanned`, detail: `Source: ${pricingSource}` },
          { label: 'Estimated Monthly Savings', value: formatCurrency(monthlySavings, costModel.currency) },
        ],
        optimizationGroup: `query:${finding.id}`,
        isEstimable: true,
        pricingSource,
      };
    } else {
      // Query price is 0 (default for ClickHouse Cloud / self-hosted):
      return {
        category: 'query',
        estimatedMonthlySavings: 0,
        annualProjectedSavings: 0,
        savingsPercentage: reductionPercentage,
        resourceReduction: {
          queryBytesScannedDaily: dailyBytesReduced,
          queryBytesScannedMonthly: dailyBytesReduced * 30,
          queryBytesScannedFormatted: `${dailyTBReduced.toFixed(2)} TB/day`,
          percentage: reductionPercentage,
        },
        confidence: 'low',
        confidenceReason: 'Technical scanned bytes reduction is measured from query_log, but query scanning price is currently set to $0 (default for ClickHouse Cloud/self-hosted).',
        assumptions: [
          `Current workload: ${dailyTBRead.toFixed(2)} TB read/day.`,
          `Estimated ${reductionPercentage}% reduction in scanned bytes (~${dailyTBReduced.toFixed(2)} TB/day).`,
          'Query pricing set to $0.00/TB (default). Configure per-TB rate in settings if your platform bills per scan.',
        ],
        methodology: 'Technical workload reduction calculated from query log statistics.',
        calculationBasis: `Potential reduction: ${dailyTBReduced.toFixed(2)} TB scanned/day (~${reductionPercentage}%). Estimated financial impact unavailable ($0/TB scan price).`,
        recommendedAction: finding.table ? `Add skip index or compound ORDER BY on '${finding.table}' to enable granule pruning.` : 'Optimize query EXPLAIN plan and indexes.',
        calculationSteps: [
          { label: 'Current Workload', value: `${dailyTBRead.toFixed(2)} TB read/day` },
          { label: 'Workload Reduction', value: `${dailyTBReduced.toFixed(2)} TB/day (~${reductionPercentage}%)` },
          { label: 'Estimated Financial Impact', value: 'Unavailable (Query scan price $0.00/TB)' },
        ],
        optimizationGroup: `query:${finding.id}`,
        isEstimable: false,
        technicalReductionOnlyText: `${dailyTBReduced.toFixed(2)} TB scanned/day (~${reductionPercentage}% reduction). Estimated financial impact unavailable (query scan price $0/TB).`,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 8. MATERIALIZED VIEW CANDIDATE (Aggregating recurring heavy computation)
  // =========================================================================
  if (finding.id.includes('query_mv_candidate') || /materialized view candidate/i.test(finding.title)) {
    const cpuMatch = finding.evidence.match(/(\d+)%\s*of\s*aggregate\s*CPU/i);
    const cpuPct = cpuMatch ? parseInt(cpuMatch[1], 10) : 18;
    const nodeVcpus = 8;
    const cpuHoursSavedMonthly = (nodeVcpus * (cpuPct / 100) * 0.75) * 730; // 75% of query CPU eliminated
    const computeMonthlySavings = cpuHoursSavedMonthly * computePricePerCPU;

    if (computeMonthlySavings > 1.0) {
      return {
        category: 'compute',
        currentMonthlyCost: Math.round((nodeVcpus * (cpuPct / 100) * 730 * computePricePerCPU) * 100) / 100,
        estimatedMonthlyCostAfter: Math.round((nodeVcpus * (cpuPct / 100) * 0.25 * 730 * computePricePerCPU) * 100) / 100,
        estimatedMonthlySavings: Math.round(computeMonthlySavings * 100) / 100,
        savingsPercentage: 75,
        annualProjectedSavings: Math.round(computeMonthlySavings * 12 * 100) / 100,
        resourceReduction: {
          cpuHoursMonthly: Math.round(cpuHoursSavedMonthly),
          percentage: 75,
        },
        confidence: 'medium',
        confidenceReason: 'AggregatingMergeTree materialized views pre-aggregate on write, eliminating ~75% of repetitive CPU scanning overhead.',
        assumptions: [
          `Current recurring query consumes ~${cpuPct}% of server CPU time.`,
          `Estimated host sizing: ${nodeVcpus} vCPU analytical instance.`,
          `Compute rate: $${computePricePerCPU.toFixed(3)} / vCPU-hour (Source: ${pricingSource}).`,
          'Pre-aggregation with Materialized View replaces full-table aggregation with incremental merge.',
        ],
        methodology: 'Monthly compute savings = (vCPUs × CPU fraction × 75% reduction × 730 hours/month) × Compute price/vCPU-hr.',
        calculationBasis: `Pre-aggregating recurring query saves ~${Math.round(cpuHoursSavedMonthly)} vCPU-hours/month (${cpuPct}% CPU load eliminated).`,
        recommendedAction: 'Create Materialized View with SummingMergeTree or AggregatingMergeTree.',
        calculationSteps: [
          { label: 'Workload Impact', value: `${cpuPct}% of total CPU utilization` },
          { label: 'Target Architecture', value: 'SummingMergeTree / AggregatingMergeTree MV' },
          { label: 'CPU Hours Saved', value: `~${Math.round(cpuHoursSavedMonthly)} vCPU-hours/month` },
          { label: 'Compute Price Rate', value: `$${computePricePerCPU.toFixed(3)} / vCPU-hour`, detail: `Source: ${pricingSource}` },
          { label: 'Estimated Monthly Savings', value: formatCurrency(computeMonthlySavings, costModel.currency) },
        ],
        optimizationGroup: `compute:mv:${finding.id}`,
        isEstimable: true,
        pricingSource,
      };
    }
  }

  // =========================================================================
  // 9. UNPARTITIONED LARGE TABLE (Partitioning Strategy)
  // =========================================================================
  if (finding.category === 'partitioning' && /unpartitioned_large/i.test(finding.id)) {
    const sizeMatch = finding.evidence.match(/([\d,]+(?:\.\d+)?)\s*(MB|GB|TB)/i);
    const sizeBytes = sizeMatch ? parseBytesFromText(`${sizeMatch[1]} ${sizeMatch[2]}`) : (tableMeta ? tableMeta.total_bytes_compressed : null);

    return {
      category: 'storage',
      estimatedMonthlySavings: 0,
      annualProjectedSavings: 0,
      isEstimable: false,
      resourceReduction: {
        percentage: 0,
      },
      confidence: 'low',
      confidenceReason: 'Date partitioning enables instant zero-cost partition drops and directory pruning, but query-pattern savings cannot be estimated without query workload logs.',
      assumptions: [
        `Table volume: ${formatBytes(sizeBytes || undefined)}.`,
        'Date partitioning (toYYYYMM) enables instant partition drops rather than row-by-row mutations.',
        'Allows date-filtered analytical queries to skip unneeded monthly directories.',
      ],
      methodology: 'Estimated operational efficiency and partition prune savings.',
      calculationBasis: `Partitioning enables instant TTL drops and directory pruning on ${formatBytes(sizeBytes || undefined)} dataset. Estimated financial impact unavailable without query workload logs.`,
      recommendedAction: `PARTITION BY toYYYYMM(timestamp);`,
      calculationSteps: [
        { label: 'Table Size', value: formatBytes(sizeBytes || undefined) },
        { label: 'Partition Strategy', value: 'PARTITION BY toYYYYMM(date_col)' },
        { label: 'Estimated Financial Impact', value: 'Technical impact only' },
      ],
      optimizationGroup: `table:${finding.table}:partitioning`,
      technicalReductionOnlyText: `Partitioning enables instant partition drops and directory pruning on ${formatBytes(sizeBytes || undefined)} dataset. Estimated financial impact unavailable without query workload logs.`,
      pricingSource,
    };
  }

  // If no financial calculation could be substantiated, do not fabricate dollar values!
  return null;
}

/**
 * Aggregates all findings across a report into a cohesive, defensible financial summary.
 * Crucially eliminates double-counting by grouping mutually exclusive optimizations.
 */
export function calculateReportCostSummary(
  findings: CheckFinding[],
  tableMetadataList?: TableMetadata[],
  costModel: CostModel = DEFAULT_COST_MODEL
): ReportCostSummary {
  // Map of optimizationGroup -> CostImpact (keeps the highest-impact recommendation per group)
  const groupWinners = new Map<string, { finding: CheckFinding; impact: CostImpact }>();
  const allRanked: RankedOpportunity[] = [];

  for (const f of findings) {
    const impact = calculateFindingCostImpact(f, tableMetadataList, costModel);
    if (!impact || !impact.isEstimable || impact.estimatedMonthlySavings <= 0) {
      continue;
    }

    allRanked.push({
      findingId: f.id,
      title: f.title,
      table: f.table,
      category: f.category,
      categoryName: f.category_name,
      severity: f.status,
      costImpact: impact,
    });

    // Double-counting prevention:
    // If multiple findings target the same group (e.g. table:events_raw:col:payload_json),
    // choose the one with higher estimated savings to avoid summing conflicting changes
    const groupKey = impact.optimizationGroup;
    const existing = groupWinners.get(groupKey);

    if (!existing || impact.estimatedMonthlySavings > existing.impact.estimatedMonthlySavings) {
      groupWinners.set(groupKey, { finding: f, impact });
    }
  }

  // Sum only the deduplicated group winners
  let totalMonthlySavings = 0;
  let storageMonthlySavings = 0;
  let storageBytesReduced = 0;
  let queryComputeMonthlySavings = 0;
  let queryBytesScannedDailyReduced = 0;

  const confidenceBreakdown = {
    high: 0,
    medium: 0,
    low: 0,
  };

  let highImpactCount = 0;

  for (const { impact } of groupWinners.values()) {
    totalMonthlySavings += impact.estimatedMonthlySavings;

    if (impact.category === 'storage') {
      storageMonthlySavings += impact.estimatedMonthlySavings;
      if (impact.resourceReduction.bytes) {
        storageBytesReduced += impact.resourceReduction.bytes;
      }
    } else {
      queryComputeMonthlySavings += impact.estimatedMonthlySavings;
      if (impact.resourceReduction.queryBytesScannedDaily) {
        queryBytesScannedDailyReduced += impact.resourceReduction.queryBytesScannedDaily;
      }
    }

    confidenceBreakdown[impact.confidence]++;

    if (impact.estimatedMonthlySavings >= 25) {
      highImpactCount++;
    }
  }

  // Sort ranked opportunities by monthly savings descending
  allRanked.sort((a, b) => b.costImpact.estimatedMonthlySavings - a.costImpact.estimatedMonthlySavings);

  return {
    totalMonthlySavings: Math.round(totalMonthlySavings * 100) / 100,
    totalAnnualSavings: Math.round(totalMonthlySavings * 12 * 100) / 100,
    storageMonthlySavings: Math.round(storageMonthlySavings * 100) / 100,
    storageBytesReduced,
    storageBytesReducedFormatted: formatBytes(storageBytesReduced),
    queryComputeMonthlySavings: Math.round(queryComputeMonthlySavings * 100) / 100,
    queryBytesScannedDailyReduced,
    queryBytesScannedDailyReducedFormatted: `${(queryBytesScannedDailyReduced / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB/day`,
    totalOpportunitiesCount: groupWinners.size,
    highImpactCount,
    confidenceBreakdown,
    topOpportunities: allRanked,
    costModelUsed: costModel,
  };
}
