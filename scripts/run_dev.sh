#!/usr/bin/env bash
# Builds taskio from the working tree, the demo on top of it, and runs that on
# http://taskio.localhost:3009 (PORT to change it). Sign in as demo / demodemo.
#
# The data stays in private/demo_data between runs. Delete the folder for a fresh demo.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT=${PORT:-3009}
NAME=taskio-demo
DATA=$PWD/private/demo_data

# Mounted rather than left to docker: taskio refuses to start without it.
mkdir -p "$DATA"

docker build -t taskio:dev .
docker build -f demo/Dockerfile --build-arg BASE=taskio:dev -t taskio-demo:dev .

docker rm -f "$NAME" > /dev/null 2>&1 || true

exec docker run --rm -it \
  --name "$NAME" \
  -p "$PORT:80" \
  -v "$DATA:/data" \
  -e TASKIO_PUBLIC_URL="http://taskio.localhost:$PORT" \
  taskio-demo:dev "$@"
