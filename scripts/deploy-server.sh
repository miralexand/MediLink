#!/usr/bin/env bash
# MediLink 服务端一键部署脚本（Linux 内网服务器）
#
# 用法：
#   sudo bash scripts/deploy-server.sh
# 前置：已安装 docker 与 docker compose 插件
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "未检测到 docker，请先安装：https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "未检测到 docker compose 插件，请先安装。" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "未找到 .env，正在从 .env.example 生成，请务必修改其中配置后重新运行。"
  cp .env.example .env
  echo "已生成 .env，请编辑 RENDEZVOUS_SERVER / RELAY_HOST / MEDILINK_ENROLLMENT_KEY 等参数。"
  exit 0
fi

mkdir -p data/rustdesk data/medilink

echo ">>> 构建并启动服务 ..."
docker compose up -d --build

echo ">>> 等待 hbbs 生成密钥 ..."
for _ in $(seq 1 30); do
  if [ -f data/rustdesk/id_ed25519.pub ]; then break; fi
  sleep 1
done

if [ -f data/rustdesk/id_ed25519.pub ]; then
  KEY="$(cat data/rustdesk/id_ed25519.pub)"
  echo ""
  echo "======================================================"
  echo " RustDesk 服务端公钥（Key）："
  echo "   $KEY"
  echo " 请在 MediLink 控制台『系统设置』中填入该 Key，"
  echo " 或写入 .env 的 MEDILINK_RUSTDESK_KEY 后重启。"
  echo "======================================================"
else
  echo "警告：尚未生成 id_ed25519.pub，请查看日志：docker compose logs -f hbbs" >&2
fi

docker compose ps
echo ""
echo "管理控制台：http://<本机内网IP>:${MEDILINK_PORT:-21120}/"
