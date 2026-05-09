/**
 * ABOUTME: Auto-commit utility for committing changes after successful task completion.
 * Provides git operations to stage and commit changes when autoCommit is enabled.
 */

import { runProcess } from '../utils/process.js';

/**
 * Result of an auto-commit operation
 */
export interface AutoCommitResult {
  /** Whether a commit was actually created */
  committed: boolean;
  /** The commit message used (if committed) */
  commitMessage?: string;
  /** The short SHA of the created commit (if committed) */
  commitSha?: string;
  /** Reason commit was skipped (if not committed and no error) */
  skipReason?: string;
  /** Error message if the commit failed */
  error?: string;
}

function normalizeCommitTopic(branchName: string): string {
  const topic = branchName.split('/').at(-1)?.trim().toLowerCase() ?? '';
  if (!topic || topic === 'head') {
    return 'task';
  }

  const normalized = topic
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return normalized || 'task';
}

function extractTaskSequence(taskId: string): string {
  const match = taskId.match(/(\d+)(?!.*\d)/);
  if (match?.[1]) {
    return match[1];
  }

  const fallback = taskId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return fallback || 'task';
}

/**
 * Build a commit subject from the branch topic and task identity.
 */
export function buildTaskCommitMessage(
  branchName: string,
  taskId: string,
  taskTitle: string,
): string {
  return `(${normalizeCommitTopic(branchName)}-${extractTaskSequence(taskId)}): ${taskTitle}`;
}

/**
 * Check if there are uncommitted changes in the working directory.
 * Throws if git status cannot be determined (not a git repo, git not installed, etc.).
 */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const result = await runProcess('git', ['status', '--porcelain'], { cwd });
  if (!result.success) {
    throw new Error(`git status failed: ${result.stderr.trim() || 'unknown error (exit code ' + result.exitCode + ')'}`);
  }
  return result.stdout.trim().length > 0;
}

/**
 * Stage all changes and create a commit with a branch-scoped message format.
 * Returns the result of the operation including commit SHA on success.
 */
export async function performAutoCommit(
  cwd: string,
  taskId: string,
  taskTitle: string
): Promise<AutoCommitResult> {
  // Check for uncommitted changes first
  let hasChanges: boolean;
  try {
    hasChanges = await hasUncommittedChanges(cwd);
  } catch (err) {
    return {
      committed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!hasChanges) {
    return {
      committed: false,
      skipReason: 'no uncommitted changes',
    };
  }

  // Stage all changes
  const addResult = await runProcess('git', ['add', '-A'], { cwd });
  if (!addResult.success) {
    return {
      committed: false,
      error: `git add failed: ${addResult.stderr.trim() || 'unknown error'}`,
    };
  }

  const branchResult = await runProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
  });
  if (!branchResult.success) {
    return {
      committed: false,
      error: `git branch lookup failed: ${branchResult.stderr.trim() || 'unknown error'}`,
    };
  }

  const commitMessage = buildTaskCommitMessage(
    branchResult.stdout.trim(),
    taskId,
    taskTitle,
  );
  const commitResult = await runProcess(
    'git',
    ['commit', '-m', commitMessage],
    { cwd }
  );
  if (!commitResult.success) {
    return {
      committed: false,
      error: `git commit failed: ${commitResult.stderr.trim() || 'unknown error'}`,
    };
  }

  // Get the short SHA of the new commit
  const shaResult = await runProcess(
    'git',
    ['rev-parse', '--short', 'HEAD'],
    { cwd }
  );
  const commitSha = shaResult.success ? shaResult.stdout.trim() : undefined;

  return {
    committed: true,
    commitMessage,
    commitSha,
  };
}
