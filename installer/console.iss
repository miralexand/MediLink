; MediLink 信息科控制端安装包
; 编译：ISCC.exe console.iss
; 静默部署示例：
;   MediLink-Console-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SERVER=http://10.0.0.10:21120

#define MyAppName "MediLink 控制端"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "医院信息科"
#define MyAppExeName "medilink-console.exe"

[Setup]
AppId={{B7E4D9A2-3C18-4F60-8D25-9E6F0A1B2C3D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\MediLink Console
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=MediLink-Console-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#MyAppName}
MinVersion=10.0

[Languages]
Name: "chinese"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "..\console\dist\medilink-console.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MediLink 控制端"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 MediLink 控制端"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MediLink 控制端"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 MediLink 控制端"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill.exe"; Parameters: "/IM {#MyAppExeName} /F"; RunOnceId: "KillConsole"; Flags: runhidden

[Code]
var
  ServerValue: String;
  ServerPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ServerValue := ExpandConstant('{param:SERVER|}');
  if (ServerValue = '') and (not WizardSilent) then
  begin
    ServerPage := CreateInputQueryPage(wpSelectDir,
      'MediLink 控制端配置', '配置管理服务端地址',
      '请填写内网 MediLink 管理服务端地址，控制端将据此加载设备台账。' + #13#10 +
      '后续也可在控制台右上角“设置”中修改。');
    ServerPage.Add('服务端地址（如 http://10.0.0.10:21120）：', False);
    ServerPage.Values[0] := 'http://10.0.0.10:21120';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (ServerPage <> nil) and (CurPageID = ServerPage.ID) then
    ServerValue := Trim(ServerPage.Values[0]);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Dir, Json: String;
begin
  if (CurStep = ssPostInstall) and (ServerValue <> '') then
  begin
    Dir := ExpandConstant('{userappdata}\MediLink');
    ForceDirectories(Dir);
    Json := '{"server_url":"' + ServerValue + '","rustdesk_exe":""}';
    SaveStringToFile(Dir + '\console.json', Json, False);
  end;
end;
