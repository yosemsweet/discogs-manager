#!/bin/bash
echo "📋 Testing Complete Discogs Manager Workflow"
echo "==========================================="
echo ""

echo "1️⃣  Testing list command..."
npm run dev -- list yosemsweet 2>&1 | head -15
echo ""

echo "2️⃣  Testing playlist creation with 3 rock records..."
npm run dev -- playlist -t "Rock Essentials" -d "A curated selection of rock favorites" --release-ids "25064110,11703605,186861" 2>&1 | grep -E "✔|✓|created|Playlist"
echo ""

echo "3️⃣  Testing stats command..."
npm run dev -- stats 2>&1 | head -10
echo ""

echo "✅ Workflow test complete!"
