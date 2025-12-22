# 构建阶段
FROM node:22-alpine AS build

WORKDIR /app

# 复制依赖（利用 Docker layer cache）
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./

# 安装依赖
RUN npm ci --cache /tmp/npm-cache --no-audit --no-fund

# 复制前端源代码
COPY frontend/ ./

# 设置API地址环境变量 - 使用通用占位符，实际值将在运行时由entrypoint.sh设置
ARG VITE_BACKEND_URL=http://localhost:8787
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# 添加Docker构建环境标识
ENV VITE_IS_DOCKER=true

# 构建应用
RUN npm run build

# 部署阶段
FROM nginx:1.25-alpine

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制Nginx配置
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# 复制启动脚本
COPY docker/frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh


# 暴露端口
EXPOSE 80

# 使用启动脚本
CMD ["/entrypoint.sh"]
