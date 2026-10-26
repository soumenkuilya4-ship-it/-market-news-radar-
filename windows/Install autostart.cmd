@echo off
setlocal
rem Makes Market Radar start automatically (hidden) when you log in to Windows,
rem and puts a "Market Radar" shortcut on your Desktop.
for %%I in ("%~dp0..") do set "MR_ROOT=%%~fI"
set "MR_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Market Radar.lnk"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

powershell -NoProfile -Command ^
  "$sh = New-Object -ComObject WScript.Shell;" ^
  "$vbs = [char]34 + $env:MR_ROOT + '\windows\start-hidden.vbs' + [char]34;" ^
  "$icon = $env:MR_ROOT + '\docs\icons\icon.ico';" ^
  "$a = $sh.CreateShortcut($env:MR_STARTUP); $a.TargetPath = 'wscript.exe'; $a.Arguments = $vbs; $a.WorkingDirectory = $env:MR_ROOT; $a.Save();" ^
  "$desk = [Environment]::GetFolderPath('Desktop') + '\Market Radar.lnk';" ^
  "$d = $sh.CreateShortcut($desk); $d.TargetPath = 'wscript.exe'; $d.Arguments = $vbs + ' /open'; $d.WorkingDirectory = $env:MR_ROOT; if (Test-Path $icon) { $d.IconLocation = $icon }; $d.Save()"
if errorlevel 1 (
  echo Could not create the shortcuts.
  pause
  exit /b 1
)

echo.
echo Done. Market Radar will now start by itself every time you log in.
echo A "Market Radar" shortcut was added to your Desktop.
echo Starting it now...
wscript.exe "%MR_ROOT%\windows\start-hidden.vbs" /open
timeout /t 5 >nul
