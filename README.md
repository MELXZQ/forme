# FORME 男士首饰概念商店

这是本地 Next.js + React + TypeScript 项目。页面使用英文、价格使用 AUD。品牌、16 件商品、价格和 SVG 图片都是可替换的演示内容。没有真实支付、订单、登录或数据库。

## 打开、启动、停止

最简单的方式：在 Finder 中打开本项目文件夹，双击 `Start Website.command`。它会打开 Terminal，并启动网站。保持该窗口打开，在浏览器访问：

**http://127.0.0.1:3000**

终端出现 `Ready` 表示启动成功。网站只监听本机地址，其他设备不能直接访问。

停止网站：点击运行网站的 Terminal 窗口，按 **Control + C**。重新启动或重启电脑后继续：再次双击同一个启动文件即可。不要在已有服务运行时重复启动；端口占用时 Next.js 可能改用 3001，以终端输出地址为准。

用 VS Code 开发：

1. 打开 VS Code，选择 **File → Open Folder…**。
2. 选择 `/Users/hopayed/Documents/ChatGPT/Edward/forme`，点击 **Open**。
3. 选择 **Terminal → New Terminal**。项目设置会为这个新终端配置本地 Node.js 路径。
4. 输入 `node --version`、`npm --version`、`git --version`，分别应看到版本号。
5. 输入 `npm run dev`。在浏览器打开终端显示的本地地址。

已有的终端不会自动读取新配置；请创建一个新终端。若手工使用 macOS Terminal，可复制：

```sh
cd "/Users/hopayed/Documents/ChatGPT/Edward/forme"
export PATH="$PWD/.tools/node/bin:$PATH"
npm run dev
```

## 在 VS Code 查看 Git 修改

项目已建立本地 Git 仓库，初始提交保存当前网站版本。打开项目后，点击左侧 **Source Control**（分支图标），或按 **Control + Shift + G**。保存文件后，修改会出现在 **Changes**；点击文件可以查看逐行差异，编辑器左侧也会显示改动标记。

保存文件（Command + S）让开发预览自动更新，但不等于提交 Git。完成一项修改后，可在 Changes 文件旁点击 **+** 暂存，在消息框写明修改内容，再点击 **Commit** 保存一个版本。提交记录可在 Source Control 的 **Graph** 中查看；单个文件也可在 Explorer 下方 **Timeline** 中查看历史。

开发服务器运行时保留该终端，需要执行其他命令可使用 **Terminal → New Terminal**。Git 不需要启动服务器也能查看改动。Git 本地版本与 GitHub 在线备份是不同的功能，目前项目使用本地版本记录。

## 环境详情

- macOS 26.5.2 / arm64；已有 Apple Git 2.50.1 和 Command Line Tools。
- Node.js 24.22.2 LTS，npm 11.19.1，位于 `.tools/node/`。下载自 Node.js 官方网站，已与官方 SHA-256 文件核对。
- Next.js 16.4.5，React 19，TypeScript 5.9；准确依赖版本见 `package-lock.json`。
- 项目专用 VS Code 终端设置、TypeScript 路径和 ESLint 保存修复设置。
- VS Code 扩展推荐列表中提供 ESLint 与 Prettier；扩展不影响网站运行。

没有修改系统 Node.js、全局 npm 包或 shell 启动文件。无需 Homebrew、Python、Docker 或数据库。将来若要在别的电脑运行，安装 Node.js 24 LTS 后执行 `npm ci` 即可；`.tools/node` 中的本地运行环境专用于当前 Apple Silicon Mac。

JavaScript 是语言；TypeScript 增加类型检查，构建时转换为 JavaScript；Node.js 是浏览器之外的 JavaScript 运行环境。TypeScript 已在项目依赖中，无需额外全局安装。

## 已实现

- 响应式主页：导航 → 轮播 → New Arrivals → Deals（页面标题为 Good finds）→ 人物分类 → 两个系列 → 选购帮助 → 服务与页脚。
- 3 张轮播，5.5 秒自动切换、上一张/下一张、分页、暂停、悬停和键盘焦点暂停、触摸横向滑动。页面进入后台时也暂停。
- 8 件新品、8 件折扣商品的独立横向轨道、桌面箭头、原生触摸滚动、轨道末尾与标题 View all。
- sticky 人物场景：滚动控制背景、上移、标签透明度；向上可反向恢复，没有滚轮拦截。手机使用独立人物构图和坐标。
- `/shop` 支持搜索、品类、系列、优惠筛选，以及最新、价格升降序。状态保存在 URL，Apply 后生效，可刷新、前进和后退。
- 16 个真实可访问的基础详情页、演示购物袋、数量修改、小计、清空和 localStorage 保存。
- 尺码、长度、护理、配送、退换、联系、FAQ、隐私与条款页面。未提供的商业政策明确标注待补充。
- 原生 dialog 管理焦点与 Escape 关闭；提供键盘焦点、跳过导航、图片回退、加载、空结果和 404。
- `prefers-reduced-motion` 下停止自动轮播，人物与全部标签直接展示，不需要额外滚动动画。

