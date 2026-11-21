#!/bin/sh
# The demo's way in: on an empty data directory, the account and what is in it first; then
# taskio, as the image it is built on would run it.
set -eu

if [ "${1:-serve}" = serve ] && [ ! -e "${TASKIO_DATA_DIR:-/data}/taskio.db" ]; then
  node /demo/setup.mjs
fi

[ "$#" -gt 0 ] || set -- serve
exec taskio "$@"
