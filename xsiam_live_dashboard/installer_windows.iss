; ─────────────────────────────────────────────────────────────────────────────
; installer_windows.iss  —  Inno Setup script for XSIAM Dashboard
; Produces a professional Windows installer (.exe) with:
;   - Start Menu shortcut
;   - Desktop shortcut (optional)
;   - Uninstaller
;   - Installs to %LocalAppData%\AltISec\XSIAM Dashboard  (no admin rights needed)
;
; Build: ISCC.exe installer_windows.iss
; ─────────────────────────────────────────────────────────────────────────────

#define AppName      "XSIAM Dashboard"
#define AppVersion   "1.0.0"
#define AppPublisher "AltISec"
#define AppURL       "https://altisec.in"
#define AppExeName   "XSIAM Dashboard.exe"
#define AppId        "{{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
; Install to user's AppData — no admin rights required
DefaultDirName={localappdata}\{#AppPublisher}\{#AppName}
DefaultGroupName={#AppPublisher}\{#AppName}
DisableProgramGroupPage=yes
; Output
OutputDir=dist
OutputBaseFilename=XSIAM_Dashboard_Setup_{#AppVersion}
; Compression
Compression=lzma2/ultra64
SolidCompression=yes
; Appearance
WizardStyle=modern
WizardImageFile=compiler:WizModernImage.bmp
WizardSmallImageFile=compiler:WizModernSmallImage.bmp
; No admin rights needed — installs per-user
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; Architecture
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Misc
ShowLanguageDialog=no
UninstallDisplayIcon={app}\{#AppExeName}
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; Bundle everything from the PyInstaller output folder
Source: "dist\XSIAM Dashboard\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Start Menu
Name: "{group}\{#AppName}";          Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
; Desktop (optional)
Name: "{autodesktop}\{#AppName}";    Filename: "{app}\{#AppExeName}"; IconFilename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; Launch app after install
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up config on uninstall (optional — comment out to keep credentials)
; Type: filesandordirs; Name: "{localappdata}\xsiam-dashboard"

[Code]
// Close any running instance before install
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nThe application opens in your default browser and connects securely to your XSIAM tenant.%n%nClick Next to continue.
FinishedLabel=Setup has finished installing [name] on your computer.%n%nThe application will launch automatically in your browser.
