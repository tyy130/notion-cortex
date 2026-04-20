# Archive Notes

This repository is archived locally as a record of the Notion Cortex challenge project.

## Status
- Active development has stopped.
- The local working tree was intentionally pared down after the contest period.
- README/docs/dist artifacts remain for reference, but the local checkout should not be treated as a guaranteed runnable source tree.

## If revisiting later
1. Decide whether to restore the deleted source files from git history.
2. Rebuild from a clean checkout instead of trusting leftover local artifacts.
3. Remove stale generated files and logs before resuming development.

## Local cleanup notes
- `firebase-debug.log` is disposable runtime noise.
- `node_modules/` and `dist/` are build artifacts, not archival source of truth.
