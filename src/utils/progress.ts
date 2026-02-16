/**
 * Progress information for long-running CLI operations
 */
export interface ProgressInfo {
  stage: string; // e.g., "fetching", "processing", "saving"
  current: number; // Current item count
  total: number; // Total items to process
  currentPage?: number; // For paginated operations
  totalPages?: number; // For paginated operations
  message?: string; // Optional detailed message
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: ProgressInfo) => void;

/**
 * No-op progress callback (does nothing)
 */
export const noopProgress: ProgressCallback = () => {
  // No operation
};

/**
 * Create a progress callback that logs to console
 */
export function createConsoleProgress(verbose: boolean = true): ProgressCallback {
  return (progress: ProgressInfo) => {
    if (!verbose) return;
    
    let message = `${progress.stage}: ${progress.current}/${progress.total}`;
    
    if (progress.currentPage !== undefined && progress.totalPages !== undefined) {
      message += ` (page ${progress.currentPage}/${progress.totalPages})`;
    }
    
    if (progress.message) {
      message += ` - ${progress.message}`;
    }
    
    console.log(message);
  };
}

/**
 * Calculate percentage completion
 */
export function getPercentage(progress: ProgressInfo): number {
  if (progress.total === 0) return 0;
  return Math.round((progress.current / progress.total) * 100);
}

/**
 * Format progress as a percentage string
 */
export function formatProgress(progress: ProgressInfo): string {
  const percentage = getPercentage(progress);
  return `${progress.current}/${progress.total} (${percentage}%)`;
}
