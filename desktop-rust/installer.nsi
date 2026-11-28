!include "MUI2.nsh"

Name "Arth Sutra"
OutFile "..\release\ArthSutra-Lite-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\ArthSutra"
InstallDirRegKey HKCU "Software\ArthSutra" "InstallDir"
RequestExecutionLevel user

SetCompressor /SOLID lzma

!define MUI_ICON "..\public\icons\icon.ico"
!define MUI_UNICON "..\public\icons\icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\ArthSutra.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Arth Sutra"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\release-native\app\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\Arth Sutra.lnk" "$INSTDIR\ArthSutra.exe"
  CreateDirectory "$SMPROGRAMS\Arth Sutra"
  CreateShortcut "$SMPROGRAMS\Arth Sutra\Arth Sutra.lnk" "$INSTDIR\ArthSutra.exe"
  CreateShortcut "$SMPROGRAMS\Arth Sutra\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\ArthSutra" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra" "DisplayName" "Arth Sutra"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra" "DisplayIcon" "$INSTDIR\ArthSutra.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra" "Publisher" "ARTH"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra" "DisplayVersion" "1.2.0"

  ; Refresh Windows Explorer icon cache so replaced EXE/shortcut icons appear immediately
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\Arth Sutra.lnk"
  RMDir /r "$SMPROGRAMS\Arth Sutra"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArthSutra"
  DeleteRegKey HKCU "Software\ArthSutra"
SectionEnd
