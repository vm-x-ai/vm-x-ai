#!/usr/bin/env bash

# Script to package Helm chart and generate index.yaml for GitHub Pages
# This can be run manually or as part of CI/CD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HELM_REPO_DIR="$REPO_ROOT/helm-repo"
CHART_DIR="$REPO_ROOT/helm/charts/vm-x-ai"
REPO_URL="https://vm-x-ai.github.io/open-vm-x-ai/helm/"

echo "📦 Packaging Helm chart..."
helm package "$CHART_DIR" -d "$HELM_REPO_DIR/"

echo "📝 Generating index.yaml..."
helm repo index "$HELM_REPO_DIR/" --url "$REPO_URL"

echo "✅ Helm repository files generated in: $HELM_REPO_DIR"
echo ""
echo "To publish to GitHub Pages:"
echo "1. If using 'gh-pages' branch:"
echo "   git checkout --orphan gh-pages"
echo "   git rm -rf ."
echo "   cp -r $HELM_REPO_DIR/* ."
echo "   git add ."
echo "   git commit -m 'Publish Helm chart'"
echo "   git push origin gh-pages"
echo ""
echo "2. If using 'docs' folder:"
echo "   mkdir -p docs/helm"
echo "   cp -r $HELM_REPO_DIR/* docs/helm/"
echo "   git add docs/helm"
echo "   git commit -m 'Publish Helm chart'"
echo "   git push"
echo ""
echo "3. If using GitHub Actions for Pages (recommended):"
echo "   Just push this commit and the workflow will handle it automatically"
echo ""
echo "Then configure GitHub Pages to serve from 'gh-pages' branch, '/docs' folder, or GitHub Actions"

