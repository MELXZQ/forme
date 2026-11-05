# 通知中心操作手册

入口：`http://127.0.0.1:3000/admin`，登录后默认进入 **Notification centre**。商品与首页管理仍在 **Catalogue**（`/admin?catalogue=1`）；库存、调拨、订单在 **Stock / Orders**。沿用原来的个人账号，不需要重新注册。

## 今天、历史和待办

- **Today + pinned**：所选时区今天首次生成的通知，加上所有仍置顶的通知。每条只出现一次；昨天的通知今天被修改，不会冒充今天新通知。
- **All notifications**：全部历史。**Date of first creation** 可选日期；日期列表仍保留置顶项。类型、等级、负责人、状态、未读等组合筛选会写入 URL，可以刷新或用浏览器前后退。每页25条，置顶优先，然后等级、首次生成时间和稳定ID排序。
- **Unfinished tasks**：所有日期的待处理/处理中待办，普通物流进度不计入。避免只看“今天”遗漏旧问题。
- **Assigned to me** 是我负责处理的；**Awaiting my confirmation** 是要求我确认当前版本、但我还没确认的。
- **My timezone** 在 Melbourne 和 Beijing 之间切换，按个人账号记忆；墨尔本自动处理夏令时。
- **Refresh** 更新数据。页面不自动轮询，避免打断正在填写的备注；保存后会重新加载相关结果。

## 已读、确认与解决

打开详情只把自己的当前版本标记为已读。**Confirm current version** 表示“我已知悉这一版本”；不表示问题解决，也不能替别人确认。

详情显示原因、建议行动、**At first trigger** 原始快照、**Latest checked data** 最近检查数据、负责人、各人的确认情况、首次生成/更新时间以及 **History**。**Open related business record →** 返回对应库存或调拨单。商品汇总列出每件商品的缺项。

填写 **Outcome / internal note / reason** 后，可按权限标记处理中、保存内部备注、解决或标记不适用。解决不会修改实际库存；必须先在关联业务页面完成真实入库、收货或其他处理。

手动关闭仍持续的低库存问题，表示忽略这一次连续低库存周期；扫描不立即重建。恢复至阈值以上后再跌破，才产生新周期，旧记录保留。

## 指定确认人和置顶

所有者在详情勾选有效且有对应业务查看权限的人员，填写原因，点击 **Pin with selected confirmers**。至少选择一人。所有指定人员确认同一当前版本后，所有者才能 **Unpin**。

系统异常（逾期、货损/确认损失/明确异常）还要求问题已经解决，或填写原因关闭为不适用。全部确认也不能直接取消一个未解决异常的置顶。

例如指定你和仓管确认某调拨异常：你确认后仍需仓管自己登录确认；所有者登记处理结果并解决，再解除置顶。仓管不能管理规则或替别人确认。

确认人停用时，所有者用 **Replace confirmer list with reason** 明确替换。保留旧名单、原因和版本记录；普通置顶不能悄悄删除未确认人员。数量、到达截止日期、补货建议等实质变化产生新版本，旧确认记录保留但不算新版本确认。刷新和措辞修改不清除确认。

## 单个或全部 SKU 阈值

进入 **Stock / Orders → Stock**，展开 **Stock alert thresholds — single row / batch**。

1. 选择 **Warehouse**：BEIJING 或 MELBOURNE，两个仓库独立。
2. 只勾一行就是单个 SKU；可多选，或 **Select current page**，或 **Select all matching SKUs (总数)**（跨分页，受当前筛选限制）。
3. **Mode** 选择 **Custom threshold** 并填写5、10或其他非负整数；或 **Turn alerts off**；或 **Restore warehouse default**。
4. 填写 **Reason**，点击 **Preview changes**。检查仓库、影响SKU数量、模式及阈值，然后 **Apply reviewed changes**。

服务器会再次验证账号权限和所选范围，列表变化导致数量/范围不同则要求重新预览。选“全部匹配”只作用于当前筛选，清除筛选后再全选才是所有SKU。批量最多5000个，避免误操作过大。

**Alert source / Effective threshold** 显示库存列表所选仓库的来源和生效值（默认墨尔本）。CUSTOM 是自定义，OFF 是关闭，INHERIT 是继承；继承仓库默认关闭时也显示 Off。`0` 是仅缺货提醒，不能用0代替关闭。

点击 **Change warehouse defaults in notification rules** 修改仓库默认值，留空是关闭。默认值变化只影响继承的SKU；明确批量选择自定义或恢复继承才改变原自定义配置。

