#!/usr/bin/env bash
# MediLink 服务端备份脚本
#
# 备份内容：RustDesk 服务端密钥/hbbs 数据库、MediLink 台账与审计库、部署配置。
# 用法：sudo bash scripts/backup.sh [备份目录]
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="${1:-./backups}"
STAMP="$(date +%F-%H%M%S)"
mkdir -p "$DEST"

echo ">>> 停止写入（可选）并打包数据目录 ..."
# 为一致性，建议短暂停止 medilink 容器；hbbs/hbbr 可继续运行。
docker compose stop medilink >/dev/null 2>&1 || true

tar -czf "$DEST/medilink-data-$STAMP.tar.gz" data .env 2>/dev/null || tar -czf "$DEST/medilink-data-$STAMP.tar.gz" data

docker compose start medilink >/dev/null 2>&1 || true

echo "备份完成：$DEST/medilink-data-$STAMP.tar.gz"
echo "请将备份文件转存至医院灾备存储，并遵循日志留存不少于 6 个月的要求。"
