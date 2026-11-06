# 第三批后台技术说明

沿用Node24.22.2、npm11.19.1、Next16.4.5、React19.3.1、TypeScript5.9.3、PostgreSQL17.11、Prisma7.10.1和BetterAuth1.7.17。无新依赖、服务、任务框架、云存储或额外订单系统。

## 结构与迁移

- `src/server/sales/events.ts`：既有审计事务追加订单事件；精确最大余数分摊。
- `queries.ts / access.ts`：成交快照组合查询、全结果汇总、分页/导出、个人筛选、对象权限、详情。
- `analytics.ts`：事件时间归属、批次退款、维度/价格区间、前期对比、缺货时段和CSV。
- `workflows.ts`：人工收款/地址/送达、售后、审批、退款登记、独立补发、活动关联。
- `timeouts.ts`：规则版本、日历、暂停、既有通知扫描器的Issue来源。
- `dashboard.ts`：业务对象聚合待办＋原通知列表。`/admin/sales`和`/api/sales/[[...path]]`使用原会话；所有响应no-store，写入同源校验。

新增迁移`202611060002_sales`、`202611060003_sales_query_indexes`，总计9份。只新增字段、表、约束、索引、通知脏标记触发器及追加历史权限，不删除或重算业务。`ShopOrder/OrderLine`继续唯一订单来源。新增OrderEvent、DealCampaign、SavedOrderFilter、AftercareCase、Compensation、OrderRefund、ReplacementShipment、OrderTimeoutRule、OrderTimer、OrderTimerPause。业务凭证复用BusinessAttachment私有存储，退款复用Expense/CashRecord，包裹复用Parcel，库存复用Balance/InventoryLedger。

无新增必填环境变量。新规则不seed成启用；原seed可重复执行，只按稳定标识补齐。正式库16个SKU、160件LegacyStock仍待确认，不自动计入两仓。增量前已做本地完整备份；迁移不依赖破坏性reset。

## 事件和成交快照

OrderEvent包含稳定ID、唯一eventKey、订单及对象、类型/source/dataKind、实际occurredAt（可未知）/recordedAt、操作者、金额及必要前后值。原AuditLog内调用事件捕获，业务更改、库存和审计/事件共事务。创建、预留/释放、付款成功/失败/待核实、取消、整单发货、送达、售后和补偿都有事件。OrderEvent/OrderRefund/规则版本/暂停历史对forme_app撤销UPDATE、DELETE。

新订单snapshotVersion=2，冻结产品/SKU/名称/规格/分类/系列、图片引用、成交单价/数量/金额/币种、活动ID/名称/版本及区间。地址变更另留前后审计，不改成交价格。Guest响应没有新增内部业务备注。

旧`discountCents/originalUnitCents`继续表示划线参考价差，避免破坏原前台/接口。新`actualDiscountCents`区分实际优惠；现有定价没有结账优惠，因此新订单为0、pricingBasis=LIST_PRICE_NO_APPLIED_DISCOUNT。旧记录为null/LEGACY_REFERENCE_DIFFERENCE，不能解释成已知0。旧dataKind=UNKNOWN，旧事件、付款时间、优惠和活动归因不回填。未找到可靠来源时明确未知。

Deals只是显式活动关联：创建新订单时选当时启用且在时间范围内的SKU关联，保留多个活动的快照。不会按当前是否划线优惠反推历史，不修改现有定价引擎。

金额全部整数分；`allocate`使用BigInt乘除、固定最大余数法，同余按原明细顺序，分摊和恰好等于整单值。当前没有新增折扣引擎，只预留这个经测试的统一分摊点。首次全额退款可可靠分摊商品明细；部分退款或已有退款后不能可靠归因时保留未分摊，不把整单退款任意塞入SKU。

## 查询与统计公式

Prisma参数化服务端查询。SKU/产品/历史分类/JSON系列活动使用`lines.some`筛订单，独立OrderLine聚合匹配明细，不靠多表join复制整单。数据库排序后加id稳定并列顺序，分页25默认/100上限；导出最多5000单。默认最小导出，无顾客地址，额外授权才导邮箱及收件人。CSV公式前缀转义、附件响应no-store，无公开下载地址，导出写审计及筛选。

日期范围使用指定IANA时区当天开始到次日开始的半开区间；墨尔本夏令时可为23/25小时。规则自然日/工作日以本地日期推进；假日手动配置，不伪造公共日历。

- 付款期订单：PAYMENT_SUCCEEDED事件实际occurredAt在范围内，dataKind匹配、AUD、去重orderId。TEST/UNKNOWN/未核实默认不入REAL。单次支持最多10000付款事件、3年区间，超过明确拒绝并要求缩小。
- 件数/商品成交额：匹配明细quantity/lineTotalCents之和；退款前，不自动负销量。
- 运费/实收：包含匹配明细的去重整单shippingCents/可靠付款事件金额。平均订单额=实收/订单数。
- 退款：OrderRefund.occurredAt归属本期，必须有实际确认事实；跨期退款只改变退款期现金净额。净额=本期实收－本期退款，不是利润。
- 批次退款：上述付款期订单截至asOf本地日结束的退款总额，和当期现金退款独立。
- 排名：SKU/产品/分类/系列/活动/成交单价区间；系列/活动允许重叠，总额保持去重。单价区间以件计销量，订单应付区间以订单计分布；边界[0,50)、[50,100)、[100,200)、[200,+∞) AUD。
- 前期：向前等长实际毫秒窗口，显示明确起止；0基数返回null。活动对比按当前活动版本及同SKU集合、等长前/中/后窗口，不宣称因果或转化率；每个窗口最多3年，未来尚未发生的窗口略过。
- 耗时：已完成且完成时间早于asOf的记录；另计截至asOf未完成数量。当前逾期只取活动发货/送达计时器且排除有效暂停，明确不是历史asOf逾期回放。
- 缺货：按墨尔本不可变流水中可售<=0的区间截取报告范围，起点为首条可靠流水；没有流水不回推。超过50000条历史显示限制，要求缩小。

