@echo off
taskkill /im agente.exe /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ControlConexion.vbs" >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\ControlConexion" >nul 2>&1
echo Agente desinstalado.
pause
