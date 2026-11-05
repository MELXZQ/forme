# 双仓、订单与安全说明

## 实现与数据

沿用 Node 24.22.2、Next 16.4.5、React 19.3.1、TypeScript 5.9.3、PostgreSQL 17.11、Prisma 7.10.1、Better Auth 1.7.17；锁文件决定精确依赖。本阶段不升级框架。页面/接口调用 src/server/operations 服务；数据库客户端在 src/server/db.ts，图片读写沿用 storage.ts/media.ts。

ProductVariant.stock 保留为只读旧值；LegacyStock 保存原始与待确认数量。迁移 003 把旧量登记为待确认，未自动建立仓库余额。迁移 004 增加实际退回北京记录。历史迁移不修改，不删除正式数据。seed 按稳定 ID 重复运行，不重置已确认旧量或仓库余额。

InventoryBalance 按 SKU+仓库唯一，available=onHand-reserved-unavailable。数据库 CHECK 保障整数、非负及预留+不可售≤实物。InventoryLedger、AuditLog、OperationCommand、订单快照和收货/退货历史不可由应用身份 UPDATE/DELETE；纠正需新事件。应用账号 forme_app 非超级用户、不能建库/建 schema、不能访问 Prisma 迁移凭据表；forme_migrator 专门迁移。bootstrap 只用于本机私有 socket 维护。

Transfer DRAFT→SENT→PARTIAL→CLOSED，只有 DRAFT 可 CANCELLED。sent−receivedSellable−receivedUnavailable−lost−returned 是待收；发出同时减少北京实物，实际收货减少在途且增加墨尔本实物。实际退回北京先进入不可售，避免未经检查直接销售。收货照片通过 Media 外键保留，不能删除在使用图片。

ShopOrder 保存金额、联系和地址，OrderLine 保存名称、SKU、分类/系列、原价/成交价/优惠、图片引用快照。AUD 最小单位整数；固定 AU 运费未配置为 null，禁止创建订单。StockReservation 使创建订单只增加 reserved；付款不扣实物；整单发货同时扣 onHand 与 reserved。失败/超时/取消释放一次。迟到付款进入 REVIEW，人工核查。退货增加实际验收实物，退款记录保持 0；没有真实退款接口。

公开商品只包含上架、启用分类和启用 SKU；库存仅墨尔本可售数量。四种状态由服务器批量读取余额、正常在途和策略推导，北京仅影响状态，不返回数量。过去的 ETA 被隐藏，运输异常不作为正常补货。禁用运营开关不会恢复旧 stock 语义。

## 并发与权限

关键写入走 PostgreSQL 事务，按 operation key、单据、SKU 获取参数化 transaction advisory locks。多 SKU 按稳定 ID 顺序锁定。OperationCommand 持久保存作用域+key、输入指纹、操作人及结果；同操作重试返回原结果，换内容/操作人冲突返回 409。写入业务余额、单据和流水在同一事务，错误整体回滚。数据库约束作为第二层防线。

Better Auth 成熟密码哈希和数据库会话；每次请求重新检查 active/role，变更权限撤销会话，最后有效 owner 受保护。兼容角色 admin=Owner，warehouse=Melbourne，viewer=库存只读。仓管不读取北京余额/价格/邮箱，不允许账号管理、损失确认、库存直接调整、批准盘点或顾客 CSV。订单、收货照片和订单图片执行对象范围授权。

写接口要求可信 Origin，认证接口由 Better Auth 处理；Cookie HttpOnly/SameSite=Lax，生产使用 Secure。公开注册及未使用认证端点关闭。登录失败限流和访客路径限流仅为单进程本地保护，不能称为分布式保护。输入用 Zod 和业务校验；输出文本由 React 转义；CSV 中空白前缀后的 = + - @ 也转义。图片检查真实内容并重编码，限制大小/数量/像素，服务器命名，拒绝 SVG 和伪装 MIME。统一存储目录与源码分离。

订单查询使用随机 32 字节令牌，仅哈希存数据库，30 天有效；创建订单只返回 ID/单号并设置私有 Cookie，专用私有链接通过 fragment 交换 Cookie，清除 fragment。禁止将令牌写入 URL 查询、日志或分析工具。服务错误只返回可操作的短信息；服务端日志不打印凭据/请求体。Next 请求 URL 与函数参数日志关闭。

