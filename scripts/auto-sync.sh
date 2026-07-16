#!/bin/bash
# Keeps every machine working on this repo in sync via GitHub.
# Called by Claude Code hooks (.claude/settings.json):
#   auto-sync.sh start  → SessionStart: pull latest before work begins
#   auto-sync.sh stop   → Stop: commit + pull + push after every Claude turn
# Design: being offline is never an error (sync catches up next time);
# a real conflict is reported to Claude so it gets resolved in-session.

INPUT=$(cat 2>/dev/null)
MODE="${1:-stop}"

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Self-setup on any new machine: commits need an identity
git config user.name  >/dev/null 2>&1 || git config user.name  "Ashaeiyn Foundation"
git config user.email >/dev/null 2>&1 || git config user.email "ashaeiynhopein@gmail.com"

# Commit local work first so a rebase can never lose it
if [ -n "$(git status --porcelain)" ]; then
  git add -A && git commit -q -m "Auto-sync from $(hostname -s): $(date '+%Y-%m-%d %H:%M')"
fi

git fetch -q origin 2>/dev/null || exit 0   # offline → catch up next run

if git pull --rebase -q origin main 2>/dev/null; then
  git push -q origin main 2>/dev/null
  exit 0
fi

# Both machines changed the same lines — hand the problem to Claude
git rebase --abort 2>/dev/null

RESOLVE_MSG="AUTO-SYNC CONFLICT in this repo: local commits and GitHub commits touch the same lines (both computers edited the same files). Resolve it now: run git pull --rebase, fix each conflicted file keeping BOTH sides of the work, git rebase --continue, then git push. For generated files (package-lock.json, data/knowledge.db) keep the newer side or regenerate."

if [ "$MODE" = "start" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$RESOLVE_MSG"
  exit 0
fi

# stop mode: exit 2 feeds the message back to Claude to fix immediately —
# unless a stop-hook retry is already in flight (prevents loops)
case "$INPUT" in
  *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0;;
esac
echo "$RESOLVE_MSG" >&2
exit 2
