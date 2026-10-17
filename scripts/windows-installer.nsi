; Anna setup for Windows, built by scripts/package-windows-installer.mjs from dist/windows/Anna.
; Installs for the current user only (no administrator prompt) into the same folder install.ps1 uses, so the in-app
; updater can replace it. The uninstaller lives next to that folder, because an update swaps the whole folder.
; Defines passed by the build script: VERSION, SOURCE (the Anna folder), OUTFILE.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"

!define APPDIR "$LOCALAPPDATA\Programs\Anna"
!define UNINSTDIR "$LOCALAPPDATA\Programs\Anna Uninstaller"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Anna"
!define ICON "${APPDIR}\resources\app\dist\renderer\anna.ico"

Name "Anna"
OutFile "${OUTFILE}"
InstallDir "${APPDIR}"
BrandingText "Anna ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "Anna"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "FileDescription" "Anna Setup"
VIAddVersionKey /LANG=0 "LegalCopyright" "Copyright (c) 2026 Anna contributors"

!define MUI_ICON "${SOURCE}\resources\app\dist\renderer\anna.ico"
!define MUI_UNICON "${SOURCE}\resources\app\dist\renderer\anna.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Anna.exe"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Anna"
  ; Quit a running copy before replacing it.
  nsExec::Exec 'taskkill /IM Anna.exe /F'
  Sleep 500
  RMDir /r "${APPDIR}"
  SetOutPath "${APPDIR}"
  File /r "${SOURCE}\*"
  CreateShortCut "$SMPROGRAMS\Anna.lnk" "${APPDIR}\Anna.exe" "" "${ICON}"
  CreateShortCut "$DESKTOP\Anna.lnk" "${APPDIR}\Anna.exe" "" "${ICON}"
  CreateDirectory "${UNINSTDIR}"
  WriteUninstaller "${UNINSTDIR}\Uninstall Anna.exe"
  ; No DisplayVersion: in-app updates replace the app without running setup, so it would go stale.
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Anna"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "${ICON}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Anna contributors"
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "https://anna.mayuanyuan.top"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "${APPDIR}"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"${UNINSTDIR}\Uninstall Anna.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "QuietUninstallString" '"${UNINSTDIR}\Uninstall Anna.exe" /S'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

; Anna's settings, keys and memories live in %APPDATA%\Anna and are kept, so a reinstall picks up where you left off.
Section "Uninstall"
  nsExec::Exec 'taskkill /IM Anna.exe /F'
  Sleep 500
  RMDir /r "${APPDIR}"
  RMDir /r "${APPDIR}.old"
  Delete "$SMPROGRAMS\Anna.lnk"
  Delete "$DESKTOP\Anna.lnk"
  DeleteRegKey HKCU "${UNINSTKEY}"
  Delete "${UNINSTDIR}\Uninstall Anna.exe"
  RMDir "${UNINSTDIR}"
SectionEnd
