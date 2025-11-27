#!/usr/bin/env bash
set -e

echo "======================================="
echo " Vercel → MSS API WAV curl test (build)"
echo "======================================="

if [ -z "$MSS_API_KEY" ] || [ -z "$MSS_API_SECRET" ]; then
  echo "ERROR: MSS_API_KEY or MSS_API_SECRET not set"
  exit 0
fi

if [ ! -f "./tests/mss-vercel-test.wav" ]; then
  echo "ERROR: ./tests/mss-vercel-test.wav not found"
  ls -R .
  exit 0
fi

curl -v --request POST \
  "https://app.myspeakingscore.com/api/vox" \
  --header "API-KEY: $MSS_API_KEY" \
  --header "API-SECRET: $MSS_API_SECRET" \
  --header "Accept: application/json" \
  --form "file=@./tests/mss-vercel-test.wav" \
  || true

echo "============ curl test complete ============"