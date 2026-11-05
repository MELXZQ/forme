# FORME 双仓与订单操作手册

本手册对应当前本地版本。Owner 是你；Melbourne warehouse 是朋友的个人账号。现阶段朋友不能从互联网连接这台 Mac。所有金额都是 AUD；后台价格与运费用澳分填写，1200 表示 A$12.00。没有接真实支付、退款、邮件或物流公司。

## 1. 开机与账号

用 VS Code 的 File → Open Folder 打开 `/Users/hopayed/Documents/ChatGPT/Edward/forme`。最简单的启动方式是在 Finder 双击同目录的 **Start Website.command**，保持打开的终端窗口运行。它同时启动数据库、网站与每分钟检查一次的订单预留释放任务。浏览器打开 http://127.0.0.1:3000 。

首次创建所有者：在 VS Code 的 Terminal → New Terminal 执行 `npm run admin:create`，按提示输入邮箱、名称和隐藏密码。没有默认密码，不要把密码发到聊天。已有账号重置密码会撤销原会话，保留原有权限与停用状态。正式数据库没有测试账号。登录 http://127.0.0.1:3000/admin ，点 **Inventory / Orders** 进入运营后台；**Catalogue** 返回商品内容后台；**Sign out** 退出。

Owner 在 **Accounts → New account** 建立朋友的个人账号，Permission 选择 **Melbourne warehouse**；只读人员选择 **Read-only inventory**。点击账号的 **Open → Edit selected permissions** 可以修改权限或取消 Active。保存需填写原因，会撤销该账号所有旧会话。最后一个有效 Owner 不能停用或降权。密码重置通过你本机的隐藏输入命令完成，不共用账号。

## 2. 先处理旧库存

已有 16 个 SKU、共 160 件旧库存按你的决定保留为待确认，两仓均未自动入库。商品编辑页的旧 stock 只作历史参考。

1. 在 **Inventory** 勾选 **Legacy unassigned** 并点 **Search / filter**。
2. 打开 SKU，实地确认数量和归属后点 **Record stock event**。
3. Warehouse 明确选 Beijing 或 Melbourne；Stock event 选 **Assign confirmed legacy stock**；填本次确认的数量及原因。
4. 若其中有破损或待检查件，在 **Of received quantity: unavailable / awaiting inspection** 填写其中的数量，不能超过本次总量。
5. 两地都有货可分两次登记，总量不能超过待确认余量。
6. 若旧值只是演示数、确认实物不存在，用 **Resolve legacy discrepancy** 填确认不存在的数量和原因。这只减少待确认量，不产生实物库存。

不要对同一批旧货再做 Initial entry 或 Purchase received。不能根据网页上的旧数字推断仓库。

## 3. 北京入库与日常调整（Owner）

先在 Catalogue 的 Products 创建商品、SKU、价格和图片；所有新 SKU 的仓库库存初始为零。然后 Inventory 打开 SKU → **Record stock event**：

| Stock event | 用途 |
|---|---|
| Initial physical stock entry | 首次清点实物；有待确认旧量时先处理旧量 |
| Purchase received | 采购已经实际到仓 |
| Move available stock to unavailable | 破损或待检查，实物不变，可售减少 |
| Return unavailable stock to sellable | 检查通过，不可售转可售 |
| Confirmed disposal/loss of unavailable stock | 已确认报废或遗失的不可售实物，减少实物与不可售 |

每次填写真实原因。可售 = 实物 − 预留 − 不可售。不要用采购记录掩盖盘点差异；使用下一节的盘点流程。库存流水可查看操作前后余额、变动、操作人和单据，错误通过新记录纠正，不能删除旧流水。

## 4. 北京发出与墨尔本分批收货

**Owner：** Transfers → **New transfer**，选择一个或多个 SKU，填计划数量、承运商、追踪号、预计到墨尔本日期及备注，保存草稿。草稿不扣库存。实际发出时 **Open → Confirm dispatch**，填实际日期、每个 SKU 实发量、原因。保存才减少北京实物并增加在途；发出时会重新核对北京可调出量。

**朋友：** Transfers 找到相应单据 → **Open → Record partial receipt**。逐 SKU 按实数填写 Sellable 与 Unavailable，不要将未到货数量填进去。可上传现场照片。保存后增加墨尔本实物，破损进入不可售，剩余继续在途。朋友没有确认运输损失权限。

**完整示例：** 北京发出 20 件，墨尔本本次共收到 18 件，其中 1 件破损。填 Sellable=17、Unavailable=1、Lost=0。结果：墨尔本实物增加 18、可售增加 17、不可售增加 1；仍有 2 件待收。同一次保存重试不会再次入库。剩余 2 件后来到货，再登记实际收货；若确认丢失，由 Owner 记录 Lost=2 和调查原因。全部收到或差异处理完后自动 Closed。

**Update shipment / ETA** 修改预计日期、追踪或异常，历史保留。Overdue 表示预计日期已过且仍在途，应调查并更新。运输异常不作为顾客正常补货依据。

只有未发出的草稿可 **Cancel draft**。货物确实退回北京时 Owner 用 **Returned to Beijing**，填实际退回量。退回量先进入北京不可售，实物检查通过后再 Restore；不能把取消单据当作实物退回。已到墨尔本的商品不支持用这项功能反向调拨。

## 5. 盘点

朋友在 SKU 详情点 **Submit physical count**，填写墨尔本实物总数及原因。只提交不改库存。Owner 在 **Counts** 打开 Pending 记录 → **Decide selected count**，审核后批准或拒绝并填写原因。若提交后实物已发生变化，批准会被拒绝，应重新盘点。预留和不可售之和不能超过盘点后的实物；应先调查相关订单和质量记录。

