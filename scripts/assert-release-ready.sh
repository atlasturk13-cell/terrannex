#!/bin/sh
set -eu

echo "Release and deployment are disabled while BLOCKERS.md contains unresolved redistribution provenance." >&2
echo "Resolve the blocker, complete an independent release review, then replace this gate in a dedicated publication change." >&2
exit 64
