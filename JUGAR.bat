@echo off
rem Doble clic para jugar: arranca el servidor local de VOXELAND y abre
rem el navegador en http://localhost:8080.
rem Para parar el servidor, cierra su ventana.
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
	echo Falta Node.js: instalalo desde nodejs.org para arrancar el servidor
	pause
	exit /b 1
)
start "VOXELAND - servidor" node.exe tools\servir.mjs
ping -n 2 127.0.0.1 >nul
start "" http://localhost:8080
