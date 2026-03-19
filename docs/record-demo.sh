#!/bin/bash
# Records a terminal demo of Notion Cortex using asciinema
# Usage: bash docs/record-demo.sh

set -e

CAST_FILE="docs/demo.cast"
GIF_FILE="docs/demo.gif"

echo "Recording terminal demo to $CAST_FILE..."
echo "The orchestrator will run with --auto-approve."
echo ""

asciinema rec "$CAST_FILE" \
  --title "Notion Cortex Demo" \
  --cols 100 \
  --rows 30 \
  --command "npx tsx src/index.ts 'The future of AI-powered developer tools' --auto-approve"

echo ""
echo "Recording saved to $CAST_FILE"

# Convert to GIF if agg is available
if command -v agg &>/dev/null; then
  echo "Converting to GIF..."
  agg --speed 4 --theme monokai "$CAST_FILE" "$GIF_FILE"
  echo "GIF saved to $GIF_FILE"
else
  echo "Install agg to convert to GIF: https://github.com/asciinema/agg"
  echo "Or upload the .cast file to https://asciinema.org"
fi
