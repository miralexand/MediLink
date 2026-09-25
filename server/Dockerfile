# MediLink 管理服务端镜像
FROM oven/bun:1.3

WORKDIR /app

# 仅复制运行所需文件（无第三方依赖）
COPY package.json tsconfig.json ./
COPY src ./src

ENV MEDILINK_PORT=8080 \
    MEDILINK_DB_PATH=/app/data/medilink.db \
    NODE_ENV=production

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:8080/health');process.exit(r.ok?0:1)" || exit 1

CMD ["bun", "run", "src/index.ts"]
