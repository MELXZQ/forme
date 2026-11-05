# 第二批业务模块技术说明

保留 Next.js16.4.5、React19.3.1、TypeScript5.9.3、Prisma7.10.1、Better Auth1.7.17、PostgreSQL17.11；Node24.22.2/npm11.19.1。精确解析版本以 package-lock.json 为准。本次未更换认证、数据库、存储或依赖大版本。

## 模型与边界

增量迁移 `202611060001_business`（第7份迁移）新增业务表、数量/金额约束、唯一键、通知脏标记触发器与运行账号不可修改/删除历史记录的权限。正式库原16个SKU及160件待确认旧库存不分配、不重置。

Supplier / SupplierSku 表达多来源；Purchase / PurchaseLine 保存供应商和商品SKU快照及约定；PurchaseReceipt / lines 保存验收；SupplierReturn / lines 保存发出退供应商及后续责任。Expense 是义务，CashRecord 是独立实付、退款或冲正，ExpenseLink 是关联且不形成第二金额来源；RecurringExpense 为规则，Expense 的 recurringId+cycle 为每期唯一键。Parcel / ParcelLine / ParcelEvent 关联既有采购、调拨、订单或退货，不取代原运营模型。BusinessAttachment 为私有证据，BusinessGrant 为已有员工附加能力，不创建另一套用户/会话。

领域服务集中在 `src/server/business/`；`common.ts` 为权限、校验、金额/现金口径；purchases/expenses/recurring/logistics 为命令；queries 为授权读模型和CSV；attachments 为私有存储；notifications 输出原通知引擎需要的事项。`/api/business/[[...path]]` 统一认证、来源校验、错误响应与写后补查；`/admin/business` 使用这些服务。服务日志不返回连接或堆栈给客户端。

## 数量、金额、日期

每采购行 remaining = quantity + replacementQty − receivedSellable − receivedUnavailable − cancelledQty − shortClosedQty。returnedQty 单独累计，退货只有选择 REPLACEMENT 才增加补发承诺；退款与退货不自动互相推导。先分配包裹再验收，禁止超出未履行数量。库存复用 `operations/core` 的余额与流水服务。

AUD/CNY/USD/EUR/GBP 均以2位最小货币单位整数保存，单次/总额上限10亿分；SKU数量为非负有界整数。汇率以百万分之一精度整数保存；报告金额使用 BigInt 乘法及半入舍入，再检查范围。缺少汇率返回null并单独计数；采购总额修订清除已过时的换算快照。

现金 CONFIRMED 且非 TEST 才参与真实余额；被冲正原记录不再影响当前净额，但日期现金流在原发生日和冲正发生日分别反映。费用义务、实付、退款、运输和服务/收货结果是不同维度。采购状态 DRAFT/CONFIRMED/CLOSED/CANCELLED，进度由数量推导；来源和结果状态不当作外部真实回执。

实际事件存UTC时间，业务应付/周期日为 date，时区显式北京或墨尔本。循环按原始锚点计算月末/闰日，不迭代前次截断日期；初次或恢复从明确日期选择周期，历史须有范围的预览补建。每次普通扫描每规则最多补50期，下一扫描接续；显式历史补建最多100期，唯一键保证重试安全。

## 一致性与权限

复用现有 command 幂等记录、事务、审计、advisory locks、库存行保护及版本检查。采购修改按采购→关联支出顺序加锁，收付款持有支出锁；收货同时写验收、进度、库存及脏标记。验收唯一 purchaseId+reference，采购页/包裹页共用 receivePurchase。现金唯一 expenseId+reference+kind；冲正 original 唯一。包裹事件唯一 parcelId+source+reference。循环与通知共享扫描锁及唯一业务周期/事件键；同一迟到采购跨页面共享主要事项。

Better Auth 会话沿用 HttpOnly/SameSite 配置；每个写操作要求同源，服务端认证/权限/结构校验，事务内校验当前状态。Owner全权，仓管默认成本隔离，附加能力由Owner授予，Viewer不写。采购验收的安全读模型不返回采购价、供应商联系方式或账户。财务证据按所属对象授权，每次下载重新校验，不通过公开媒体路由。

凭证统一本地存储，`STORAGE_DIR/.private-business`，UUID文件名，目录0700、文件0600。真实内容经Sharp解码为JPEG/PNG/WebP允许类型后重编码，8MB/文件、5文件/请求、20文件/对象；不支持SVG/PDF。先校验全部文件，再写文件及事务元数据，失败清理新文件；无公开删除接口。下载 attachment、no-store、nosniff 和sandbox CSP。多实例/对象存储替换尚未实现。

## 任务和未来接入

原 `operations/expire.ts --watch` 每分钟调用通知扫描；scanner在同一机制中生成循环支出、付款/结果/退款检查并记录最后成功、范围、错误。数据库脏标记支持写后补查，定时扫描覆盖停机。无银行或物流请求、邮件发送、自动真实收款。

未来支付对账接 `expenses.recordCash`：外部签名验证、可信币种/金额、事件唯一键及人工冲正流程需在接真实API时实现。未来承运商接 `logistics.transportEvent` 的统一状态/事件入口，不能在回调直接修改库存；实际收货继续走同一采购/调拨/订单服务。正式订单库存预留及支付接点仍见原 operations 技术文档。

## 当前限制

面向本地小规模数据，业务列表先授权获取后内存组合筛选/分页，选择器最多最近200条；尚未做大数据性能验证、分布式任务/登录限制或公网安全运维。统一物流会同时展示既有业务汇总行与新包裹行，不能把两者数量相加。原订单整单发货语义保留，顾客退回和供应商退回包裹引用已经登记的实物操作，不提前实现第三批退货补偿。无多币种自动结算、PDF凭证、会计/税务/利润系统。备份脚本含私有证据，Git上传排除数据与密钥。