## 6. 商品状态与查询

Catalogue 继续管理商品上架、归档、图片、分类、系列及首页。新品推荐单独排序，不等同于最新上架。

| 顾客选中 SKU 的状态 | 含义 | 可购买 |
|---|---|---|
| In stock · Ships from Melbourne | 墨尔本可售大于零 | 是，仅限可售量 |
| Restocking soon | 无墨尔本可售，但有正常在途 | 否 |
| Restock planned | 没有正常在途，北京可调出大于零 | 否 |
| Out of stock | 无上述来源，或关闭补货展示 | 否 |

预计日期只表示到墨尔本仓，不是送达顾客；过期日期不会继续向顾客承诺。北京数量不公开。SKU alerts / restocking 仅设置补货展示；低库存已升级为 Stock alert thresholds — single row / batch 中的仓库＋SKU独立规则，见[通知中心手册](notifications-manual.md)。没有明确配置的规则先关闭，不能伪造可售量。

Inventory 支持商品、SKU、规格、分类、系列、仓库、状态、低库存、不可售、在途、ETA、逾期及差异组合筛选。**Search / filter** 执行；地址栏保存条件，可刷新、返回和复制。列表分页、排序，**Export CSV** 导出当前条件的全部匹配行（最多 5000）；仓管只导出其可见库存，只读角色不能导出。详情的 Related transfers、Inventory ledger、Active order reservations 用于追查数量。History 给 Owner 查看不可编辑的关键操作前后变化。

## 7. 本地访客订单

Owner 先在 **Settings** 明确勾选 **Fixed Australian shipping is configured** 并填真实固定运费；未配置时禁止结账。Reservation minutes 默认 30，可改 1–1440 分钟。

顾客选择有墨尔本可售的 SKU → 加入购物袋 → Checkout → 填合成测试邮箱和澳大利亚地址 → 创建本地订单。服务端重新核价与库存，创建时只预留。不要输入真实顾客资料进行开发测试。该页面不会收取款项。

顾客订单页由私有 Cookie 授权。可生成并私下保存 **private lookup link**；链接相当于该订单的访问凭据，不要分享或贴到日志。订单号本身不能查询地址。换浏览器时使用私有链接；本版不发邮件。

Owner 可在订单详情使用 **Simulate payment (DEV only)** 验证 success / failure。这不收真钱，在生产运行模式始终禁止。重复通知不重复扣减。预留到期后模拟成功进入待核查，不能直接发货。

**Orders** 支持订单号、联系方式、商品和历史规格/分类/系列、支付履约状态、时间、金额、州邮编、承运商、异常等组合筛选。历史 Deals 按成交快照；整单金额含运费一次，Matching item totals 只统计匹配的明细，不重复累计整单。Refund 与优惠码未接入，不提供假筛选。仓管只看已付款或已发货的履约数据，不显示邮箱、价格或订单导出。

付款成功后仍保留预留，实物不扣。朋友真实发货后点 **Confirm whole-order shipment**，填承运商、追踪号和原因；整单发货一次，同时减少实物和预留，不支持部分发货。

取消未发货订单只释放占用，不凭空增加实物。已付款取消会留下需处理的异常，没有真实退款动作。已发货货物实际退回并检查后，点 **Register inspected return**，按明细填写可售/不可售；不能超过原发货量。钱款退款和实物退回分开。

## 8. 预留释放、停止与常见问题

双击启动器会自动运行每分钟一次的释放任务。手动启动网站时另开终端执行 `npm run orders:worker` 并保持运行。一次性补执行：`npm run orders:expire`。电脑关机、休眠或任务停止时不会持续释放；恢复后任务会补处理过期订单。

- Control+C 停网站和启动器的任务；手动运行的 worker 需在它的终端另按 Control+C。最后 `npm run db:stop`，数据不会删除。
- “Shipping is not configured”：Owner 配置运费。
- “not enough Melbourne stock”：刷新购物袋，减少数量或等待实际到货。
- “request key already used”：同一次操作改了内容。关闭表单、刷新、确认历史后重新记录；不要盲目重复加货。
- “count changed”：重新清点，不强行覆盖余额。
- 401：会话过期或权限刚被调整，重新登录；403：当前账号没有权限。
- 数据库不可用：执行 `npm run db:start`。前台不会退回模拟库存。
- 图片拒绝：使用 JPEG、PNG、WebP，单图最多 8 MB；收货最多 5 张；不上传 SVG。

## 9. 备份和恢复

停止网站和 worker，数据库保持运行，然后 `npm run db:backup`。输出的 backups/时间目录包含 database.dump、uploads 和私密 .env.local。一起保存到受保护的位置，不放入 Git、聊天或公开网盘。素材还包含项目 public/assets，备份整个项目源码及该目录。不要在数据库运行时单独复制 .local/postgres/data 作为可靠备份。

恢复不要覆盖正在使用的数据库。由维护者先在独立空数据库恢复并验证（技术文档有步骤），确认备份时间、记录和图片完整，再决定切换。日常不用 reset、drop 或删除 .local；本项目没有自动覆盖正式数据的恢复按钮。
# 第二批业务入口

供应商、采购、支出、循环支出与统一物流已接入 `/admin/business`，沿用本手册的库存/调拨/履约规则。操作步骤见 [采购、支出与物流手册](business-manual.md)，不需要重新建仓或重分配待确认旧库存。
