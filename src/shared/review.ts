export type FileStatus = 'unchanged' | 'modified' | 'added' | 'deleted';
export interface ReviewFile { path: string; status: FileStatus; supported: boolean }
export interface RepositoryReview {
  root: string;
  head: string | null;
  files: ReviewFile[];
  changedFiles: ReviewFile[];
}
export interface SourceSnapshot {
  version: 'current' | 'previous';
  content: string;
  hash: string;
}
export interface FileReview extends ReviewFile {
  repositoryPath: string;
  current: SourceSnapshot | null;
  previous: SourceSnapshot | null;
  diff: string;
  notice?: string;
}

export interface RecentProject { path: string; name: string }
export interface RecentProjectsResult { projects: RecentProject[]; warning?: string }
export interface OpenedProject extends RepositoryReview { history: RecentProjectsResult }
