; 윈도우 설치 프로그램 — Inno Setup 6
; 빌드: iscc packaging\windows\graphcalc.iss (PyInstaller 로 dist 를 만든 뒤)

#define AppName "수학 탐구 계산기"
#define AppVersion "1.0.0"
#define AppExe "graphcalc.exe"

[Setup]
AppId={{7C1A9E2E-4B3D-4B4E-9E1A-3F7C2D8A6B10}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=graphcalc
DefaultDirName={autopf}\graphcalc
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; 관리자 권한을 요구하지 않는다 — 학교 컴퓨터에서도 설치할 수 있게
PrivilegesRequiredOverridesAllowed=dialog
PrivilegesRequired=lowest
OutputDir=..\..\build\installer
OutputBaseFilename=수학탐구계산기-{#AppVersion}-설치
SetupIconFile=..\..\assets\icons\graphcalc.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; x64compatible 은 Inno Setup 6.3 부터다. 어느 판에서 빌드하든 돌게 x64 를 쓴다.
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64

[Languages]
; Inno Setup 6 에 한국어 언어 파일은 기본으로 들어 있지 않다. 설치 창은 영어지만
; 앱 이름과 프로그램 자체는 한국어다.
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\..\build\dist\graphcalc\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
