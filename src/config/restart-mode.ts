const TSX_RUNNER_ARGUMENT = /^tsx$|node_modules[\\/]tsx[\\/]/;

/**
 * `npm run dev` runs the server under tsx, which does not start it again after process.exit(0).
 * A compiled `node dist/...` server is left to its process manager or container restart policy.
 */
export function restartNeedsManualStart(execArgv: readonly string[] = process.execArgv): boolean {
  return execArgv.some((argument) => TSX_RUNNER_ARGUMENT.test(argument));
}