## 运行与维护

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm run db:start
npm run db:generate
npm run db:migrate
npm run db:seed
npm run admin:create
npm run dev
# 另一个终端：
npm run orders:worker
```

初次没有 .env.local 时才执行 db:setup 生成本地随机凭据。保留现有环境不要覆盖。Prisma 使用 DIRECT_URL 迁移；运行应用使用 DATABASE_URL。SHADOW_DATABASE_URL 仅开发迁移。BETTER_AUTH_URL 是本机3000；BETTER_AUTH_SECRET 仅在私有环境；STORAGE_DIR 默认 .local/uploads；POSTGRES_BIN 指向已有 Homebrew17；ENABLE_OPERATIONS=true 开启运营接口；ENABLE_DEV_PAYMENTS=true 仅在 development/test 且 Owner 登录时允许模拟，NODE_ENV=production 无条件拒绝。

orders:worker 启动即执行，之后每60秒扫描过期 pending，批量200；订单锁避免与付款/发货争抢。orders:expire 只执行一次。未来生产需要外部可靠调度/常驻进程监控、失败告警和补偿机制，不能依赖访问页面。机器休眠意味着任务暂停。

测试：npm test；npm run typecheck；npm run lint；npm run build；npm run verify:routes。npm run test:integration 自动准备带明确 disposable 标记的 forme_operations_test、重置该测试库、seed、跑服务测试、启动3002再跑 HTTP 测试并关闭；3002 已占用时拒绝，先停止测试预览。正式 forme_dev 不重置。test:operations 仅跑独立服务套件；dev:test 用私有测试环境打开3002做人工检查。verify:restart 只读取测试持久化记录和媒体，不改数据。测试密码随机生成且仅存忽略的 .local/operations-qa.json；不用于正式管理。

数据库数据 .local/postgres/data，端口55432，仅127.0.0.1；媒体 .local/uploads；本地环境 .env.local。备份时停网站及worker、保持DB运行，npm run db:backup。复制整个备份目录与 public/assets、源码、锁文件和迁移。恢复应使用同大版本 pg_restore，在新建且确认空的隔离数据库中，以迁移账号执行 `pg_restore --no-owner --exit-on-error --dbname=目标库 database.dump`；连接密码由本地安全环境提供，不写命令行/README。复制备份 uploads 到新的私有存储目录，临时环境指向新库和新目录，检查迁移版本、记录数量、权限、媒体与订单后，再由所有者决定切换。不得对正式库使用 --clean 或自动覆盖。本次重启持久性检查不等同于完成全量备份恢复演练。

## 局限与公网前清单

当前仅本机。库存/订单筛选适合小规模目录，部分聚合在服务端内存完成，导出限5000；大规模上线前改数据库分页/聚合并加索引和负载测试。pg8/Prisma7 在多明细事务测试出现 query 队列弃用提示；现有测试通过，尚未升级依赖，未来升级需复测并发。

已实现：服务端身份/角色/对象授权、会话撤销、输入/上传校验、最小权限、事务锁、持久幂等、不可改写历史、快照、CSRF来源校验、私有令牌、日志脱敏。

公网开放前必做（让朋友远程使用同样算公网）：

- HTTPS、真实域名可信来源、Secure Cookie 和生产配置检查。
- 网络访问控制，数据库不公开；密钥管理和轮换。
- 可靠共享限流、登录防爆破、管理员 MFA 与账号恢复流程。
- 自动加密备份、异地副本、实测恢复演练与保留策略。
- 错误、预留释放、支付对账、库存异常告警和持续任务监控。
- 并发/负载、访问控制、供应链及隐私审查；线上日志清除令牌和不必要顾客信息。

本次不部署公网，不建隧道。真实支付后续在 orders.ts 的付款状态转换边界接入签名验证、金额/币种核对、唯一事件和对账，不能直接暴露模拟接口。邮件在事务提交后通过持久任务发送私有查询链接。物流当前人工登记追踪；部分发货、退款、优惠码、顾客账户、MFA、可靠分布式限流与生产调度未实现。
