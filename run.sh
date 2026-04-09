#!/bin/bash
set -e

echo "=========================================="
echo "  Bulk Email Harvester - Setup & Launch"
echo "=========================================="

# Create virtual environment if needed
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate

echo "Installing Python dependencies..."
pip install -q -r requirements.txt

echo "Installing Playwright browsers (Chromium)..."
python -m playwright install chromium

echo ""
echo "=========================================="
echo "  Starting at http://127.0.0.1:5000"
echo "  A Chrome window will open for each site"
echo "  Press Ctrl+C to stop"
echo "=========================================="
echo ""

python app.py
