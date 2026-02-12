@echo off
REM Script to create a clean production package
REM This creates a zip file with only the necessary files for production

echo 📦 Creating production package...
echo ================================

set PACKAGE_NAME=whatsapp-bot-production-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set PACKAGE_NAME=%PACKAGE_NAME: =0%

echo 📁 Package name: %PACKAGE_NAME%

REM Create temporary directory
if exist "temp-production" rmdir /s /q "temp-production"
mkdir "temp-production"

echo 📋 Copying essential files...

REM Core application files
copy "start-ai-bot.js" "temp-production\"
copy "package.json" "temp-production\"
copy "README.md" "temp-production\"

REM Configuration files
copy "ecosystem.config.js" "temp-production\"
copy "env.production" "temp-production\"
copy ".gitignore" "temp-production\"

REM Source directory
xcopy "src" "temp-production\src" /E /I /Q

REM Public directory
if exist "public" xcopy "public" "temp-production\public" /E /I /Q

REM Knowledge base
if exist "knowledge_base" xcopy "knowledge_base" "temp-production\knowledge_base" /E /I /Q

REM Library files
xcopy "lib" "temp-production\lib" /E /I /Q
xcopy "WAProto" "temp-production\WAProto" /E /I /Q
xcopy "WASignalGroup" "temp-production\WASignalGroup" /E /I /Q

REM Documentation
copy "*.md" "temp-production\"

REM Deployment scripts
copy "production-deploy.sh" "temp-production\"
copy "production-deploy.bat" "temp-production\"
copy "clean-production-files.bat" "temp-production\"

REM Create fresh directories
mkdir "temp-production\data\whatsapp-session"
mkdir "temp-production\logs"
mkdir "temp-production\media-files"

echo ✅ Files copied successfully!

REM Create zip file
echo 📦 Creating zip package...
powershell -Command "Compress-Archive -Path 'temp-production\*' -DestinationPath '%PACKAGE_NAME%.zip' -Force"

if %errorlevel% equ 0 (
    echo ✅ Production package created: %PACKAGE_NAME%.zip
    echo.
    echo 📋 Package contents:
    echo    ✅ Core application files
    echo    ✅ Source code
    echo    ✅ Configuration files
    echo    ✅ Documentation
    echo    ✅ Fresh session directory
    echo    ✅ Fresh logs directory
    echo    ✅ Deployment scripts
    echo.
    echo 🚀 Ready for production deployment!
    echo.
    echo 📤 Next steps:
    echo 1. Upload %PACKAGE_NAME%.zip to your server
    echo 2. Extract the package
    echo 3. Run production-deploy.sh (Linux) or production-deploy.bat (Windows)
    echo 4. Configure your .env file with actual API keys
    echo 5. Start the bot with PM2
) else (
    echo ❌ Failed to create zip package
)

REM Clean up temporary directory
rmdir /s /q "temp-production"

echo.
echo 🎉 Production package creation completed!

pause
