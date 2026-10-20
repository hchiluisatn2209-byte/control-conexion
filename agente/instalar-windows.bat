@echo off
rem Instala el agente para el usuario actual. NO necesita permisos de administrador.
rem Requisito: agente.exe y agente.conf en la misma carpeta que este archivo.
set "DEST=%LOCALAPPDATA%\ControlConexion"
set "INICIO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%~dp0agente.exe" goto falta_exe
if not exist "%~dp0agente.conf" goto falta_conf

taskkill /im agente.exe /f >nul 2>&1
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0agente.exe" "%DEST%\agente.exe" >nul
copy /y "%~dp0agente.conf" "%DEST%\agente.conf" >nul

rem Lanzador que ejecuta el agente sin ventana, al iniciar sesion
> "%DEST%\iniciar-oculto.vbs" echo Set s = CreateObject("WScript.Shell") : s.Run """" ^& s.ExpandEnvironmentStrings("%%LOCALAPPDATA%%") ^& "\ControlConexion\agente.exe""", 0, False
copy /y "%DEST%\iniciar-oculto.vbs" "%INICIO%\ControlConexion.vbs" >nul
wscript "%DEST%\iniciar-oculto.vbs"

echo.
echo  Agente instalado y en ejecucion.
echo  Se iniciara solo cada vez que inicies sesion.
echo  Registro: %DEST%\agente.log
echo.
pause
exit /b 0

:falta_exe
echo No encuentro agente.exe junto a este archivo.
pause
exit /b 1

:falta_conf
echo Falta agente.conf junto a este archivo. Descargalo desde el panel de administracion.
pause
exit /b 1
