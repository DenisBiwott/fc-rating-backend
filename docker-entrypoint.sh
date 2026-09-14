#!/bin/sh
set -e

node dist/scripts/migrate.js
exec node dist/src/server.js
