# 构建阶段
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm run build

# 运行阶段（boot.js 已打包全部依赖，配置由运行环境注入）
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/boot.js"]
