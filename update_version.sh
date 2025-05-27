#!/bin/sh
echo "VERSION = \"$(git rev-parse --short HEAD)\"" > version.py