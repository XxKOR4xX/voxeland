@echo off
rem Doble clic para publicar: abre la GUI de deploy de VOXELAND
rem (estado de git, tests, commit/push y estado de GitHub Pages).
cd /d "%~dp0"
where python.exe >nul 2>nul
if errorlevel 1 (
	echo Falta Python: instalalo desde python.org con la opcion "Add python.exe to PATH"
	pause
	exit /b 1
)
python.exe tools\deploy_gui.py
if errorlevel 1 pause
