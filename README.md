# 有鱼生图源码包

这是有鱼生图站点的独立部署源码。项目包含首页、图片工作台、历史记录、作品交流区、管理员后台、卡密兑换、用户管理、上游生图通道配置和基础计费能力。

## 目录结构

```text
.
├── public/              # 前端页面、样式、脚本和图片资源
├── src/                 # Node.js 后端服务、认证、存储、生图客户端
├── scripts/             # 健康检查、迁移、回归检查脚本
├── docs/                # 项目补充文档
├── Dockerfile           # Docker 镜像构建文件
├── docker-compose.yml   # Docker Compose 启动示例
├── .env.example         # 环境变量示例
├── package.json         # 项目依赖和 npm scripts
├── package-lock.json    # 锁定依赖版本
└── README.md            # 本说明
```

源码包不包含 `node_modules/`、`data/`、`.playwright-cli/`、`output/`、运行数据库、用户上传文件、测试截图和临时备份文件。

## 环境要求

- Node.js 22 或更高版本。项目使用 `node:sqlite`，低版本 Node 可能无法启动。
- npm。
- 可选：MySQL 8。如果不配置 MySQL，项目会使用本地 `data/app.sqlite` 和 `data/db.json`。

## 快速启动

```bash
npm install
npm run check
npm start
```

默认监听端口为 `8790`。本地访问：

```text
http://127.0.0.1:8790
```

开发模式：

```bash
npm run dev
```

## Docker 启动

先准备环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

```bash
PUBLIC_BASE_URL=https://你的域名
APP_SECRET=请改成足够长的随机字符串
ADMIN_USERNAME=管理员账号
ADMIN_PASSWORD=管理员密码
IMAGE_UPSTREAM_BASE_URL=上游生图地址
IMAGE_UPSTREAM_API_KEY=上游生图密钥
```

构建并启动：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f image-studio
```

停止：

```bash
docker compose down
```

默认把本机 `./data` 挂载到容器 `/app/data`，容器重建不会丢用户、余额、卡密、历史记录等运行数据。

如果不用 Compose，也可以直接构建运行：

```bash
docker build -t youyu-image-studio:latest .
docker run -d \
  --name youyu-image-studio \
  --restart unless-stopped \
  --env-file .env \
  -p 8790:8790 \
  -v "$PWD/data:/app/data" \
  youyu-image-studio:latest
```

## 常用环境变量

生产部署建议至少配置这些变量：

```bash
NODE_ENV=production
PORT=8790
PUBLIC_BASE_URL=https://你的域名
APP_SECRET=请改成足够长的随机字符串
ADMIN_USERNAME=管理员账号
ADMIN_PASSWORD=管理员密码
IMAGE_UPSTREAM_BASE_URL=上游生图地址
IMAGE_UPSTREAM_API_KEY=上游生图密钥
IMAGE_MODEL=gpt-image-2
TEXT_MODEL=gpt-5.4-mini
PRICE_1K_CENTS=100
PRICE_2K_CENTS=200
```

MySQL 可选配置：

```bash
STORE_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=image_studio
MYSQL_PASSWORD=数据库密码
MYSQL_DATABASE=image_studio
```

也可以使用：

```bash
MYSQL_URL=mysql://user:password@host:3306/image_studio
```

注意：生产环境不能使用默认管理员密码，`NODE_ENV=production` 时必须设置安全的 `ADMIN_PASSWORD`。

## 管理后台

管理员登录后可以在后台管理：

- 生图单价。
- 上游生图通道配置。
- 卡密生成和撤销。
- 用户新增、删除、禁用、密码重置。
- 生成日志和基础状态。

上游地址和 API Key 不建议写死在代码里，应优先通过管理员页面或环境变量配置。

## 数据与备份

运行时数据默认写入：

```text
data/
```

其中包括本地数据库、JSON 快照、任务数据和自动备份。源码包故意不包含这些内容，避免把线上用户、余额、卡密、图片历史和密钥打包出去。

如果要迁移生产数据，需要单独备份并恢复 `data/` 或 MySQL 数据库。

## 常用命令

```bash
npm run check                 # JS 语法检查
npm run health:store          # 存储健康检查
npm run migrate:mysql         # 迁移到 MySQL
npm run test:store-regression # 存储回归检查
npm run smoke:perf            # 性能烟测
```

## systemd 部署示例

假设部署目录为 `/opt/standalone-image-studio`：

```ini
[Unit]
Description=Youyu Image Studio
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/standalone-image-studio
Environment=NODE_ENV=production
Environment=PORT=8790
EnvironmentFile=-/opt/standalone-image-studio/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

常用操作：

```bash
systemctl daemon-reload
systemctl enable image-studio.service
systemctl restart image-studio.service
systemctl status image-studio.service
```

## 打包说明

本源码包为代码包，不是完整生产数据备份。恢复生产站点时需要：

1. 解压源码。
2. 安装依赖：`npm install`。
3. 配置 `.env` 或 systemd 环境变量。
4. 恢复 `data/` 或 MySQL 数据。
5. 启动服务。

Docker 恢复时同样需要恢复 `data/` 或 MySQL 数据，再执行 `docker compose up -d --build`。
