# ==========================================
# SteamMaster 商业版后端 Docker 镜像构建
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm install

# 复制源码并编译
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ==========================================
# 生产运行镜像 (极简 Alpine 运行环境)
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1257

# 仅安装生产依赖
COPY package*.json ./
RUN npm install --only=production

# 复制编译产物与数据仓储
COPY --from=builder /app/dist ./dist
COPY data ./data

EXPOSE 1257

CMD ["node", "dist/server.js"]
