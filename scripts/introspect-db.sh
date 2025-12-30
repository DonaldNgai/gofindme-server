#!/bin/bash
# Backup current schema before introspecting
echo "📦 Backing up current schema..."
cp prisma/schema.prisma prisma/schema.prisma.backup

echo "🔍 Introspecting database..."
pnpm db:pull

echo "✅ Done! Original schema backed up to prisma/schema.prisma.backup"
echo "📝 New schema is in prisma/schema.prisma"
