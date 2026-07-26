FROM goodmemory-c6-canary-bun-base:420f9c50e115 AS bun-runtime
FROM goodmemory-c6-canary-git-base:aadc030db762
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
ENTRYPOINT ["/usr/local/bin/bun"]
