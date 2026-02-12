@echo off
REM PM2 Service Monitor - Windows Batch Version
REM This script monitors the whatsapp_api service and restarts it if needed
REM Designed to run as a scheduled task or background process

REM Configuration
set PROJECT_ROOT=C:\Users\user\reactProject\whatsapp-bot\bot-production-new\bot-test
set PROCESS_NAME=whatsapp_api
set LOG_FILE=%PROJECT_ROOT%\logs\pm2-monitor.log
set CHECK_INTERVAL=30

REM Create logs directory if it doesn't exist
if not exist "%PROJECT_ROOT%\logs" mkdir "%PROJECT_ROOT%\logs"

REM Logging function
:log
set message=%1
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YY=%dt:~2,2%" & set "YYYY=%dt:~0,4%" & set "MM=%dt:~4,2%" & set "DD=%dt:~6,2%"
set "HH=%dt:~8,2%" & set "Min=%dt:~10,2%" & set "Sec=%dt:~12,2%"
set "timestamp=%YYYY%-%MM%-%DD% %HH%:%Min%:%Sec%"
echo [%timestamp%] %message% | tee -a "%LOG_FILE%"
goto :eof

REM Check PM2 status
:check_pm2_status
cd /d "%PROJECT_ROOT%"
pm2 jlist | jq -r ".[] | select(.name==\"%PROCESS_NAME%\") | .pm2_env.status" 2>nul
goto :eof

REM Start service
:start_service
call :log "🔄 Starting %PROCESS_NAME% service..."
cd /d "%PROJECT_ROOT%"

REM Try ecosystem file first
pm2 start ecosystem-whatsapp.config.js >> "%LOG_FILE%" 2>&1
if %errorlevel% equ 0 (
    call :log "✅ Service started with ecosystem file"
    goto :eof
) else (
    call :log "⚠️ Ecosystem start failed, trying direct script..."
    
    REM Try direct script
    pm2 start start-fixed-bot.js --name "%PROCESS_NAME%" >> "%LOG_FILE%" 2>&1
    if %errorlevel% equ 0 (
        call :log "✅ Service started with direct script"
        goto :eof
    ) else (
        call :log "❌ Direct script start also failed"
        exit /b 1
    )
)
goto :eof

REM Stop service
:stop_service
call :log "⏹️ Stopping %PROCESS_NAME% service..."
cd /d "%PROJECT_ROOT%"

pm2 stop "%PROCESS_NAME%" >> "%LOG_FILE%" 2>&1
timeout /t 3 /nobreak >nul
pm2 delete "%PROCESS_NAME%" >> "%LOG_FILE%" 2>&1
call :log "✅ Service stopped and deleted"
goto :eof

REM Restart service
:restart_service
call :log "🔄 Restarting %PROCESS_NAME% service..."
call :stop_service
timeout /t 5 /nobreak >nul
call :start_service
goto :eof

REM Monitor function
:monitor
call :log "🚀 PM2 Monitor started for %PROCESS_NAME%"
call :log "📁 Project root: %PROJECT_ROOT%"
call :log "⏰ Check interval: %CHECK_INTERVAL%s"
call :log "📝 Log file: %LOG_FILE%"

:monitor_loop
call :check_pm2_status
set status=%errorlevel%

if "%status%"=="0" (
    call :log "✅ Service %PROCESS_NAME% is online"
) else (
    call :log "⚠️ Service %PROCESS_NAME% not found or stopped, starting..."
    call :start_service
)

timeout /t %CHECK_INTERVAL% /nobreak >nul
goto :monitor_loop

REM Start monitoring
call :monitor