## 内容和图片在哪改

| 需求                                                    | 文件                             |
| ------------------------------------------------------- | -------------------------------- |
| 品牌、Logo 文字、导航、社交链接                         | `src/data/brand.ts`              |
| 商品名称、AUD 价格、品类、新品/促销标记、图片、系列归属 | `src/data/products.ts`           |
| 分类 ID 和展示名称                                      | `src/data/categories.ts`         |
| 轮播图、桌面/手机裁切位置、文案和链接                   | `src/data/slides.ts`             |
| 系列主图和介绍                                          | `src/data/collections.ts`        |
| 人物、替代文本、桌面/手机锚点及标签坐标、出现顺序       | `src/data/model.ts`              |
| 帮助、服务与待补充政策                                  | `src/data/services.ts`           |
| 统一数据读取与筛选边界                                  | `src/lib/catalog.ts`             |
| 数据类型                                                | `src/lib/types.ts`               |
| 颜色、字体、间距、导航高度                              | `src/app/globals.css`            |
| 各组件样式与响应式布局                                  | `src/components/Site.module.css` |
| 所有本地插画                                            | `public/images/`                 |

图片路径使用 `/images/文件名`，对应项目里的 `public/images/文件名`。商品图片建议统一 1:1，系列图约 900×620，轮播图约 1000×650。替换为本地 JPG、PNG 或 WebP 后更新数据路径和替代文本即可。组件预留宽高，图片失败时使用 `fallback.svg`。外部图片并非运行条件。

`scripts/generate-assets.mjs` 可重新生成占位 SVG。**更换真实图片后不必再运行 `npm run assets`**，以免重新覆盖同名占位图。

未来接数据库时优先替换 `src/lib/catalog.ts` 的读取函数，保留 `Product` 类型、稳定 ID 和 URL 筛选约定；服务端读取可改成异步，并将购物袋所需的商品摘要通过属性传入客户端，避免客户端导入数据库代码。

## 调整人物与标签

人物素材与动画逻辑分离：素材和坐标在 `src/data/model.ts`，滚动控制在 `src/components/ModelExplorer.tsx`。

当前桌面画布为 1000×760，手机为 500×760。替换人物时尽量沿用相应比例，或同步修改 `.modelCanvas` 的 `aspect-ratio` 和宽度公式。人物应包含头、颈部、手腕与手指。

每个标记分为：

- `anchor: [x, y]`：对应首饰部位，连接线起点。
- `label: [x, y]`：可点击标签左上角，连接线终点根据标签偏移计算。
- `desktop` / `mobile`：分别配置；坐标是画布宽高的百分比，不是整页坐标。
- `order`：从 0 开始的出现顺序。
- 分类链接从稳定 `id` 生成，例如 `/shop?category=rings`。

滚动区高度和各阶段阈值分别在样式 `.modelSection` 与控制器的 `render()` 中。后续替换为视频或 3D 时，可保留场景配置与分类链接，替换视觉呈现层。

## 验证命令

在 VS Code 的项目新终端里执行：

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

网站运行时，可另开一个终端执行：

```sh
npm run verify:routes
```

它会实际请求页面、商品与帮助路径、筛选入口、本地图片，并检查无效详情页返回 404。测试结果、截图与未验证项见 `docs/verification.md`。

## 后续需要的真实资料

正式品牌名与 Logo；统一比例商品图和佩戴图；含头部到腰部及双手的人物图（桌面/手机构图）；商品材质、尺寸、价格与库存；两个系列的主图与关联商品；客服方式、配送/退换政策、隐私与条款；需要展示的社交链接。

本阶段没有承诺真实材质、认证、免邮门槛、退换期限或保修服务，也没有编造用户评价。当前内容适合体验和评审，商业资料确认后再进入真实商城阶段。
