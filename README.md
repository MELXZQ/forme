# FORME 本地电商、双仓库存与业务管理

沿用现有 Next.js 项目、前台设计、动画、路由与 Shop 即时筛选。PostgreSQL 提供真实商品、首页、双仓库存、调拨和本地访客订单数据。没有真实支付、退款、邮件、物流接口或公网部署。

已确认：原有 16 个 SKU、共 160 件旧库存保留为待确认；没有自动计入北京或墨尔本。只有实际登记的墨尔本可售库存能结账。固定澳洲运费未配置时会阻止结账。

## 下次开机

Finder 打开本目录，双击 **Start Website.command**，保持终端打开。它启动数据库、网站和每分钟一次的订单预留释放与通知检查任务。

- 商城：http://127.0.0.1:3000
- 按角色显示的综合待办首页：http://127.0.0.1:3000/admin
- 通知中心：http://127.0.0.1:3000/admin/notifications
- 高级订单、经营统计、售后与补偿：http://127.0.0.1:3000/admin/sales
- 商品后台：http://127.0.0.1:3000/admin?catalogue=1
- 库存与订单：http://127.0.0.1:3000/admin/operations
- 供应商、采购、支出、循环支出与物流：http://127.0.0.1:3000/admin/business
- 停止：Control+C 停网站和启动器的任务；随后 `npm run db:stop` 停数据库，不会删除数据。

VS Code：File → Open Folder，选择 `/Users/hopayed/Documents/ChatGPT/Edward/forme`。Terminal → New Terminal：

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm run db:start
npm run dev
```

再开一个终端保持释放与通知任务运行：

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm run orders:worker
```

保存代码后预览更新。左侧 Source Control 查看 Git 变更和逐行差异；保存不会自动提交 Git。按所有者要求，助手在每批开发完成并验证后默认自动 commit/push 到私有仓库 MELXZQ/forme；不会强制推送，也不会上传密钥、数据库、备份或上传凭证。不要重复启动占用3000的进程。

## 第一个所有者

```sh
npm run admin:create
```

在本地填写邮箱、名称和隐藏密码（12–128字符），不要在聊天发送密码。没有默认密码或公开注册。已有账号重置需本地确认，撤销旧会话并保留已有角色和停用状态。新账号是 Owner。正式数据库不使用测试账号。

后台 **Inventory / Orders** 进入运营页面；**Accounts** 为朋友创建个人 Melbourne warehouse 账号；**Catalogue** 返回商品和首页管理。

## 使用文档

- [订单、经营统计与售后操作手册](docs/sales-manual.md)：实际页面、保存筛选、真实/测试口径、时限、审批、外部退款登记、补发和完整样例。
- [第三批技术说明](docs/sales-technical.md)：事件/快照、精确金额、统计公式、权限、事务、幂等、历史未知及接入边界。
- [第三批验证记录](docs/sales-verification.md)：三批回归、接口、页面、构建与重启结果。
- [采购、支出与物流操作手册](docs/business-manual.md)：实际按钮、分批收付/验收、退供应商、循环规则、私有凭证和任务。
- [第二批技术说明](docs/business-technical.md)：模型、金额口径、状态、并发、权限及未来接入。
- [第二批验证记录](docs/business-verification.md)：隔离测试、HTTP、界面及重启结果。
- [通知中心操作手册](docs/notifications-manual.md)：今天/历史/置顶、多人确认、两仓阈值、商品资料和物流异常的完整例子。
- [通知技术与验证记录](docs/notifications-verification.md)：迁移、可靠任务、测试结果和本地限制。

- [后台操作手册](docs/operations-manual.md)：你和朋友分别如何入库、调拨、部分收货、盘点、查询、发货及登记退货。
- [技术与安全说明](docs/operations-technical.md)：模型、库存规则、事务/幂等、权限、环境、限制和公网前清单。
- [本阶段验证记录](docs/operations-verification.md)：实际通过与尚未验证的项目。
- [前阶段记录](docs/backend-verification.md)：仅为商品内容管理阶段历史。

## 环境与数据

Node24.22.2 / npm11.19.1，Next16.4.5 / React19.3.1 / TypeScript5.9.3，PostgreSQL17.11，Prisma7.10.1，Better Auth1.7.17。本阶段保留已有版本，精确依赖见 package-lock.json。采用成熟密码哈希、数据库会话和本地 Sharp 图片处理。

已安装私有 Node 在 .tools/node；PostgreSQL 使用现有 Homebrew17。缺少依赖时 `npm ci`。仅初次缺少本地配置时执行 `npm run db:setup`，生成随机凭据；不要覆盖已有 .env.local。

```sh
npm run db:start
npm run db:generate
npm run db:migrate
npm run db:seed
```

迁移保留历史（当前9份），seed 按稳定标识补齐，不重置仓库余额。第三批增量迁移已在本机应用，无新增必填环境变量。旧订单不伪造付款时间、实际优惠或活动归因；新订单超时规则默认未启用。不要执行 migrate reset 或删除数据库目录。

