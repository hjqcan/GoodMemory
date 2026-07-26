FROM docker.io/oven/bun:1.3.11-slim@sha256:49a1dfafe49d774e0b75a17bd596d5a8e49231c1fab76d9a30b6fc690c30f30e AS bun

FROM docker.io/library/node:22.14.0-bookworm-slim@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de

RUN --mount=type=bind,from=bun,source=/usr/local/bin/bun,target=/tmp/bun \
    cp /tmp/bun /usr/local/bin/bun \
    && chmod 0755 /usr/local/bin/bun \
    && touch -d @0 /usr/local/bin/bun

WORKDIR /work
ENTRYPOINT []
