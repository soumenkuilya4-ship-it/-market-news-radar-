@echo off
rem Stops Market Radar and removes the auto-start and Desktop shortcuts.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Market Radar.lnk" 2>nul
powershell -NoProfile -Command ^
  "Remove-Item -ErrorAction SilentlyContinue ([Environment]::GetFolderPath('Desktop') + '\Market Radar.lnk');" ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*server\index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Market Radar stopped and will no longer start automatically.
pause
