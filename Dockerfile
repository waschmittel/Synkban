FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM rust:1.95-bookworm AS backend-build
WORKDIR /app/backend
COPY backend/Cargo.toml backend/Cargo.lock* ./
COPY backend/src ./src
COPY --from=frontend-build /app/frontend/dist ./static
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY --from=backend-build /app/backend/target/release/synkban ./synkban

ENV DATA_DIR="./data"
ENV HOST="0.0.0.0"
ENV PORT="8080"
EXPOSE 8080

VOLUME /app/data

CMD ["./synkban"]