本次按你确认的决定迁移：已明确保存的旧阈值保留为墨尔本自定义；没有明确配置的规则先关闭。没有自动设置5或10，也没有改变库存归属。新SKU默认继承。

库存计算为实物−预留−不可售。通知根据北京可调出、有效在途、墨尔本可售生成“调拨/跟进收货/联系供应商”建议；“高于阈值所差数量”只是算术差额，不是最佳采购量。本系统没有采购单数量。

## 商品资料范围

**Catalogue → Products → Product information reminder settings** 或 **Rules / task status → Product information check scope** 可加载商品列表，单选/多选/全选并选择 INHERIT、ON、OFF，填原因后 **Apply product check scope**。

在规则页：

- **Enable product information checks** 是总开关，初始关闭。
- **New / included products inherit checks** 控制继承规则的新商品。
- **Future additions only (retain existing included scope)** 首次开启时只纳入之后新增商品；不撤销以前明确纳入的商品。
- **Include existing products — one grouped reminder** 把目前未单独关闭、且尚在继承的商品明确纳入检查（保存为ON）。独立OFF不被覆盖。新商品是否默认检查仍由上面的开关决定。

例如只想检查以后新增：打开总开关及新商品继承开关，选择Future，填原因保存。以后要检查旧商品，明确选择Existing保存，或在商品列表选择具体商品设ON。

多件商品缺资料只显示一个共享待办汇总；详情逐件列缺项。补齐一件后从清单移除，全部补齐则自动解决。原清单和变化保留在快照/版本历史。检查图片、名称、有效分类、有效价格SKU，以及介绍内的材质/适用尺码信息；推荐项与上架必填区分标示。没有凭空新增配送重量字段。关闭提醒永远不绕过上架验证。

## 物流和异常

复用 **Transfers** 中的发出、预计日期修改、收货和退回记录。普通发出/部分收货/完成收货是信息；部分收货显示剩余待收，不等于少货。仓库验收是人工记录，不等于物流平台签收。

逾期按目的地墨尔本当地日期、预计区间结束日期和 **Arrival grace days** 判断。文案表示尚未登记足够收货，不能证明货实际未到。修改ETA必须填写原因，保留前后值；改为未来日期可解决旧逾期，之后再过期形成新周期。收货完成可解决未收货逾期，但货损仍是独立异常，须记录处理结果后解决。

## 规则、任务及故障恢复

**Rules / task status**：仓库默认阈值、商品范围、到货宽限天数、**Auto-pin complete stockouts**，以及每类 **Responsible person / Recipients / Required confirmers**。填原因后 **Save notification rules**。

未指定时使用唯一有效Owner；如果有多个Owner或没有唯一有效Owner，检查会显示错误，需在这里明确指定，系统不会随意选人。库存全局人员须同时有两仓权限；单条墨尔本通知可以再分配给有权限的仓管。停用账号后应同时更新默认规则和未结束通知的确认名单。

**Background task status** 显示运行中/待处理/失败/最近未运行、最后成功时间、待处理变更号，以及最近20次结果。**Run check now** 手动补查，有10秒防重复限制；失败原因脱敏显示，修正后可重试。

最简单：双击 `Start Website.command`，它同时运行网站、订单预留释放和通知检查。手动启动用两个终端：

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm run db:start
npm run dev
```

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm run notifications:worker
```

`notifications:worker` 和 `orders:worker` 是同一个任务，不要把它们当作两套必要服务。每分钟检查一次，业务写入后也及时触发。单次补查：`npm run notifications:check`。Control+C停止任务；`npm run db:stop` 停数据库，不删除数据。

电脑关机/休眠、数据库或任务关闭时无法实时提醒。重新运行会处理持久化变更并按当前状态补查，不按停机期间每一分钟重复生成通知。没有邮件、短信、物流API或远程推送。

## 权限

Owner：查看、管理规则、分配负责人、置顶、解除、关闭异常和重分配确认人。仓管：只看接收范围内且符合现有业务权限的通知，只确认自己被指定的任务；被分配负责时可标记处理中和备注，不能管理规则/北京库存/关闭异常。只读账号只可查看授权信息及记录个人已读/确认，不获得库存写权限。任何人都不能替别人确认。

数据与备份沿用README：通知、历史、偏好与规则都在本地PostgreSQL，`npm run db:backup` 一并备份。不要删除通知/审计来处理重复问题。
