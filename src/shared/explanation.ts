import type { SourceSnapshot } from './review.js';
export interface AnalysisFile extends SourceSnapshot { path: string }
export interface AnalysisFunction { id: string; name: string; startLine: number; endLine: number; kind?: 'function' | 'module' | 'class' | 'type' | 'constant' | 'variable' | 'anonymous' | 'enum'; displayName?: string }
export interface AnalysisPreview {
  id: string; repositoryPath: string; filePath: string; model: string;
  files: AnalysisFile[]; functions: AnalysisFunction[];
  contextLimitBytes?: number; contextWarnings?: string[]; unavailableReason?: string;
}
export interface SourceReference { path: string; version: SourceSnapshot['version']; sourceHash: string; startLine: number; endLine: number }
export interface ExplanationStatement { text: string; uncertainty: string | null; reference: SourceReference }
export interface FunctionExplanation extends AnalysisFunction { statements: ExplanationStatement[] }
export interface GenerationUsage { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number }
export interface FileExplanation { cached?: boolean; usage?: GenerationUsage; previewId: string; model: string; functions: FunctionExplanation[]; files: AnalysisFile[]; contextWarnings?: string[] }
export interface ModelSettings { model: string; configured: boolean }
