# The osrm-build service: OSRM's own image, with Node to run the job.
#
# One wake per cron tick (ops/osrm-build/railway.json): it exits within seconds
# unless the owner has approved a build on an Approval card, and when one is
# approved it builds the walking and cycling matrices over the GB extract and
# writes them to Postgres (apps/api/src/jobs/osrmBuild.js). Peak scratch disk is
# about 12 GB under /data; give the service the RAM osrm-extract wants for the
# GB extract (16 GB or more) while a build is approved, and stop or delete the
# service once it is done — production never runs a router.
FROM node:22-bookworm-slim AS node

FROM ghcr.io/project-osrm/osrm-backend:latest
# Node pinned from its official image rather than the distro's package, so the
# runtime is the one the workspace declares (>=20) whatever OSRM's base becomes.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace=apps/api --omit=dev --ignore-scripts
COPY apps/api/src apps/api/src
ENV EPIC_OSRM_DATA_DIR=/data NODE_ENV=production
ENTRYPOINT []
CMD ["node", "apps/api/src/jobs/osrmBuildMain.js"]
