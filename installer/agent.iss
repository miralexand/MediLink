; MediLink 被控端安装包
; 编译：ISCC.exe agent.iss
; 静默部署示例：
;   MediLink-Agent-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART ^
;       /SERVER=http://10.0.0.10:21120 /KEY=你的注册密钥 /DEPARTMENT=门诊

#define MyAppName "MediLink 被控端"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "医院信息科"
#define MyAppExeName "medilink-agent.exe"

[Setup]
AppId={{8F3A2C41-6B7E-4D2A-9C15-7A1B2C3D4E5F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\MediLink
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=Output
OutputBaseFilename=MediLink-Agent-Setup-{#MyAppVersion}
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

[Files]
Source: "..\agent\dist\medilink-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
; 可选：将 RustDesk 安装包放到 installer\payload\rustdesk.msi，将随安装包一起部署
Source: "payload\rustdesk.msi"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Run]
; 1) 如内置了 RustDesk 安装包则静默安装
Filename: "msiexec.exe"; Parameters: "/i ""{tmp}\rustdesk.msi"" /qn /norestart"; \
    StatusMsg: "正在安装 RustDesk 客户端…"; Check: ShouldInstallRustDesk; \
    Flags: waituntilterminated runhidden
; 2) 写入配置、注册计划任务并完成首次登记
Filename: "{app}\{#MyAppExeName}"; Parameters: "install --server ""{code:GetServer}"" --key ""{code:GetKey}"" --department ""{code:GetDept}"""; \
    StatusMsg: "正在配置 MediLink 被控端并登记设备…"; Check: ShouldRunConfig; \
    Flags: waituntilterminated runhidden

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "uninstall"; RunOnceId: "RemoveTask"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{commonappdata}\MediLink"

[Code]
var
  ConfigPage: TInputQueryWizardPage;
  ServerValue, KeyValue, DeptValue: String;

function GetServer(Param: String): String;
begin
  Result := ServerValue;
end;

function GetKey(Param: String): String;
begin
  Result := KeyValue;
end;

function GetDept(Param: String): String;
begin
  Result := DeptValue;
end;

function ShouldRunConfig: Boolean;
begin
  Result := ServerValue <> '';
end;

function ShouldInstallRustDesk: Boolean;
begin
  Result := FileExists(ExpandConstant('{tmp}\rustdesk.msi'));
end;

procedure InitializeWizard;
begin
  ServerValue := ExpandConstant('{param:SERVER|}');
  KeyValue := ExpandConstant('{param:KEY|}');
  DeptValue := ExpandConstant('{param:DEPARTMENT|}');

  if (ServerValue = '') and (not WizardSilent) then
  begin
    ConfigPage := CreateInputQueryPage(wpSelectDir,
      'MediLink 接入配置', '配置管理服务端连接',
      '请填写内网 MediLink 管理服务端地址（服务端部署在信息科内网）。' + #13#10 +
      '注册密钥需与管理服务端设置保持一致。');
    ConfigPage.Add('服务端地址（如 http://10.0.0.10:21120）：', False);
    ConfigPage.Add('注册密钥（可留空）：', False);
    ConfigPage.Add('科室（可留空，后续可在控制台修改）：', False);
    ConfigPage.Values[0] := 'http://10.0.0.10:21120';
    ConfigPage.Values[1] := '';
    ConfigPage.Values[2] := '';
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (ConfigPage <> nil) and (CurPageID = ConfigPage.ID) then
  begin
    ServerValue := Trim(ConfigPage.Values[0]);
    KeyValue := Trim(ConfigPage.Values[1]);
    DeptValue := Trim(ConfigPage.Values[2]);
    if ServerValue = '' then
    begin
      MsgBox('请填写 MediLink 管理服务端地址。', mbError, MB_OK);
      Result := False;
    end;
  end;
end;
