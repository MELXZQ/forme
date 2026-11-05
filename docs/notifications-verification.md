# 通知增强：实现与验收记录

日期：2026-11-05 至 2026-11-06，本地 Mac。验收数据仅在标记为可丢弃的 `forme_operations_test`，真实业务库未用作测试夹具。

## 复用与新增

沿用 Node24.22.2、npm11.19.1、Next16.4.5、React19.3.1、TypeScript5.9.3、PostgreSQL17.11、Prisma7.10.1、Better Auth1.7.17。无依赖升级，无新Redis/外部队列/CMS/云服务。

复用 Better Auth 会话、Owner/仓管/只读角色、服务端权限与来源验证、OperationCommand 幂等事务、库存账本、调拨/收货/退回、AuditLog、本地预留释放进程及既有后台样式。前台设计、购物流程和库存定义没有重建。

新增模块：

| 位置 | 职责 |
| --- | --- |
| `src/server/notifications/service.ts` | 授权列表/详情、个人已读确认、处理、置顶与版本校验 |
| `access.ts` / `validation.ts` | 业务权限交集、快照脱敏、内部路径白名单、严格输入 |
| `rules.ts` | 仓库默认/单SKU/批量策略、商品检查范围、默认人员、任务状态 |
| `engine.ts` | 扫描真实库存、商品资料、调拨事件及异常；去重、修订、自动解决 |
| `time.ts` | IANA时区日期边界及夏令时 |
| `schedule.ts` | 请求成功后的及时检查；失败交由持久任务补跑 |
| `src/app/api/notifications/[[...path]]/route.ts` | 受保护的HTTP入口，无缓存错误响应 |
| `src/components/notifications` | 通知中心、规则/执行状态、库存批量预览、商品范围工具 |

`/admin` 登录后默认进入 `/admin/notifications`；原商品和首页编辑保留 `/admin?catalogue=1`。Stock 页面增加阈值工具；Catalogue 产品列表和规则页均可管理资料检查范围。

## 数据与迁移

新增已应用迁移 `202611050005_notifications`、`202611050006_notification_baseline`，未改写既有迁移或重置正式库。

- Notification：issueKey+cycle唯一；部分唯一索引保证同一持续问题只有一个活动周期。
- NotificationRevision / Receipt / History：版本、每人每版READ/ACK、操作历史；运行账号不能UPDATE/DELETE这些历史表。
- StockAlertPolicy：warehouse+variantId，INHERIT/CUSTOM/OFF。SQL和输入双重约束非负整数，0与NULL明确区分。
- ProductCheckPolicy：INHERIT/ON/OFF。全局开关、纳入时间和新商品默认独立控制；明确纳入已有商品时保存ON，独立OFF保留。
- NotificationRuleSettings：规则版本及人员配置；触发通知保存规则快照。installedAt作为正常信息事件回溯起点，安装前的旧进度不一次刷屏；持续业务异常仍按当前状态检查。
- NotificationPreference：个人Melbourne/Beijing选择。
- NotificationJob / JobRun：持久变更序号、已完成号、最后成功/错误、只追加运行记录。

按用户确认迁移已保存的旧SkuPolicy阈值为墨尔本CUSTOM，取消未配置时隐含阈值3。正式库检查时没有已保存阈值，因此两仓默认为NULL、商品总开关false。原16商品/16SKU和160件待确认旧库存保持不变。

迁移前备份 `backups/2026-11-05T15-20-33-343Z`；迁移后备份 `backups/2026-11-05T16-04-21-953Z`。均包含数据库、上传图片和私有环境文件，不应提交Git或公开分享。

## 可靠执行及并发

业务表和规则表的数据库触发器在同一业务事务中递增待检查序号。写入提交但即时检查失败时，序号仍存在；扫描成功才提交completed。扫描失败整体回滚，另写脱敏错误记录。每分钟检查同时覆盖纯时间变化（如ETA到期）。

沿用 `scripts/operations/expire.ts --watch`，先处理订单预留释放，再处理通知；前者失败不妨碍通知尝试。`orders:worker` 与 `notifications:worker` 是同一程序的命令别名。启动时补查，之后每60秒；无需打开页面。

数据库事务 advisory lock 对扫描并发去重；确认、置顶/取消和重大修订共用锁，先验证当前版本再写记录。READ/ACK复合唯一索引与请求幂等号防重复。手动检查限10秒，普通重复执行返回busy/skipped。

