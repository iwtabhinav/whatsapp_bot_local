@echo off
REM Cross-platform test script for PM2 restart functionality
REM This script detects the OS and runs appropriate commands

echo 🧪 Testing PM2 restart functionality...
echo ======================================

echo 🖥️  Detected OS: Windows

REM Check if PM2 is available
echo 📊 Checking PM2 availability...
pm2 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ PM2 is available
    pm2 --version
) else (
    echo ❌ PM2 not found
    echo 💡 Try: npm install -g pm2
    pause
    exit /b 1
)

echo.

REM Check current PM2 processes
echo 📊 Current PM2 processes:
pm2 list

echo.

REM Check for WhatsApp processes
echo 📱 Looking for WhatsApp processes...
pm2 jlist

echo.

REM Test restart command
echo 🔄 Testing PM2 restart...
echo Attempting to restart whatsapp_api...

REM Try different restart strategies
echo Strategy 1: pm2 restart whatsapp_api
pm2 restart whatsapp_api 2>&1

if %errorlevel% neq 0 (
    echo Strategy 2: pm2 start whatsapp_api
    pm2 start whatsapp_api 2>&1
    
    if %errorlevel% neq 0 (
        echo Strategy 3: pm2 start ecosystem-whatsapp.config.js
        pm2 start ecosystem-whatsapp.config.js 2>&1
        
        if %errorlevel% neq 0 (
            echo Strategy 4: pm2 start start-fixed-bot.js --name whatsapp_api
            pm2 start start-fixed-bot.js --name whatsapp_api 2>&1
        )
    )
)

echo.

REM Wait a moment and check status
echo ⏳ Waiting for process to start...
timeout /t 5 /nobreak >nul

echo 📊 Final PM2 status:
pm2 list

echo.

REM Check if process is running
echo 📱 WhatsApp process status:
pm2 jlist

echo.
echo ✅ Test completed!
echo.
echo 💡 If the process is not running, check:
echo    - PM2 logs: pm2 logs whatsapp_api
echo    - Bot script exists: dir start-fixed-bot.js
echo    - Ecosystem file exists: dir ecosystem-whatsapp.config.js

pause
