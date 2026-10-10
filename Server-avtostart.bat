@echo off
title UPS Servis - serverin avtomatik basladilmasi
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'UPS Servis Server.lnk')); $s.TargetPath=(Join-Path '%~dp0' 'Server-baslat.bat'); $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation=(Join-Path '%~dp0' 'zuvand.ico'); $s.Save(); Write-Host 'Hazirdir: kompyuter acilanda server ozu baslayacaq.'"
pause
