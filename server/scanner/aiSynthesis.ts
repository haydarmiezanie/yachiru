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
    const validOpenAiModel = options.modelName && !options.modelName.startsWith('gemini')
      ? options.modelName
      : 'gpt-4o';
    return synthesizeWithOpenAi(scanResult, {
      aiEnabled: options.aiEnabled,
      modelName: validOpenAiModel,
      databaseName: options.databaseName,
      clusterName: options.clusterName,
      apiKey: options.apiKey,
    });
  }

  const validGeminiModel = options.modelName && !options.modelName.startsWith('gpt')
    ? options.modelName
    : 'gemini-3.7-flash';

  return synthesizeWithGemini(scanResult, {
    aiEnabled: options.aiEnabled,
    modelName: validGeminiModel,
    databaseName: options.databaseName,
    clusterName: options.clusterName,
    apiKey: options.apiKey,
  });
}
