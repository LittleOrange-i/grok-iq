# GrokIQ Frontend

本目录使用完整的 [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) 源码作为 UI 基座，并针对 GrokIQ 二次开发。

业务入口：

- 监控概览
- 账号探针
- 任务中心
- Cron 计划与探针方案
- 聊天广场
- SSO 检测与报告
- 系统设置

```bash
npm ci
npm run dev
npm run build
```

开发环境默认通过 Vite 将 `/api` 代理至 `http://127.0.0.1:8090`。Docker 镜像使用 nginx 提供 SPA 静态文件并把 `/api` 代理至后端服务。

shadcn-admin 原始 MIT 许可证保留在 [LICENSE](./LICENSE)。
