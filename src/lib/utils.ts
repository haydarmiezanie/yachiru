import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatRows(rows: number): string {
  if (rows >= 1_000_000_000) return `${(rows / 1_000_000_000).toFixed(2)}B`;
  if (rows >= 1_000_000) return `${(rows / 1_000_000).toFixed(2)}M`;
  if (rows >= 1_000) return `${(rows / 1_000).toFixed(1)}k`;
  return rows.toString();
}
