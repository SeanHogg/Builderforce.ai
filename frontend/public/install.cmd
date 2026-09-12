@echo off
setlocal enabledelayedexpansion

REM BuilderForce Agents Windows CMD installer
REM Installs the @seanhogg/builderforce-agents npm package (the `builderforce` CLI)
REM by delegating to install.ps1.
REM Usage:
REM   curl -fsSL https://builderforce.ai/install.cmd -o install.cmd && install.cmd && del install.cmd

set "TAG=latest"
set "NO_START=0"
set "DRY_RUN=0"
set "TAG_SET=0"
set "INSTALL_PS1_URL="

:parse_args
if "%~1"=="" goto :args_done

if /i "%~1"=="--help" goto :usage
if /i "%~1"=="--no-start" set "NO_START=1"
REM --no-onboard is the older spelling of --no-start.
if /i "%~1"=="--no-onboard" set "NO_START=1"
if /i "%~1"=="--dry-run" set "DRY_RUN=1"
if /i "%~1"=="--git" echo --git is not supported by the Windows installer; installing from npm. 1>&2

if /i "%~1"=="--tag" (
  if not "%~2"=="" (
    set "TAG=%~2"
    set "TAG_SET=1"
    shift
  )
  shift
  goto :parse_args
)

set "ARG=%~1"
if not "%ARG%"=="" (
  if not "%ARG:~0,1%"=="-" (
    if "%TAG_SET%"=="0" (
      set "TAG=%ARG%"
      set "TAG_SET=1"
    )
  )
)

shift
goto :parse_args

:args_done

curl --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo curl is required but not available. Please install curl or use PowerShell installer. >&2
  exit /b 1
)

powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major" >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo PowerShell is required but not available. Use install.ps1 directly or install PowerShell. >&2
  exit /b 1
)

set "TMP=%TEMP%\builderforce-install.ps1"
REM TMP may include spaces; always quote "%TMP%" when used.
if not "%CODERCLAW_INSTALL_PS1_URL%"=="" set "INSTALL_PS1_URL=%CODERCLAW_INSTALL_PS1_URL%"
if "%INSTALL_PS1_URL%"=="" set "INSTALL_PS1_URL=https://builderforce.ai/install.ps1"

if exist "%INSTALL_PS1_URL%" (
  copy /Y "%INSTALL_PS1_URL%" "%TMP%" >nul
) else (
  curl -fsSL "%INSTALL_PS1_URL%" -o "%TMP%"
)
if %ERRORLEVEL% neq 0 (
  echo Failed to download install.ps1 >&2
  exit /b 1
)

REM install.ps1 accepts -Tag, -ApiUrl and -NoStart.
set "PS_ARGS=-Tag ""%TAG%"""
if "%NO_START%"=="1" set "PS_ARGS=%PS_ARGS% -NoStart"

if "%DRY_RUN%"=="1" (
  echo [OK] Dry run: would run install.ps1 %PS_ARGS%
  del /f "%TMP%" >nul 2>&1
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP%" %PS_ARGS%
set "RESULT=%ERRORLEVEL%"

del /f "%TMP%" >nul 2>&1

if %RESULT% neq 0 exit /b %RESULT%
exit /b 0

:usage
echo Usage: install.cmd [options] [tag]
echo.
echo Installs @seanhogg/builderforce-agents ^(the builderforce CLI^) via npm.
echo.
echo Options:
echo   --tag ^<ver^>       npm dist-tag or version to install ^(default: latest^)
echo   --no-start        Install ^(and register, when BUILDERFORCE_TOKEN is set^) without starting the gateway
echo   --dry-run         Print what would happen ^(no changes^)
exit /b 0
