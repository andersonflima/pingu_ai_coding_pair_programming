#!/usr/bin/env bash
set -euo pipefail

service=${1:-pingu}
env=${2:-dev}

echo "deploying $service to $env"
echo "done"
