FROM node:24-slim AS base

ARG PNPM_VERSION=11.19.0
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /usr/src/app

# npm is used only as the pinned package-manager bootstrap supplied by the
# official Node image. Project dependency resolution is exclusively pnpm.
RUN npm install --global "pnpm@${PNPM_VERSION}"

FROM base AS build
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN \
    pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts eslint.config.js index.html ./
COPY resources ./resources
COPY src ./src

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV LOCAL_ONLY=true
RUN pnpm build:local

FROM base AS prod-deps
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN \
    pnpm install --prod --frozen-lockfile --ignore-scripts

FROM base AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl nginx supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY generate-nginx-upstream.sh /usr/local/bin/generate-nginx-upstream.sh
COPY docker-start.sh /usr/local/bin/docker-start.sh

COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=build /usr/src/app/static ./static
# TSX resolves these three JSON module imports at server startup. Browser
# assets live only in the fail-closed, content-hashed static artifact above.
COPY resources/QuickChat.json resources/countries.json resources/tribeNameThemes.json ./resources/
COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p data /tmp/front-wars-nginx/cache/static \
      /tmp/front-wars-nginx/cache/api \
      /tmp/front-wars-nginx/conf.d \
      /tmp/front-wars-nginx/body \
      /tmp/front-wars-nginx/proxy \
      /tmp/front-wars-nginx/fastcgi \
      /tmp/front-wars-nginx/uwsgi \
      /tmp/front-wars-nginx/scgi \
    && chown -R node:node /usr/src/app /tmp/front-wars-nginx \
    && chmod +x /usr/local/bin/generate-nginx-upstream.sh /usr/local/bin/docker-start.sh

ARG GIT_COMMIT=unknown
RUN printf '%s\n' "$GIT_COMMIT" > static/commit.txt \
    && chown node:node static/commit.txt

ENV GIT_COMMIT=$GIT_COMMIT
ENV LOCAL_ONLY=true
ENV GAME_ENV=dev
ENV DOMAIN=localhost
ENV NUM_WORKERS=1
ENV TURNSTILE_SITE_KEY=1x00000000000000000000AA
# Canonical admitted topology: client -> rootless nginx -> Express. Hosted
# Traefik deployment is release-gated and must choose its own reviewed value.
ENV TRUST_PROXY_HOPS=1

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-start.sh"]