JSON系列/活动快照增加GIN pathops索引；订单日期/dataKind、SKU/商品分类、事件类型/时间、开放售后期限及补偿状态按实际查询加索引。报告在服务端批量读取、有界计算，未引入数据仓库。不是无限数据量或生产负载测试结论。

## 状态、权限和并发

沿用admin（Owner）、warehouse（墨尔本）、viewer及现有BusinessGrant。未登录401；权限403；不可见订单404。仓管订单域为已付款、未取消，默认无收入汇总/邮箱导出；售后为分配给自己的或aftercare授权对象。经营统计orderStats、导出orderExport、顾客字段customerExport各自授权，退款证据仍Owner限定；关闭/撤权沿用原会话检查。

售后状态独立订单/付款/履约；关闭需结果且无SUBMITTED/APPROVED/EXECUTING/FAILED补偿。RESPONSE记录首次响应；草稿、内部备注、人工沟通记录区分，绝不调用发送服务。活动售后可改负责人/期限并版本校验；闭合需REOPEN。

补偿DRAFT→SUBMITTED→APPROVED或REJECTED；批准后可执行、FAIL、CANCEL；实际成功才COMPLETED。修改批准内容回SUBMITTED并清空批准。只有一个有效Owner允许显式selfApproved；多个Owner时拒绝申请人自批。金额批准与外部退款固定Owner，其他执行按独立grant/分配校验。TEST售后不能对REAL订单申请补偿。

`command(scope,key,actor,fingerprint)`复用原幂等表，同key同内容重试返回原结果，不同操作者/内容冲突。变更先以`order:<id>`做PG事务 advisory lock，再读版本和额度，杜绝两个不同请求并发超额。退款可用额=可靠实收－已登记退款－其他APPROVED/EXECUTING/FAILED申请额，审批和执行均复核；运费退款另校验运费剩余额度。FAIL不释放，CANCEL释放。唯一退款reference、compensationId、cashId防止重复登记。

外部退款验证实际时间、渠道、唯一参考号和受保护证据；一次事务创建一笔Expense、一笔CashRecord(PAYMENT/CONFIRMED向外付款)、OrderRefund及事件，OrderRefund.cashId引用同一资金事实。第二批费用系统拒绝普通编辑/重录该关联顾客退款；不将同一现金从两个模块相加。不提供顾客退款事实的直接覆盖或专用冲正，后续需独立审计流程。

补发不是第二套订单。ReplacementShipment关联原订单/申请，先按SKU排序锁余额、校验墨尔本可售并reserved+；发货reserved-、onHand-、流水、独立REPLACEMENT Parcel与完成状态同事务；唯一申请/包裹防重复。缺货回滚整个事务，不留下假记录；取消未发预留释放，已发拒绝取消。无销售/收款事件。实物退货继续原验收服务，独立资金。

## 计时与待办

新增5种OrderTimeoutRule，kind/version唯一且追加保存。SHIPMENT从paidAt；DELIVERY从预计送达本地日期；FIRST_RESPONSE从售后实际时间；CASE_RESOLUTION/COMPENSATION从各自业务期限。到目标本地日期末；工作日跳过自选周末/假日。已结束/不适用对象排除。仅整单履约。

FUTURE只影响新计时器；现有timer保留规则版本；显式RECALCULATE更新活动timer规则/期限并加回所有暂停。业务起点/期限变化会按当前版本重算并留审计。暂停需原因和截止，每次14天、合计30天、不可重叠；不更改业务本身状态。所有规则扫描共用原notification-scan锁/任务。有效暂停不触发超时筛选或通知。

Issue以timer稳定ID为key，接入原通知生命周期、多人确认、material版本、不可随意解置顶、解决及再次异常周期。规则保存保留触发快照和责任路由。任务每60秒运行；休眠后补查，失败沿用原job状态与系统待办。没有新调度框架或生产分布式保证。

Dashboard不存第二份任务状态：查询订单/售后/补偿/调拨/采购/支出与原活跃通知，按来源+对象合并，查询时即随业务更新。“今天＋置顶”仍调用原通知服务；阅读/确认不改变业务完成状态。

## 运行、验证与未来接口

见[README](../README.md)命令；`test:sales`依次执行三批服务回归，`test:sales:http`执行3002实际接口检查，`verify:sales:restart`验证重启后持久性与补查幂等。仅允许有标记的forme_operations_test；本地凭据/报告/附件不入Git。

备份沿用`db:backup`覆盖PG、上传和私有环境；恢复先在独立空库验证，不能直接重置正式库。真实PG和图片目录见README。

后续支付：在现有订单锁/唯一支付事件/库存预留边界接签名、金额/币种核对、晚到付款人工核实和对账；外部退款接Compensation批准后的执行器，用提供方唯一ID和确认后事件写入；物流接Parcel来源标记和可靠实际时间；优惠券接真正结账可验证引擎后才允许完成。保留现有权限和审计，不放开模拟付款作为生产入口。
