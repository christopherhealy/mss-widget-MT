#!/usr/bin/env bash
set -euo pipefail

# Simple helper to show status, commit, and push to main.

echo "👉 Current Git status:"
git status
echo

# If you pass a commit message as arguments, use that.
# Otherwise, ask for one.
if [ "$#" -gt 0 ]; then
  msg="$*"
else
  read -rp "Commit message: " msg
fi

if [ -z "$msg" ]; then
  echo "❌ No commit message given, aborting."
  exit 1
fi

echo
echo "➕ Adding all changes…"
git add .

echo "💾 Committing with message: $msg"
git commit -m "$msg"

echo "🚀 Pushing to origin/main…"
git push origin main

echo "✅ Done. Render will auto-deploy on push."