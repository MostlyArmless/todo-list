#!/bin/bash
#
# Generate README screenshots and scroll GIFs
#
# This script:
# 1. Seeds/refreshes demo data
# 2. Runs Playwright to capture screenshots and scroll videos
# 3. Converts scroll videos to GIFs with ffmpeg
# 4. Updates README.md to reference GIFs where appropriate
#
# Usage: ./scripts/generate-readme-media.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$ROOT_DIR/web"
IMAGES_DIR="$ROOT_DIR/docs/images"
VIDEOS_DIR="$ROOT_DIR/docs/videos-tmp"
README="$ROOT_DIR/README.md"

echo "=== README Media Generation ==="
echo ""

# Check dependencies
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is required but not installed"
    exit 1
fi

# Step 1: Seed demo data
echo "Step 1: Seeding demo data..."
cd "$ROOT_DIR"
uv run python scripts/seed_demo_data.py
echo ""

# Step 2: Run Playwright test
echo "Step 2: Capturing screenshots and videos..."
cd "$WEB_DIR"
npx playwright test e2e/readme-media.spec.ts --project=mobile
echo ""

# Step 3: Convert videos to GIFs
echo "Step 3: Converting videos to GIFs..."
cd "$ROOT_DIR"

# Create palette for better GIF quality
for marker in "$VIDEOS_DIR"/*.needs-gif; do
    [ -f "$marker" ] || continue

    name=$(basename "$marker" .needs-gif)
    webm="$VIDEOS_DIR/$name.webm"
    gif="$IMAGES_DIR/$name.gif"
    palette="$VIDEOS_DIR/$name-palette.png"

    if [ -f "$webm" ]; then
        echo "  Converting $name.webm -> $name.gif"

        # Two-pass encoding for good quality GIFs
        # Scale to 480px width, 10fps - balances quality and file size
        ffmpeg -y -i "$webm" \
            -vf "fps=10,scale=480:-1:flags=lanczos,palettegen=max_colors=192:stats_mode=diff" \
            "$palette" 2>/dev/null

        ffmpeg -y -i "$webm" -i "$palette" \
            -lavfi "fps=10,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
            "$gif" 2>/dev/null

        # Clean up
        rm -f "$webm" "$palette" "$marker"

        # Get file sizes for comparison
        jpg="$IMAGES_DIR/$name.jpg"
        if [ -f "$jpg" ] && [ -f "$gif" ]; then
            jpg_size=$(stat -f%z "$jpg" 2>/dev/null || stat -c%s "$jpg")
            gif_size=$(stat -f%z "$gif" 2>/dev/null || stat -c%s "$gif")
            echo "    JPG: $(numfmt --to=iec $jpg_size), GIF: $(numfmt --to=iec $gif_size)"
        fi
    fi
done

# Clean up empty video dir
rmdir "$VIDEOS_DIR" 2>/dev/null || true

echo ""
echo "=== Done! ==="
echo ""
echo "Generated media in $IMAGES_DIR:"
ls -lh "$IMAGES_DIR"/*-mobile.* 2>/dev/null | awk '{print "  " $NF ": " $5}'
