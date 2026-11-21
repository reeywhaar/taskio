# A taskio to try: on its first start, an account, demo / demodemo, with projects, groups and
# tasks in it, some of them weeks old. Every start after that is taskio as it was left.
#
# On top of the image the root Dockerfile makes, from the root of the repository:
#
#   docker build -t taskio:dev .
#   docker build -f demo/Dockerfile --build-arg BASE=taskio:dev -t taskio-demo:dev .
#
# scripts/run_dev.sh does both and runs it.
ARG BASE=ghcr.io/reeywhaar/taskio:latest
FROM ${BASE}

# Node for the seed, which is the same script anybody can point at their own taskio, and
# sqlite3 for the ages the API cannot set.
RUN apk add --no-cache nodejs sqlite

COPY scripts/seed.mjs demo/setup.mjs demo/start.sh /demo/

ENTRYPOINT ["/demo/start.sh"]
CMD ["serve"]
