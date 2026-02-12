@echo off
REM Setup PM2 Monitor as Windows Scheduled Task
REM This script sets up the PM2 monitor to run automatically via Windows Task Scheduler

set PROJECT_ROOT=C:\Users\user\reactProject\whatsapp-bot\bot-production-new\bot-test
set MONITOR_SCRIPT=%PROJECT_ROOT%\pm2-monitor.bat
set TASK_NAME=PM2Monitor
set TASK_DESCRIPTION=PM2 Service Monitor for WhatsApp Bot

echo 🔧 Setting up PM2 Monitor as Windows scheduled task...

REM Create logs directory
if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

REM Create scheduled task
schtasks /create /tn "%TASK_NAME%" /tr "%MONITOR_SCRIPT%" /sc minute /mo 1 /ru "SYSTEM" /f

if %errorlevel% equ 0 (
    echo ✅ Scheduled task created successfully!
    echo 📝 Task name: %TASK_NAME%
    echo 📝 Description: %TASK_DESCRIPTION%
    echo 📝 Runs every minute
    echo.
    echo 🔍 To check the task:
    echo schtasks /query /tn "%TASK_NAME%"
    echo.
    echo 🚀 To start the task:
    echo schtasks /run /tn "%TASK_NAME%"
    echo.
    echo 🛑 To stop the task:
    echo schtasks /end /tn "%TASK_NAME%"
    echo.
    echo 📊 To view monitor logs:
    echo type "%PROJECT_ROOT%\logs\pm2-monitor.log"
) else (
    echo ❌ Failed to create scheduled task
    echo 📝 You may need to run as administrator
)

echo.
echo ✅ Setup complete!
echo 📝 The monitor will run every minute and restart the service if needed
pause
