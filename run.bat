@echo off
echo ==========================================
echo   Bulk Email Harvester - Setup and Launch
echo ==========================================

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate

echo Installing Python dependencies...
pip install -q -r requirements.txt

echo Installing Playwright browsers (Chromium)...
python -m playwright install chromium

echo.
echo ==========================================
echo   Starting at http://127.0.0.1:5000
echo   A Chrome window will open for each site
echo   Press Ctrl+C to stop
echo ==========================================
echo.

python app.py
pause
