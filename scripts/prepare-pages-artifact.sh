#!/usr/bin/env bash
set -euo pipefail

readonly output_dir="_site"

mkdir -p "$output_dir"
rsync -a --delete --delete-excluded \
  --exclude '/_site/' \
  --exclude '/.git*' \
  --exclude '/AI-Skills/' \
  --exclude '*.md' \
  ./ "$output_dir/"

if [ ! -f "$output_dir/index.html" ]; then
  echo "::error title=Pages artifact invalid::index.html is missing from $output_dir"
  exit 1
fi

if find "$output_dir" -type f -name '*.md' -print -quit | grep -q .; then
  echo "::error title=Internal docs leaked::Markdown files must not be included in the Pages artifact"
  find "$output_dir" -type f -name '*.md' -print
  exit 1
fi

for forbidden in ".git" ".github" "AI-Skills"; do
  if [ -e "$output_dir/$forbidden" ]; then
    echo "::error title=Internal directory leaked::$forbidden must not be included in the Pages artifact"
    exit 1
  fi
done

echo "Public Pages artifact ready: $(find "$output_dir" -type f | wc -l | tr -d ' ') files"
