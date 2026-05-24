# Project Env Launcher

本地项目环境启动台。它把本机项目路径、环境、模块、常用配置和 Maven 启停流程放到一个 Web 控制台里管理，适合需要频繁切换环境、启动多个 Spring Boot/Maven 模块的本地开发场景。

预览页：[https://scottzzj.github.io/project-env-launcher-preview/](https://scottzzj.github.io/project-env-launcher-preview/)

## 功能

- 项目管理：维护本机项目目录，支持新建、编辑、删除和刷新识别。
- 环境管理：维护环境名称和标识。
- 模块管理：从项目目录识别 Maven 模块，维护模块启动端口。
- 配置管理：按“环境 + 模块”保存常改配置，包括启动端口、Nacos、RabbitMQ、Redis、数据库等。
- 监控面板：按项目查看运行状态，批量启动或关停模块，并查看 Maven 启动日志。
- 本地存储：使用 SQLite 保存配置，不依赖外部数据库服务。

## 运行要求

- Node.js
- JDK
- Maven
- Windows 环境下可直接使用 `start-project-env-launcher.cmd`

Maven 可以来自系统 `PATH`，也可以来自项目自身的 Maven Wrapper。启动模块时，系统会优先使用可检测到的 Maven 命令。

## 本地开发

```bash
npm install
npm run dev:all
```

开发模式会同时启动：

- 前端 Vite 服务：`http://127.0.0.1:5173`
- 后端 API 服务：`http://127.0.0.1:3001`

## 本地启动

```bash
npm run build
npm start
```

也可以在 Windows 上双击：

```text
start-project-env-launcher.cmd
```

脚本会先构建前端，再启动后端服务，并自动打开：

```text
http://127.0.0.1:3001
```

## 数据文件

运行时会在 `server/data/` 下生成本地数据和临时文件：

- SQLite 数据库
- 启动日志
- 运行时配置文件
- 备份文件

这些文件属于本机运行数据，已经通过 `.gitignore` 排除，不会提交到仓库。

仓库中只保留目录占位文件：

```text
server/data/.gitkeep
server/data/backups/.gitkeep
server/data/logs/.gitkeep
server/data/runtime-configs/.gitkeep
```

## 配置边界

系统不会内置具体业务项目、模块、数据库、Nacos、MQ 或 Redis 配置。首次运行时需要在页面中自行添加项目、环境和配置。

换电脑时，只要新电脑具备 Node.js、JDK、Maven 和对应外部环境支持，就可以重新配置项目路径后继续使用。

## 发布

当前版本：[v0.1.0](https://github.com/scottzzj/project-env-launcher/releases/tag/v0.1.0)

预览页单独发布在公开仓库，只包含静态页面，不包含源码和本地运行数据。
