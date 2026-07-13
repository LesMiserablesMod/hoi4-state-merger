# HOI4 State Merger

一个本地运行、先预演再写入的 HOI4 State 合并工具。它只重新分配现有 Province 到保留 State，不编辑 `provinces.bmp`、`definition.csv` 或 Province ID。

当前版本：`0.1.7`（MVP）。请先在副本上测试，并用游戏的 `-debug` 模式做最终验证。

## 它会处理什么

- 默认让同一 State 使用来自 `provinces.bmp` / `definition.csv` 的稳定代表 RGB；可切换查看真实 Province RGB，并以恒定细描边标出 State 边界。
- 支持以鼠标位置为中心的滚轮缩放，范围为 50%–2400%，并显示当前倍率。
- 合并 Province 列表、人口、资源、本地补给、胜利点、州级建筑和 Province 级建筑块。
- 保持 Province ID、地形、铁路、补给节点、相邻关系及 Province 像素边界不变。
- 删除来源 State 后，用尾部 State 填洞，保持 State ID 从 `1..N` 连续。
- 使用 PDX token/AST 精确迁移已注册的 State 变量，例如 `capital = 123`、`target_state = 123`、`state:123`；注释、字符串、Province、年份和普通数字不会匹配。
- 按 `map/buildings.txt` 第一列的旧 State ID 做一次性迁移；第二列建筑类型、坐标、旋转和最后一列相邻海洋 Province 全部保持不变。
- 迁移 `history/units/** > air_wings > StateID = {}` 这类数字左键，并将其他未分类数字块键列为带完整父路径的精确提示。
- 未注册但名称明确包含 `state` 的整数变量只列为非阻断提示；不再做裸 ID 全局搜索。
- Dry Run 显示文件补丁、执行检查、精确引用和最终合并结果；可以导出 JSON 报告。
- 真正写入前强制保存 ZIP 备份并复核 Dry Run 文件快照；写入后校验文件内容、State ID、逐 Province 归属和建筑定位器，失败时自动回滚。

## 安全阻断

以下情况不会允许“应用合并”：

- 当前 State ID 已经不连续，或 Province 同时属于多个 State。
- Province 级建筑块指向不属于该 State 的 Province。
- 一个文件中包含多个 `state = {}` block。MVP 要求每个 State 独立文件。
- 缺少或无法完整解析 `map/buildings.txt`，或定位器在映射前后引用不存在的 State。
- 所选 State 不属于同一个 Strategic Region。

默认采用“保留目标州 history + 合并物理数据”：来源 State 的政治、日期和未知 history 随来源文件删除，不再阻止合并；Province、人口、资源、建筑和胜利点仍会合并。State Category 不一致默认提示并保留目标值；跨 Strategic Region 会阻断。工具也会对局部覆盖 MOD 给出警告，因为删除文件可能让上游 MOD 的同名 State 重新生效。

## 运行

推荐直接使用 GitHub Pages 在线版：

<https://lesmiserablesmod.github.io/hoi4-state-merger/>

目录读写依赖浏览器的 File System Access API，请使用最新版 Chrome 或 Edge，并通过 HTTPS 或 `localhost` 打开；不能直接双击 `index.html`。

如需本地运行，请先安装 Node.js 20 或更新版本。Windows 可以双击：

```text
start-windows.bat
```

也可以在终端运行：

```bash
npm install
npm run dev
```

然后访问 `http://localhost:5173`。

## 推荐工作流

1. 复制一份 MOD，或者确保它已经纳入版本控制。
2. 点击“打开 MOD”，授权读写 MOD 根目录。
3. 选择保留 State，再选择要并入的来源 State。
4. 运行 Dry Run，查看“变更 / 检查 / 精确引用”三个页签。
5. 导出报告，按具体文件、行号和变量检查少量“仅提示”引用。
6. 没有阻断项后点击“应用合并”；先保存强制生成的 ZIP 备份。
7. 用 `-debug` 启动 HOI4，检查 `error.log`、地图加载、建筑、核心与事件目标。

## 当前边界

- 工具不会修改 Province，也不会自动简化 Province 数量；因此它主要降低 State 数量及 State 级脚本负担，无法消除 Province 级寻路、前线或地图像素开销。
- MVP 不拼接来源 State 的日期时间线，也不猜测未知脚本效果；它们会按已展示的 keeper-wins 策略丢弃。
- MVP 不自动判断所选 State 在几何上是否相邻；地图会直观显示选择结果，请自行确认合并后区域连通。
- 对自定义 scripted effects、变量间接引用、动态 scope 和 DLL/外部生成内容，只报告能定位到具体 State 风格变量的候选，不搜索任意裸数字。
- `map/buildings.txt` 的数据行必须以 `StateID;` 开头；彻底改写该格式的 overhaul MOD 会在 Dry Run 阶段被阻断。
- 文件写入是“先备份、后逐文件写入”，不是文件系统事务；若中途失败，请用 ZIP 恢复。

## 开发命令

```bash
npm test
npm run build
npm run preview
```

自动化测试覆盖 State ID 填洞、token 级引用迁移、`air_wings` 数字键、真实 `map/buildings.txt` 格式与碰撞映射、阻断校验、恒定细边界提取和基础合并计划。

## 许可证

MIT
