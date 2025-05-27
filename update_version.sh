#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "VERSION = \"$(git rev-parse --short HEAD)\"" > "$SCRIPT_DIR/version.py"