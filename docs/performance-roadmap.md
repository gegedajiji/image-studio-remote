# 有鱼生图性能架构路线

## 当前状态

- 前端：单页静态文件，`public/app.js` 和 `public/styles.css` 直接由 Express 提供。
- 后端：Node.js + Express，进程内维护业务状态。
- 数据：`data/db.json` 是主状态文件，`data/app.sqlite` 是保护性快照。
- 任务：生图请求在 API 进程内执行，失败后依赖退款与 pending 恢复逻辑兜底。
- 已完成加固：
  - JSON 写入前自动轮转备份。
  - SQLite 快照保护和启动恢复。
  - `persist()` 短窗口合并写入，减少并发写放大。
  - SQLite 对象快照增量同步。
  - 静态资源缓存策略。
  - `npm run health:store` 数据一致性检查。
  - `/api/health` 和 `/api/admin/overview` 暴露安全的 store 运行指标。
  - Web 生图支持异步队列提交和轮询，避免长耗时任务占住提交请求。
  - 生图 job payload 持久化到 `data/jobs/`，服务重启后可恢复 pending 任务继续执行。

## 目标架构

### 前端

- 使用 Vite/React 或同等级构建链，将当前大体积 `public/app.js` 拆成模块化源码。
- 输出带 hash 的静态资源，交给 Caddy/Nginx 或对象存储/CDN 托管。
- 首屏只加载工作台核心代码，管理后台、交流区、API 文档延迟加载。
- 图片缩略图统一走 CDN/对象存储，避免把大图塞进 JSON 或 API 响应。

### 后端

- API 进程保持 stateless：登录、用户、计费、交流区、任务创建都落数据库。
- 生图任务拆到 worker：
  - API 只负责校验、扣费、创建任务。
  - Worker 负责调度多上游、轮询、失败重试、回写结果和退款。
  - 长任务不占用 HTTP 请求生命周期。
- 多上游调度独立成服务层：权重、优先级、冷却、自动禁用、失败统计、健康探测。
- 所有资金变动必须通过账本事务，余额由事务内更新，禁止绕过账本直接改余额。

### 数据库

- 短期：继续使用当前 SQLite 快照保护，保持 JSON 兼容回滚。
- 中期：SQLite 成为主库，JSON 退为导出备份。
- 长期：PostgreSQL 作为主库，Redis 做会话、限流、任务队列和热点缓存。
- 关键表：
  - `users`
  - `sessions`
  - `transactions`
  - `generations`
  - `generation_images`
  - `redeem_codes`
  - `community_posts`
  - `community_comments`
  - `image_upstreams`
  - `upstream_events`
  - `jobs`

### 存储

- 原图、生成图、缩略图迁到对象存储。
- 数据库只保存 URL、hash、尺寸、mime、大小和审核状态。
- 交流区卡片优先读缩略图，不读原图。

### 运维指标

- API：
  - p95/p99 响应耗时
  - 5xx 比例
  - 登录、生成、上传、评论、打赏接口 QPS
- Store：
  - persist scheduled/flushed 比值
  - persist lastFlushDurationMs
  - persist failed
  - SQLite cachedObjects
- 生图任务：
  - pending 数量
  - succeeded/failed/refunded 数量
  - 上游成功率、平均耗时、冷却数量
- 资金：
  - 用户余额总额
  - 交易流水总额
  - 退款总额
  - 异常负余额数量

## 渐进上线步骤

1. 已完成：保护当前数据，补齐备份、SQLite 快照、写入合并和健康检查。
2. 已完成第一步异步化：Web 端通过 `async=1` 创建后台任务，前端轮询结果。
3. 已完成任务 payload 文件持久化：`data/jobs/<generationId>.json` 保存 worker 输入，完成/失败后自动清理。
4. 下一步：把 job 状态机迁入 SQLite 主表，并拆出独立 worker 进程。
5. 再下一步：把图片文件迁到对象存储，并生成固定尺寸缩略图。
6. 数据库迁移：先把 SQLite 作为主写入，再保留 JSON 定时导出，最后切 PostgreSQL。
7. 前端重构：引入构建链、拆分页面模块、按路由懒加载，保留现有 UI 体验但降低首屏成本。
8. 压测与容量：用生产副本压测登录、列表、生成任务创建、交流区点赞评论和管理员查询。

## 当前部署验证

每次部署后至少执行：

```bash
npm run check
npm run health:store
curl -s http://127.0.0.1:8790/api/health
systemctl status image-studio.service --no-pager -l
```

确认：

- `image-studio.service` 为 `active`。
- `health:store` 输出 `ok: true`。
- `store.persist.failed` 为 `0`。
- `store.persist.queuePending` 长时间不为 `true`。
- 管理员账号 `146818` 可登录，仍为 `admin`。
