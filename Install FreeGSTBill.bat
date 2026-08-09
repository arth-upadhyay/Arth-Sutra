@echo off
title ArthSutra Quick Setup
echo ========================================
echo        Setting up ArthSutra...
echo ========================================
echo.

echo [1/3] Installing dependencies...
call npm install
echo.

echo [2/3] Building the software...
call npm run build
echo.

echo [3/3] Starting the server...
call npm start

pause