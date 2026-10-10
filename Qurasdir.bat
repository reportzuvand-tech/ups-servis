@echo off
title UPS Servis - Windows proqrami
set "DIR=%LOCALAPPDATA%\UPSServis"
if not exist "%~dp0app\index.html" (echo "app" qovlugu tapilmadi. Zip-i tam acin. & pause & exit /b)
if not exist "%DIR%" mkdir "%DIR%"
xcopy "%~dp0app" "%DIR%\app\" /E /I /Y /Q >nul
copy /y "%~dp0zuvand.ico" "%DIR%\zuvand.ico" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b=@('%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe','%ProgramFiles%\Microsoft\Edge\Application\msedge.exe','%ProgramFiles%\Google\Chrome\Application\chrome.exe','%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if(-not $b){ Write-Host 'Edge ve ya Chrome tapilmadi.'; exit 1 }; $u=([System.Uri](Join-Path $env:DIR 'app\index.html')).AbsoluteUri; $w=New-Object -ComObject WScript.Shell; foreach($f in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut((Join-Path $f 'UPS Servis.lnk')); $s.TargetPath=$b; $s.Arguments='--user-data-dir=\"' + (Join-Path $env:DIR 'profil') + '\" --no-first-run --no-default-browser-check --app=' + $u; $s.IconLocation=(Join-Path $env:DIR 'zuvand.ico'); $s.Description='UPS Servis Jurnali'; $s.WorkingDirectory=$env:DIR; $s.Save() }; Write-Host 'Hazirdir: masaustunde UPS Servis ikonu yaradildi.'"
echo.
echo  Ilk acilisda adinizi, server unvanini ve acarinizi yazin.
echo  Google server: https://script.google.com/.../exec
echo  Lokal server:  http://SERVER-KOMPUTERIN-IP:8080/api
echo.
pause
