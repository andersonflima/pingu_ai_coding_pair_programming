#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "--help" ]]; then
  echo "Usage: ./healthcheck.sh [URL]" 
  exit 0
fi

url="${1:-http://localhost:3000/health}"
status=$(curl -s -o /tmp/pingu_health.json -w '%{http_code}' "$url")

echo "Status: $status"
if [[ "$status" != "200" ]]; then
  echo "Healthcheck failed"
  exit 1
fi

echo "Response: $(cat /tmp/pingu_health.json)"
