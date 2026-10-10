#!/bin/sh
# generate-nginx-upstream.sh
#
# Generates the per-worker nginx config from NUM_WORKERS at container start
# (NUM_WORKERS arrives via the runtime env file and is not known when the image
# is built, so it can't be baked into nginx.conf). Emits two things, both in the
# http context, into a single conf.d file:
#
#   1. upstream openfront_workers  - random-balanced across the live workers, so
#      nginx can spread requests (e.g. POST /api/create_game) without the caller
#      knowing the worker count.
#   2. map $worker $worker_port    - worker index -> port (3001 + index), so the
#      /wN/ locations route without a hand-maintained if-ladder.
#
# Usage: generate-nginx-upstream.sh [output_path]
set -eu

OUT="${1:-/tmp/front-wars-nginx/conf.d/00-workers.conf}"
n="${NUM_WORKERS:-1}"

case "$n" in
    '' | *[!0-9]*)
        echo "NUM_WORKERS must be a positive integer" >&2
        exit 1
        ;;
esac
if [ "$n" -lt 1 ] || [ "$n" -gt 64 ]; then
    echo "NUM_WORKERS must be between 1 and 64" >&2
    exit 1
fi

{
    echo 'upstream openfront_workers {'
    echo '    random;'
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    server 127.0.0.1:$((3001 + i));"
        i=$((i + 1))
    done
    echo '}'
    echo ''
    echo 'map $worker $worker_port {'
    echo '    default 3001;'
    i=0
    while [ "$i" -lt "$n" ]; do
        echo "    $i $((3001 + i));"
        i=$((i + 1))
    done
    echo '}'
} > "$OUT"
