@echo off
REM Script to clean up files before production deployment
REM This removes all files that should NOT be deployed to production

echo 🧹 Cleaning up files for production deployment...
echo ================================================

echo 📁 Removing session data...
if exist "data\whatsapp-session" rmdir /s /q "data\whatsapp-session"
if exist "data\whatsapp-connection-state.json" del "data\whatsapp-connection-state.json"
if exist "data\whatsapp-qr.json" del "data\whatsapp-qr.json"
if exist "data\whatsapp-qr.png" del "data\whatsapp-qr.png"

echo 📁 Removing logs...
if exist "logs" rmdir /s /q "logs"

echo 📁 Removing node_modules...
if exist "node_modules" rmdir /s /q "node_modules"

echo 📁 Removing development files...
if exist "bot-latest-new.zip" del "bot-latest-new.zip"
if exist "test-*.js" del "test-*.js"
if exist "*-demo.js" del "*-demo.js"
if exist "simple-bot.js" del "simple-bot.js"
if exist "advanced-bot.js" del "advanced-bot.js"
if exist "robust-bot.js" del "robust-bot.js"
if exist "fixed-bot.js" del "fixed-bot.js"
if exist "ultra-robust-bot.js" del "ultra-robust-bot.js"
if exist "example.js" del "example.js"
if exist "features-demo.js" del "features-demo.js"
if exist "openai-chauffeur-bot-enhanced.js" del "openai-chauffeur-bot-enhanced.js"

echo 📁 Removing backup files...
if exist "*.backup" del "*.backup"
if exist "*.backup2" del "*.backup2"

echo 📁 Creating fresh directories...
if not exist "data\whatsapp-session" mkdir "data\whatsapp-session"
if not exist "logs" mkdir "logs"
if not exist "media-files" mkdir "media-files"

echo ✅ Cleanup completed!
echo.
echo 📋 Files ready for production deployment:
echo    ✅ Core application files
echo    ✅ Source code
echo    ✅ Configuration files
echo    ✅ Documentation
echo    ✅ Fresh session directory
echo    ✅ Fresh logs directory
echo.
echo 🚀 You can now create a production package!

pause
