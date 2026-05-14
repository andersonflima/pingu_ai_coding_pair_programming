#!/usr/bin/env bash
set -euo pipefail

bash ./bin/healthcheck.sh --help
bash -n ./bin/healthcheck.sh
