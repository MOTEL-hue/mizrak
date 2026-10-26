#!/usr/bin/env bash
# מעתיק את קוד התקציב מהאתר (ענף main של virtual-chat) לתוכנה, בודק שהוא תקין, ומראה מה השתנה.
# שימוש: scripts/sync-budget-from-site.sh /נתיב/ל/virtual-chat
set -euo pipefail
site="${1:?נתיב לשכפול של virtual-chat}"
dest="$(cd "$(dirname "$0")/.." && pwd)/packages/renderer/public/budget"
git -C "$site" fetch -q origin main
src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT
for f in budget.js budget.css; do
  git -C "$site" show "origin/main:budget/static/budget/$f" > "$src/$f"
done
node --check "$src/budget.js"
echo "גרסת האתר: $(git -C "$site" log -1 --format='%h %s' origin/main)"
for f in budget.js budget.css; do
  if cmp -s "$src/$f" "$dest/$f"; then echo "$f: ללא שינוי"; else cp "$src/$f" "$dest/$f"; echo "$f: עודכן"; fi
done
