FROM node:22-bookworm-slim AS frontend-build
ARG SYNKBAN_VERSION=dev
ENV SYNKBAN_VERSION=${SYNKBAN_VERSION}
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.100.0-bookworm AS backend-build
ARG SYNKBAN_VERSION=dev
ENV SYNKBAN_VERSION=${SYNKBAN_VERSION}
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock* ./
COPY backend/src ./src
COPY backend/fonts ./fonts
COPY backend/build.rs ./build.rs
COPY --from=frontend-build /app/frontend/src/schema.json /app/frontend/src/schema.json
COPY --from=frontend-build /app/frontend/dist ./static
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=backend-build /app/backend/target/release/synkban ./synkban
COPY LICENSE THIRD-PARTY-NOTICES.md ./
COPY backend/fonts/licenses ./licenses

RUN useradd -r -u 10001 app && mkdir -p /app/data /app/config && chown -R app /app
USER app

ENV DATA_DIR="/app/data"
ENV SYNKBAN_CONFIG_DIR="/app/config"
ENV HOST="0.0.0.0"
ENV PORT="8080"
EXPOSE 8080

VOLUME ["/app/data"]

ENTRYPOINT ["./synkban"]
