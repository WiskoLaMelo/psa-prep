@echo off
rem Lanceur Windows : installe ce qui manque, demarre PSA Prep et ouvre le navigateur.
rem Usage : windows.bat [ordinateur^|telephone]
chcp 65001 >nul
setlocal
set MODE=%1
if "%MODE%"=="" set MODE=ordinateur
cd /d "%~dp0\..\.."
cls
echo ==============================================
echo   PSA Prep
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto install_node
goto node_ok

:install_node
echo Node.js (le moteur qui fait tourner PSA Prep) n'est pas installe.
where winget >nul 2>nul
if errorlevel 1 (
  echo Je t'ouvre la page de telechargement : clique sur le gros bouton vert "LTS",
  echo installe-le en cliquant sur "Suivant" jusqu'au bout, puis relance ce fichier.
  start "" https://nodejs.org/fr/download
  pause
  exit /b 1
)
echo Installation de Node.js en cours (Windows peut te demander d'autoriser)...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo Node.js est installe. Ferme cette fenetre et double-clique a nouveau sur le lanceur.
pause
exit /b 0

:node_ok
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v

echo Verification des composants de PSA Prep (une a deux minutes la premiere fois)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo L'installation a echoue. Copie le texte ci-dessus et envoie-le a Claude.
  pause
  exit /b 1
)
echo [OK] Composants installes
if not exist .env copy .env.example .env >nul

echo.
if "%MODE%"=="telephone" (
  echo Demarrage en mode telephone. Un QR code va s'afficher : scanne-le avec le telephone.
  echo Pour arreter PSA Prep : ferme cette fenetre.
  echo.
  call npm run phone
) else (
  echo Demarrage... le navigateur va s'ouvrir tout seul.
  echo Laisse cette fenetre ouverte pendant que tu utilises PSA Prep ; ferme-la pour l'arreter.
  echo.
  start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 90;$i++){try{Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/config | Out-Null; Start-Process 'http://localhost:3000/'; break}catch{Start-Sleep 1}}"
  call npm run dev
)
pause
