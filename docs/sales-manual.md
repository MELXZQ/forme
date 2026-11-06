# 订单、统计、售后与综合待办操作手册

入口：[综合待办](http://127.0.0.1:3000/admin)、[Orders & care](http://127.0.0.1:3000/admin/sales)。沿用原管理员个人账号。页面按钮保持英文，以下按实际名称说明。

本机没有连接支付、银行、承运商、邮件或 eBay。人工登记必须依据实际核实结果；按钮不会替你收钱、退款、发邮件或通知承运商。不要在真实库添加合成资金样本。测试使用独立的 `forme_operations_test` 和3002预览。

## 查询订单与保存筛选

打开 **Advanced orders → Filters · saved in the page URL**。组合选择订单号、访客邮箱/收件人、追踪号、付款参考号、历史商品/SKU/尺码/颜色/分类/系列、状态、金额、活动和配送条件，按 **Apply filters**。

- **Date basis** 明确使用 created、paid、shipped、delivered、cancelled 或 refunded；**Filter timezone** 可选 Australia/Melbourne、Asia/Shanghai。起止日包含完整当地日期，处理夏令时。Last day / Last 7 days / Last 30 days 是滚动日期范围。
- 历史商品条件使用成交快照；商品后来改名、改价、换分类或归档不会改写订单。访客邮箱只是联系方式，不表示已验证账户；没有未实现的账户ID或优惠码筛选。
- **Amount basis**：merchandise 商品成交额；payable 应付；received 有已核实成功付款事件的整单实收；discount 实际应用优惠；refunded 已登记退款。当前只收整单款，received 不支持虚构部分收款。金额筛选明确以整数澳分输入，如1000代表AUD10。
- **Reference-price offer** 查成交时参考价展示；它不等于实际优惠。旧订单缺少真实优惠信息时显示 Unknown。
- 页面汇总覆盖全部匹配结果。**All matching orders** 每单只计一次；**Matching merchandise only** 只计匹配明细。SKU筛选可能匹配整单的一部分，两者金额不同是正常的。
- **Previous / Next** 分页；地址栏保存筛选、日期口径及时区，支持刷新和浏览器前后退。点单个条件的 × 清除该项，**Clear all** 清空。
- **My saved filters → Filter name / Reason / Save personal filter** 保存自己的常用筛选；点名称恢复，**Remove** 删除个人筛选，不影响他人。
- **Export minimal CSV** 默认无邮箱、完整地址；另有权限才显示 **Export with authorized customer contact fields**（邮箱、收件人）。导出包含筛选/时间口径/数据视图，金额为整数澳分，最多5000单。统计导出最多10000个付款事件；超限需缩小范围。

**Open** 打开详情：冻结商品明细、应付/退款、地址、预留及流水、包裹、售后/补偿/关联支出、通知和 **Business timeline**。NOTE 为内部备注；不会出现在顾客接口。

所有者 **ADDRESS** 修改地址时保留前后值。已发货后改数据库地址并不表示承运商已改址。已付款订单没有直接覆盖成交价或数量的入口。原发货、实物退货仍通过 **Existing whole-order shipping / physical returns** 进入旧履约模块；只支持整单发货。

## 经营统计与 Deals

打开 **Sales & cash**，选择 From、Through、Cohort refund cutoff、Report timezone、Trend interval，按 **Apply filters**。默认 REAL，仅统计有可靠成功付款事件的真实记录；TEST 为独立测试视图。UNKNOWN 历史已付款记录显示缺失数量，不悄悄补入收入。

| 指标 | 含义 |
|---|---|
| orders / units | 付款期内去重订单数 / 匹配成交明细件数 |
| merchandise | 匹配商品实际成交额，退款前 |
| discount | 已知实际应用优惠；参考价差不算；未知单独计数 |
| shipping / received | 包含匹配商品的整单已收运费 / 已核实收款，整单去重 |
| refunded | 本期实际确认退款，归属于退款发生日 |
| net | 本期收款减本期退款，不是利润 |
| average Order | 整单实收 / 成功付款单数 |
| Payment cohort | 本期付款的订单，截至指定截止日累计退款 |

现有结账无单独税额，不虚构税费。所有统计当前只支持AUD。

趋势按日、周（周一开始）、月显示。收款与退款是不同链接，各自打开对应日期口径的订单。商品、SKU、分类、系列、活动排名可打开匹配订单；统计与导出使用同一数据口径。订单区间按单计数，单价区间按件数/明细金额；区间为 `[0,50)`、`[50,100)`、`[100,200)`、`[200,+∞)` 澳元，不重叠。

系列和活动允许一条明细关联多个，**这些分组不能直接相加**；总额始终去重。部分退款没有可靠逐行归因时显示未分摊，不随意扣减某SKU或销量。发货/送达平均耗时列出完成样本数；未完成按截止日，逾期显示当前活动发货/送达计时器，暂停期间排除。缺货时长仅从首条可靠墨尔本库存流水开始。前期对比采用等长实际时间区间；前期为0显示无基数。

**Deals associations → New Deals association** 可记录活动名称、开始/结束时间、SKU、启用状态和说明。新订单保存当时匹配活动的ID、名称和版本；不改变任何定价、叠加或折扣。编辑活动不改变历史快照。选择活动后的前/中/后对比使用当前活动版本及同一SKU集合、等长窗口（单个窗口最多3年，尚未发生的窗口不展示）。这是“活动关联销售”，不代表活动带来的新增销售；没有访问量，不展示转化率或ROI。

## 超时规则

**Order timeout rules → New timeout rule**；已有规则点 **Open** 编辑，保存形成新版本。默认没有启用任何新规则。

| Timer starts from | 起点 / 结束条件 |
|---|---|
| SHIPMENT | 成功付款 / 整单发货或取消 |
| DELIVERY | 人工填写的预计送达日 / 登记送达或取消 |
| FIRST_RESPONSE | 售后实际发生时间 / 首次 RESPONSE 或事项结束 |
| CASE_RESOLUTION | 售后 Handling deadline / 事项解决或关闭 |
| COMPENSATION | 已批准补偿的 Execution deadline / 完成、拒绝或取消 |

填 **Days after start**、CALENDAR/BUSINESS、时区、周末和逐行假日日期。0天表示起点当地日期结束时到期，1天表示推后1个相应日期并到当日结束。系统没有自动澳洲公共假日日历。配送范围当前为已有 STANDARD_AU。

选择负责人、Recipients、Required confirmers、等级、Automatically pin exceptions、升级天数。测试默认不参与；勾选 **Include TEST orders** 才用于调试。FUTURE 保留已存在计时器的规则快照；RECALCULATE 明确重算活动计时器并保留已登记暂停时长。关闭规则会结束活动条件，不抹掉历史通知/确认。

订单详情 **Timeouts and finite pauses** 选择计时器行的 **Open**，再填写暂停截止时间和原因保存；需要规则权限。每次最多14天，累计最多30天，不能重叠。暂停只暂停异常提醒并顺延期限，仍记录总等待和暂停时长。不要通过暂停掩盖业务结果。**ETA** 登记预计送达；**DELIVERED** 只登记已核实的实际送达时间及依据。没有物流API时文案为 delivery not recorded（未登记送达）。

超时只生成待办和通知，绝不自动退款或承诺赔偿。沿用原多人确认、置顶、版本及异常解决规则；“确认已知悉”不等于完成发货或售后。

## 售后与补偿

1. 订单 **New aftercare case**：选问题类型/来源、反馈摘要、可选明细/数量/包裹、负责人、优先级、期限及实际发生时间，按 **Save aftercare case**。发生时间不能早于订单创建，期限不能早于问题发生。
2. 售后详情用 **RESPONSE** 记录首次响应；**NOTE** 内部处理；**COMMUNICATION DRAFT** 保存草稿；**COMMUNICATION RECORDED** 登记已经人工完成的沟通。系统不会发送。**STATUS** 切换处理中、等待顾客/外部信息、待审批/执行、解决/关闭；关闭必须填结果，存在活动补偿时先处理补偿。**REOPEN** 保留历史并重新打开。
3. **Private evidence images → Upload private evidence** 上传JPEG/PNG/WebP；每张8MB、每次5张、每事项20张。**Load attachments** 后授权下载。凭证不是公开商品图片，拒绝SVG/伪装图片。**Refresh evidence choices** 刷新后续执行凭证下拉框。
4. **New compensation request**：选择退运费/部分退款/全额退款/补发/优惠券/其他，填依据、执行人和期限。退款填正常澳元金额，如`5.00`；补发填原SKU数量，金额为0。**Save compensation request** 先保存草稿，再 **SUBMIT** 提交。
5. 所有者 **APPROVE / REJECT** 决定。批准与执行分开。存在另一有效所有者时必须由另一人批准；只有一位有效所有者时允许自批并明确显示 **Single-owner self-approval recorded**。修改已批准申请会回到SUBMITTED并清除批准，不能复用旧批准。
6. 已批准/执行中/失败的退款都占用可退款额度。剩余额度＝可靠实收－已退款－其他已批准未完成额度，服务端按订单锁防止并发超额。**FAIL** 保留额度，**CANCEL** 才释放。完成记录不能通过普通编辑删除或覆盖。

### 登记外部退款

只有真实外部退款已完成后，所有者在批准申请中上传证明，刷新凭证，按 **REFUND**，选择 MANUAL、实际时间、唯一参考号、真实渠道、凭证和原因，按 **Save compensation refund**。金额来自已批准申请，不能执行时临时换金额。

系统只登记这一事实，不联系银行。重复同一请求只生成一次；同一参考号不能用于另一笔退款。生成一个关联支出和一笔实际付款记录，OrderRefund引用同一现金记录。**Same refund cash record in Expenses** 可查看；不能再在支出页重复登记或改写这笔顾客退款。更正顾客退款事实尚无专用冲正流程，不能直接覆盖历史。

TEST退款仅允许非production、ENABLE_DEV_PAYMENTS开启、订单本身为TEST。TEST售后不能对REAL订单申请资金/库存补偿。不要用真实订单测试退款；隔离库样例中的REAL是为验证统计构造的合成事实，并非真的转账。

### 补发、优惠券与实物退货

- 补发批准后 **RESERVE REPLACEMENT** 预留墨尔本可售库存；缺货时整笔失败，不能伪装发货。实际发出后 **SHIP REPLACEMENT**，填时间、承运商、追踪号，预留减少、实物扣减各一次。独立履约记录关联原订单及统一物流REPLACEMENT包裹，不新增订单收入。未发出取消释放预留；已发出不能取消回滚实物。
- 补发运费在原 Expenses 创建独立真实支出，再通过统一 Logistics 的费用关联引用；不要把同笔运费在两处新建。
- COUPON 可申请审批，但没有可结账的优惠券引擎，不能完成为“已发券”。OTHER 完成必须有实际结果凭证。
- 顾客实物退货继续用原运营模块登记实际退回、可售/不可售和数量。退款不自动增加库存，退货不自动退款，也不能重复入库。

## 综合待办与权限

**My work** 聚合真实业务记录。All unfinished、My responsibility、Awaiting my approval、Awaiting my confirmation、Overdue、Unassigned 切换视角。每项显示来源、原因、状态、负责人、期限与下一步，点击业务编号直接处理。相同来源和对象的多条通知合为一个主待办；采购与其主支出同时活动时以采购为主，独立财务问题仍保留。

所有者可见待审批/执行、采购/支出及任务失败；墨尔本仓管默认只见已付款未取消订单的履约信息、到仓事项、自己负责的售后/补发和通知。首页仍保留“今天＋置顶”，阅读/确认不会替代业务解决。

**Purchases & expenses → Permissions** 由所有者授予 orderStats、orderExport、customerExport、aftercare、compensationApply、compensationExecute、orderRules 等独立权限。仓管默认不能看整体经营收入、导出顾客资料或执行退款。金钱批准和实际退款登记固定为所有者；明细/证据下载也在服务端校验。售后普通证据放case，退款凭证放compensation，仅所有者可访问。

## 完整可复现样例

运行 `npm run test:sales`，只在隔离库生成下列合成样例。详情ID保存在忽略的 `.local/sales-verification.json`，每次测试不同。

1. SKU A实际售价AUD10，参考价AUD20；SKU B实际售价AUD20。两者关联两个系列和两个重叠活动。
2. 第一单A×2+B×1，商品AUD40、运费AUD5，10月1日核实收款AUD45；第二单A×1，10月3日核实收款AUD15。
3. 后来A改价为AUD90、商品改名和分类，旧单仍保存原名/分类/成交价。按A查询得到2单、整单AUD60，匹配A的商品金额AUD30。
4. 第一单创建售后，申请并批准AUD5部分退款；批准时退款仍为0。11月1日登记合成外部退款凭证后，订单退款AUD5，只有一笔支出现金事实；库存不变。
5. 10月报表：2单、4件、商品AUD50、运费AUD10、收款AUD60、实际应用优惠0、当期退款0。截止11月3日的10月付款批次退款AUD5。
6. 11月退款报表：退款AUD5，不能生成负订单或负销量。两个活动/系列各自可能显示AUD50，合计总报表仍AUD50。
7. 补发A×1独立预留/发出，不增加4件销售量。另一个未发出的补发取消后释放预留。并发超额申请、缺货发货、仓管退款都被拒绝。

## 启停、备份与未接能力

双击根目录 **Start Website.command** 启动数据库、网站和60秒任务。Control+C停止网站/worker；`npm run db:stop` 停数据库。补查 `npm run notifications:check`，常驻 `npm run orders:worker`；它们共用既有任务和去重，不重复启动两套worker。关机/休眠期间不会工作，重启后补查。

数据库在 `.local/postgres/data`，图片/私有凭证在 `.local/uploads`。停网站和worker后保持数据库运行，`npm run db:backup` 同时备份数据库、媒体和私有环境；备份不可提交Git。首次管理员用 `npm run admin:create` 本地隐藏输入密码；没有默认密码。完整步骤见 [README](../README.md)。

未接真实支付/退款/物流/邮件/eBay、顾客账户、优惠券、部分发货、财务完整会计/税务/净利润、公网和多实例生产调度。未来接口须在现有业务事务、唯一外部事件和签名/金额核对边界接入，不能把模拟操作当作生产支付。
