import { DeterministicScanResult } from './deterministicRules.js';
import { ExecutiveSummary, Finding } from '../../src/types/yachiru.js';
import { synthesizeWithGemini } from './geminiSynthesis.js';
import { synthesizeWithOpenAi } from './openAiSynthesis.js';

export type AIProvider = 'gemini' | 'openai';

export interface AISynthesisResult {
  executiveSummary: ExecutiveSummary;
  enhancedFindings: Finding[];
  aiStatus: 'success' | 'fallback' | 'disabled';
  modelUsed?: string;
  provider: AIProvider;
  error?: string;
}

export async function synthesizeWithAI(
  scanResult: DeterministicScanResult,
  options: {
    aiEnabled?: boolean;
    provider?: AIProvider;
    modelName?: string;
    databaseName?: string;
    clusterName?: string;
    apiKey?: string;
  }
): Promise<AISynthesisResult> {
  const provider = options.provider || 'gemini';

  if (provider === 'openai') {
    return synthesizeWithOpenAi(scanResult, {
      aiEnabled: options.aiEnabled,
      modelName: options.modelName || 'gpt-5.6-sol',
      databaseName: options.databaseName,
      clusterName: options.clusterName,
      apiKey: options.apiKey,
    });
  }

  return synthesizeWithGemini(scanResult, {
    aiEnabled: options.aiEnabled,
    modelName: options.modelName || 'gemini-3.1-pro-preview',
    databaseName: options.databaseName,
    clusterName: options.clusterName,
    apiKey: options.apiKey,
  });
}
