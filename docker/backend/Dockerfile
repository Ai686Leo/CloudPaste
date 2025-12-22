# 第一阶段：安装依赖并编译原生模块（构建阶段）
FROM node:22-alpine AS deps

WORKDIR /app

# 可选：设置 npm registry（国内环境可改成 https://registry.npmmirror.com/）
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry ${NPM_REGISTRY}

# 先复制依赖清单，利用 Docker layer cache
COPY backend/package.json backend/package-lock.json ./

# 构建期依赖：用于编译 sqlite3/better-sqlite3 等原生模块
RUN apk add --no-cache --virtual .build-deps python3 make g++ sqlite-dev && \
    npm ci --include=optional --no-audit --no-fund && \
    apk del .build-deps

# 第二阶段：创建最终镜像
FROM node:22-alpine

WORKDIR /app

# 运行时 sqlite 动态库
RUN apk add --no-cache sqlite-libs

# 复制构建阶段产物
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

# 创建数据目录
RUN mkdir -p /data

# 设置环境变量
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=8787
ENV TASK_WORKER_POOL_SIZE=2
# 调试驱动缓存 (默认 false)
#- DEBUG_DRIVER_CACHE=false
# 注意：这个密钥应该在运行时通过环境变量传入，这里只是设置默认值
ENV ENCRYPTION_SECRET=default-encryption-key

# 暴露端口
EXPOSE 8787

# 启动命令
CMD ["npx", "tsx", "--expose-gc", "unified-entry.js"]
