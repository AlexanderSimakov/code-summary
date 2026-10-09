import type { AnalysisFile, AnalysisPreview, ExplanationStatement, FileExplanation } from './explanation.js';
export interface ComparisonPreview {
  id: string; repositoryPath: string; filePath: string; model: string;
  files: AnalysisFile[]; previous: AnalysisPreview | null; current: AnalysisPreview | null;
}
export interface StatementComparison {
  change: 'added' | 'removed' | 'modified' | 'unchanged';
  previous: ExplanationStatement | null; current: ExplanationStatement | null;
}
export interface FunctionComparison { name: string; displayName?: string; kind?: AnalysisPreview['functions'][number]['kind']; statements: StatementComparison[] }
export interface FileComparison {
  previewId: string; functions: FunctionComparison[]; files: AnalysisFile[];
  previous: FileExplanation | null; current: FileExplanation | null;
  assessment: string | null; uncertainty: string;
}
