#!/usr/bin/env bash

# === MSS Widget MT Git Workflow Script ===
# Usage: ./mss-git.sh "Your commit message here"
# If you don’t pass a message, it will prompt you.

set -e  # exit on first error

REPO="$HOME/Desktop/mss-widget-MT"

echo "📁 Moving to repo: $REPO"
cd "$REPO" || { echo "❌ Repo not found at $REPO"; exit 1; }

echo
echo "🔍 Current status:"
git status
echo

# Commit message: from argument or prompt
if [ -n "$1" ]; then
  COMMIT_MSG="$1"
else
  read -rp "✏️  Commit message (leave empty to skip commit): " COMMIT_MSG
fi

# Commit (optional)
if [ -n "$COMMIT_MSG" ]; then
  echo
  echo "➕ Staging all changes..."
  git add .

  if git diff --cached --quiet; then
    echo "ℹ️  No changes staged; skipping commit."
  else
    echo "💾 Committing with message: \"$COMMIT_MSG\""
    git commit -m "$COMMIT_MSG"
  fi
else
  echo "⏭  Skipping commit step."
fi

echo
echo "📥 Pulling latest from origin/main with rebase..."
git pull --rebase origin main || {
  echo "⚠️  Pull/rebase failed. You may need to resolve conflicts manually."
  exit 1
}

echo
echo "📤 Pushing to origin/main..."
git push origin main || {
  echo "⚠️  Push failed. Try 'git push origin main --force' if you're sure."
  exit 1
}

echo
echo "✅ Done. Current status:"
git status