状态页通过数据库活动锁显示运行中，同时显示待处理版本、最近成功/失败、超过3分钟未检查提示、最近20次结果。无法仅凭“最近成功”保证电脑仍开机，因此页面明确说明本地关闭/休眠不实时提醒。

持续问题手动关闭采用“忽略当前周期”；条件恢复后关闭活动周期，再发生才创建新周期。重大数量/截止日期/建议变化创建修订，重新要求确认；普通刷新不清除确认。系统异常仍需处理结果才能解除置顶。

## 实际通过

- `npm test`：8个单元测试，包括上架必填、价格/规格、实际图片类型、库存状态、请求校验、CSV保护。
- `npm run test:notifications`：13组既有运营服务测试、9组通知验收、1组补货建议组合验收。
- 通知服务：个人已读/确认隔离、两人全部确认门槛、异常解决门槛、停用人员明确重分配与历史、版本过期拒绝、并发确认/取消/扫描、恢复和复发新周期、手动忽略、规则停用、0阈值、默认不覆盖自定义、跨分页预览。
- 时间：墨尔本23小时与25小时日期、北京/墨尔本跨日，旧通知更新不算今天、历史日期与今天+置顶去重。
- 商品：仅未来新增不检查旧商品，明确纳入生成共享汇总，补齐后自动解决；现有上架校验独立通过。
- 物流：正常部分收货显示4件待收，不生成货损；ETA改期保留前后审计并结束旧逾期；再次逾期新周期；收齐解决逾期，货损独立置顶；文案不冒充实际物流状态。
- 补货：北京有货建议调拨、在途足够建议跟进、无货源联系供应商、两仓缺货升级、北京缺货联系供应商。
- `node scripts/notifications/http.mjs`：未登录401、规则/库存批量权限403、无权详情404、跨站403、非法日期/时区/筛选400、个人时区保存、代别人确认拒绝、旧版本409。
- `node --conditions=react-server --import tsx scripts/operations/http.ts`：原有5组实际HTTP回归，包括商品图片/草稿上架/筛选归档、访客下单与权限、价格快照、会话撤销与退出。
- 实际停止并重新启动PostgreSQL后，用新进程补查持久变更：通知/确认/修订数量不重复，任务完成号追上请求号；订单、库存账本、商品和上传图片持久化检查通过。
- `npm run build`、`npm run typecheck`、`npm run lint` 通过。
- 浏览器实际登录/退出、通知详情确认后显示Confirmed、阈值预览显示“MELBOURNE · 1 SKUs · CUSTOM 5”、保存成功、手动检查显示Check completed、商品检查列表加载；正式商城首页在390px手机宽度下轮播切换到第2张、导航和购物袋入口保留。截屏位于 `docs/screenshots/notifications-*.png`。

本轮修复了测试站和主站并行开发导致的生成类型文件刷新冲突（验收时顺序运行，README已说明），以及库存工具和筛选表单同级React key重复、北京低库存计数误用墨尔本量、旧SKU详情隐含3阈值、快速切换通知时的旧请求覆盖等问题。

## 重跑与启动

正常启动见 [README](../README.md)；日常操作见 [通知中心手册](notifications-manual.md)。`npm run notifications:check` 单次检查；常驻只开一个 `npm run notifications:worker`，或用 `Start Website.command` 一并启动。

完整验证顺序：停止主站开发预览 → `npm run test:notifications` → `npm run dev:test` → 另一终端运行两份HTTP检查。不要让3000和3002两个开发进程同时争写生成文件。结束隔离预览后恢复主站。

重启验收脚本：隔离库准备后，`node --conditions=react-server --import tsx scripts/notifications/restart.ts prepare`；停止应用并执行 `npm run db:stop`、`npm run db:start`；然后运行相同脚本的 `verify`，再 `npm run verify:restart`。这些脚本校验测试库名称，不应改成正式库连接。

## 限制与后续

没有邮件/短信/物流API/eBay/采购财务/公网部署，不能把本地通知描述为外部推送。电脑睡眠无法实时运行；真正整机休眠再唤醒未实测，已验证等效的应用/数据库进程重启及持久任务恢复。没有执行高负载/多台机器生产压测；全量扫描与内存授权过滤适合当前小规模本地数据，数据量增长时应改数据库分页查询、分批扫描与归档展示策略（不删除审计）。

现有pg8适配器偶尔输出排队查询弃用警告，所有校验通过；没有为消除提示升级到pg9。角色范围沿用现有系统，跨仓规则只授权Owner管理。后续订单事件可在现有事务与Notification类型/规则中扩展，无需再建通知系统。
