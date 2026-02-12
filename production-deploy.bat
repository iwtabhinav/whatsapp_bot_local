@echo off
REM WhatsApp AI Bot Production Deployment Script for Windows
REM For WHM/cPanel with PM2

echo 🚀 Starting WhatsApp AI Bot Production Deployment...
echo ==================================================

REM Configuration
set PRODUCTION_IP=localhost
set PRODUCTION_PORT=4001
set MONGODB_URI=mongodb://root:redhat-bc-12323@127.0.0.1:27017/db01?directConnection=true&serverSelectionTimeoutMS=2000&authSource=db01
set MONGODB_DB_NAME=db01

echo 📋 Production Configuration:
echo    IP: %PRODUCTION_IP%
echo    Port: %PRODUCTION_PORT%
echo    MongoDB: %MONGODB_DB_NAME%
echo.

REM Check if PM2 is installed
pm2 --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ PM2 is not installed. Installing PM2...
    npm install -g pm2
    if %errorlevel% neq 0 (
        echo ❌ Failed to install PM2. Please install manually.
        exit /b 1
    )
    echo ✅ PM2 installed successfully
)

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    exit /b 1
)

echo ✅ Node.js version: 
node --version

REM Create necessary directories
echo 📁 Creating necessary directories...
if not exist "data\whatsapp-session" mkdir "data\whatsapp-session"
if not exist "logs" mkdir "logs"
if not exist "media-files" mkdir "media-files"

echo ✅ Directories created

REM Install dependencies
echo 📦 Installing dependencies...
npm install --production
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    exit /b 1
)
echo ✅ Dependencies installed

REM Stop existing PM2 processes
echo 🛑 Stopping existing processes...
pm2 stop whatsapp-ai-bot >nul 2>&1
pm2 delete whatsapp-ai-bot >nul 2>&1

REM Update ecosystem.config.js with current directory
set CURRENT_DIR=%CD%
powershell -Command "(Get-Content ecosystem.config.js) -replace '/path/to/your/bot/directory', '%CURRENT_DIR%' | Set-Content ecosystem.config.js"

REM Start the application with PM2
echo 🚀 Starting WhatsApp AI Bot with PM2...
pm2 start ecosystem.config.js

if %errorlevel% equ 0 (
    echo ✅ WhatsApp AI Bot started successfully!
    echo.
    echo 📱 Next Steps:
    echo 1. Check the QR code: pm2 logs whatsapp-ai-bot
    echo 2. Scan QR code with your WhatsApp to connect
    echo 3. Monitor status: pm2 status
    echo 4. View logs: pm2 logs whatsapp-ai-bot
    echo 5. Web dashboard: http://%PRODUCTION_IP%:%PRODUCTION_PORT%
    echo.
    echo 🔧 Useful PM2 Commands:
    echo    pm2 status                    - Check process status
    echo    pm2 logs whatsapp-ai-bot     - View logs
    echo    pm2 restart whatsapp-ai-bot  - Restart bot
    echo    pm2 stop whatsapp-ai-bot     - Stop bot
    echo    pm2 delete whatsapp-ai-bot   - Remove from PM2
    echo    pm2 monit                    - Monitor resources
    echo.
    echo 🎉 Deployment completed successfully!
) else (
    echo ❌ Failed to start WhatsApp AI Bot
    echo Check the logs: pm2 logs whatsapp-ai-bot
    exit /b 1
)

pause
