; Inno Setup script: per-user installer (no admin rights), Start menu shortcut, "Open with" for pictures.
; Built by .github/workflows/windows.yml:  iscc /DSourceDir=<publish folder> /DOutDir=<folder> windows\installer.iss
#ifndef SourceDir
  #define SourceDir "..\out\PencilSketch"
#endif
#ifndef OutDir
  #define OutDir "..\out"
#endif

[Setup]
AppId={{6E0B5A0E-6C1D-4E0B-9B55-5C7A3D0F2A11}
AppName=Pencil Sketch
AppVersion=1.0.0
AppPublisher=Pencil Sketch
DefaultDirName={localappdata}\Programs\Pencil Sketch
DefaultGroupName=Pencil Sketch
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename=PencilSketch-Setup
SetupIconFile=PencilSketch\app.ico
UninstallDisplayIcon={app}\PencilSketch.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Pencil Sketch"; Filename: "{app}\PencilSketch.exe"
Name: "{autodesktop}\Pencil Sketch"; Filename: "{app}\PencilSketch.exe"; Tasks: desktopicon

[Registry]
; show up under "Open with" for common picture types, without taking over the default app
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Pencil Sketch"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe\shell\open\command"; ValueType: string; ValueData: """{app}\PencilSketch.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe\SupportedTypes"; ValueType: string; ValueName: ".jpg"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe\SupportedTypes"; ValueType: string; ValueName: ".jpeg"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe\SupportedTypes"; ValueType: string; ValueName: ".png"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\PencilSketch.exe\SupportedTypes"; ValueType: string; ValueName: ".webp"; ValueData: ""

[Run]
Filename: "{app}\PencilSketch.exe"; Description: "{cm:LaunchProgram,Pencil Sketch}"; Flags: nowait postinstall skipifsilent
