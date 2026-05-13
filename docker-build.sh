#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${1:-tc-trello}"
TAG="${2:-latest}"

echo "=== Building Docker image: ${IMAGE_NAME}:${TAG} ==="
docker build -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "=== Done ==="
echo "Run with:"
echo "  docker run -p 8080:8080 ${IMAGE_NAME}:${TAG}"
echo ""
echo "With persistent data:"
echo "  docker run -p 8080:8080 -v tc-data:/app ${IMAGE_NAME}:${TAG}"