| 环境变量 | 用途 |
|---|---|
| DATABASE_URL | forme_app 日常最小权限连接 |
| DIRECT_URL | forme_migrator 迁移连接 |
| SHADOW_DATABASE_URL | 开发迁移专用影子库 |
| BETTER_AUTH_SECRET / BETTER_AUTH_URL | 私有认证密钥 / 本机3000来源 |
| STORAGE_DIR | 本地上传目录，默认 .local/uploads |
| POSTGRES_BIN | 已有 PostgreSQL17 安装路径 |
| ENABLE_OPERATIONS | 运营接口与结账开关；关闭不会恢复旧库存 |
| ENABLE_DEV_PAYMENTS | Owner 开发模拟付款；production 始终拒绝 |

真实变量在忽略的 .env.local，示例见 .env.example。不要提交或打印连接凭据。数据库文件 .local/postgres/data，端口55432，仅本机；图片 .local/uploads，私有业务凭证在其 .private-business 子目录，原有素材 public/assets。

备份：停网站和 worker，保持数据库运行，`npm run db:backup`。backups/时间目录同时保存数据库、图片及私有环境，需保护整个目录并备份源码/public/assets。恢复先用独立空库验证，步骤见技术文档；没有自动覆盖正式数据库的恢复功能。

## 验证命令

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:routes
npm run test:integration
npm run verify:restart
```

test:integration 只准备/重置带明确标记的 forme_operations_test，运行服务测试与真实HTTP测试；先关闭3002测试预览。测试账号和图片只在隔离环境，使用随机密码及合成顾客信息。test:operations 只跑服务套件；dev:test 打开独立测试预览；verify:restart 只读核对其记录和图片。orders:expire 单次释放过期订单，orders:worker 持续每60秒执行。

## 范围与后续

已接真实本地商品/首页、SKU双仓、不可售/预留、流水、调拨及附件、盘点审批、个人角色、库存/订单查询与CSV、访客订单快照、私有查询、开发模拟付款、整单发货和实物退货。购物袋仍保存在浏览器，结账由服务端重新验证。

尚未接真实付款/退款、优惠码、邮件、物流、顾客账号、部分发货、生产调度、MFA及公网保护。未来真实支付在 orders.ts 状态转换边界接签名验证、金额核对、唯一事件和对账；不复用公开模拟付款。让朋友通过互联网访问同样属于公网，必须先完成技术文档清单。

第三批新增成交快照查询、独立真实/测试经营统计、订单事件、工作日时限、售后及补偿审批。外部收款/退款仅登记已核实事实，审批不会自动转钱；退款与支出共用一笔现金事实。补发独立履约，使用现有墨尔本库存预留/发货，不新增销售。Deals 仅记录活动关联，不改变定价。没有优惠券引擎，相关申请不能标为已发券。

## 通知增强验证

`npm run test:notifications` 在标记为可丢弃的 forme_operations_test 数据库运行原有13组运营与通知场景，不写正式业务库。`npm run dev:test` 开3002隔离预览；预览运行后执行 `node scripts/notifications/http.mjs` 和 `node --conditions=react-server --import tsx scripts/operations/http.ts`。测试会重建隔离数据，不要把真实数据放入测试库。先停止3000开发预览再开测试预览，避免两个Next开发实例争写自动生成类型文件；完成后Control+C停测试预览，再运行 `npm run dev` 恢复主站。

通知任务单次运行 `npm run notifications:check`，常驻 `npm run notifications:worker`（与orders:worker同一任务）。已保存阈值保留；未配置的仓库默认关闭，商品资料提醒也先关闭，按操作手册明确开启。迁移使用 `npm run db:migrate`，不会重置数据。

## 采购、支出与物流验证

先关闭主站和测试预览，依次执行：

```sh
npm run test:business
npm run dev:test
```

另开终端（同样设置本地Node PATH）执行 `npm run test:business:http`、`npm run test:notifications:http`；原运营HTTP回归为 `node --conditions=react-server --import tsx scripts/operations/http.ts`。这些测试只使用带标记的隔离库，test:business 会重建隔离数据，绝不能把真实数据放进 forme_operations_test。

停测试预览后，可执行 `npm run db:stop`、`npm run db:start`、`npm run verify:business:restart`、`npm run verify:restart` 检查持久性，再用启动器恢复主站。所有私有测试凭据和报告留在忽略的 .local。

现有每分钟通知任务已包含循环义务生成、付款/结果/退款及物流补查。自动生成义务不会自动付款；物流签收不会自动验收；凭证只通过授权下载。尚未接真实银行/物流/服务商API，没有会计、税务或利润系统。

## 订单、统计与售后验证

先停止主站和3002测试预览。`test:sales` 包含前两批完整回归，仅重建有可丢弃标记的隔离测试库：

```sh
npm run test:sales
npm run dev:test
```

另开终端执行 `npm run test:sales:http`，以及上文原运营、通知和业务HTTP检查。测试样例、账号和证据仅存放在被忽略的 `.local`；不要把真实业务数据放入 `forme_operations_test`。停止测试预览后，`npm run db:stop`、`npm run db:start`、`npm run verify:sales:restart` 可核对订单事件、补偿、现金和凭证持久性。用 **Start Website.command** 恢复主站和任务。

订单时限共用现有每分钟任务；单次补查仍为 `npm run notifications:check`。电脑休眠或关机期间不执行，重新启动后按真实业务时间补查，不自动退款、发货或发送顾客消息。
