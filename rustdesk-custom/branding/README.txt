把自定义图标放在本目录，命名为 app_icon.ico（建议 256x256，含多尺寸）。

apply-branding.ps1 会自动用它替换：
- flutter\windows\runner\resources\app_icon.ico（应用/任务栏图标）
- res\icon.ico（打包用图标）

若本目录没有 app_icon.ico，脚本会沿用官方图标并给出提示。
