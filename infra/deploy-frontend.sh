#!/usr/bin/env bash
# Deploys the static frontend (index.html, common.css, robots.txt, js/, staticwebapp.config.json)
# to the Azure Static Web App. Run from the repo root.
#
# Why a staging folder: the SWA CLI refuses to deploy a directory that contains (or sits inside)
# an "api" folder alongside the content — the repo root has api/, infra/, .git/ etc. that must
# never be published, so this script copies only the public frontend files elsewhere first.
#
# Requires: the SWA CLI installed with --ignore-scripts (its optional keytar dependency needs a
# native build toolchain not available in every environment; --ignore-scripts skips it and the
# token-based deploy flow never touches keytar anyway):
#   npm install -g --ignore-scripts @azure/static-web-apps-cli

set -euo pipefail

STATIC_WEB_APP_NAME="swa-portal-ramilevystock"
RESOURCE_GROUP="rg-portal-ramilevystock"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

cp "$REPO_ROOT/index.html" "$REPO_ROOT/common.css" "$REPO_ROOT/robots.txt" \
   "$REPO_ROOT/staticwebapp.config.json" "$STAGE_DIR/"
cp -r "$REPO_ROOT/js" "$STAGE_DIR/"

DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --name "$STATIC_WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" --query "properties.apiKey" -o tsv)"

swa deploy "$STAGE_DIR" --deployment-token "$DEPLOYMENT_TOKEN" --env production
