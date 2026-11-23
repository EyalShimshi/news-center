@echo off
setlocal
rem Builds ..\NewsCenter.exe from the C# sources in src\.
rem The C# compiler and WebView2 SDK are downloaded from nuget.org on first use
rem and cached in %LOCALAPPDATA%\NewsCenter\build-tools.

set "WEBVIEW2_VERSION=1.0.4314.35"
set "COMPILER_VERSION=5.12.0"
set "TOOLS=%LOCALAPPDATA%\NewsCenter\build-tools"
set "WV2=%TOOLS%\microsoft.web.webview2.%WEBVIEW2_VERSION%"
set "CSC=%TOOLS%\microsoft.net.compilers.toolset.%COMPILER_VERSION%\tasks\net472\csc.exe"
set "FX=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"

cd /d "%~dp0"
if not exist "%WV2%\lib\net462\Microsoft.Web.WebView2.Core.dll" (
  call :fetch microsoft.web.webview2 %WEBVIEW2_VERSION% || goto :failed
)
if not exist "%CSC%" (
  call :fetch microsoft.net.compilers.toolset %COMPILER_VERSION% || goto :failed
)

"%CSC%" /nologo /noconfig /target:winexe /platform:x64 /optimize+ /deterministic+ /langversion:latest /warnaserror+ ^
  /out:"..\NewsCenter.exe" /win32icon:NewsCenter.ico /win32manifest:app.manifest ^
  /reference:"%FX%\System.dll" ^
  /reference:"%FX%\System.Core.dll" ^
  /reference:"%FX%\System.Drawing.dll" ^
  /reference:"%FX%\System.Net.Http.dll" ^
  /reference:"%FX%\System.Web.Extensions.dll" ^
  /reference:"%FX%\System.Windows.Forms.dll" ^
  /reference:"%WV2%\lib\net462\Microsoft.Web.WebView2.Core.dll" ^
  /reference:"%WV2%\lib\net462\Microsoft.Web.WebView2.WinForms.dll" ^
  /resource:"%WV2%\lib\net462\Microsoft.Web.WebView2.Core.dll",lib.Microsoft.Web.WebView2.Core.dll ^
  /resource:"%WV2%\lib\net462\Microsoft.Web.WebView2.WinForms.dll",lib.Microsoft.Web.WebView2.WinForms.dll ^
  /resource:"%WV2%\runtimes\win-x64\native\WebView2Loader.dll",lib.WebView2Loader.dll ^
  /resource:NewsCenter.ico,NewsCenter.ico ^
  src\*.cs || goto :failed

echo Built %~dp0..\NewsCenter.exe
exit /b 0

:fetch
echo Downloading %1 %2 from nuget.org...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; $dest = Join-Path $env:TOOLS '%1.%2'; $zip = $dest + '.zip';" ^
  "New-Item -ItemType Directory -Force -Path $dest | Out-Null;" ^
  "Invoke-WebRequest -UseBasicParsing -Uri 'https://api.nuget.org/v3-flatcontainer/%1/%2/%1.%2.nupkg' -OutFile $zip;" ^
  "tar -xf $zip -C $dest; if ($LASTEXITCODE) { throw 'Could not unpack %1' }; Remove-Item $zip"
exit /b %errorlevel%

:failed
echo.
echo Build failed.
exit /b 1
