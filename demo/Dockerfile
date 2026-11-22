# A taskio to try: on its first start, an account, demo / demodemo, with projects, groups and
# tasks in it, some of them weeks old. Every start after that is taskio as it was left.
#
# Takes taskio from the image the root Dockerfile makes, from the root of the repository:
#
#   docker build -t taskio:dev .
#   docker build -f demo/Dockerfile --build-arg BASE=taskio:dev -t taskio-demo:dev .
#
# scripts/run_dev.sh does both and runs it.
ARG BASE=ghcr.io/reeywhaar/taskio:latest
FROM ${BASE} AS app

# The same ground as the root image's, with node and sqlite on it before taskio rather than
# after. On top of taskio, every change to it threw the install away and fetched both again on
# every run; here it is a layer of its own, and taskio is copied in after.
FROM alpine:latest
# Node for the seed, which is the same script anybody can point at their own taskio, and
# sqlite3 for the ages the API cannot set. Certificates, as the root image has them.
RUN apk add --no-cache ca-certificates nodejs sqlite

COPY --from=app /usr/local/bin/taskio /usr/local/bin/taskio
COPY --from=app /srv/web /srv/web
COPY --from=app /srv/docs /srv/docs
COPY scripts/seed.mjs demo/setup.mjs demo/start.sh /demo/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["taskio", "healthcheck"]
ENTRYPOINT ["/demo/start.sh"]
CMD ["serve"]
