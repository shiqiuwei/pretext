# Pretext

[English](README.md) | 中文

纯 JavaScript/TypeScript 多行文本测量与排版库。快速、精准，支持你甚至不知道存在的各种语言。支持渲染到 DOM、Canvas、SVG，以及即将推出的服务端渲染。

Pretext 绕过了 DOM 测量（如 `getBoundingClientRect`、`offsetHeight`）——这些操作会触发布局回流，是浏览器中最昂贵的操作之一。它实现了自己的文本测量逻辑，以浏览器原生字体引擎为基准（非常适合 AI 辅助迭代）。

## 安装

```sh
npm install @chenglou/pretext
```

## 演示

克隆仓库，运行 `bun install`，再运行 `bun start`，在浏览器中打开 `/demos/index`。Windows 用户请使用 `bun run start:windows`。
也可以直接在线查看：[chenglou.me/pretext](https://chenglou.me/pretext/)。更多演示：[somnai-dreams.github.io/pretext-demos](https://somnai-dreams.github.io/pretext-demos/)

## API

Pretext 有两种主要用途：

### 1. 测量段落高度，_完全无需接触 DOM_

```ts
import { prepare, layout } from '@chenglou/pretext'

const prepared = prepare('AGI 春天到了. بدأت الرحلة 🚀‎', '16px Inter')
const { height, lineCount } = layout(prepared, 320, 20) // 纯算术运算，无 DOM 布局与回流！
```

`prepare()` 执行一次性预处理：规范化空白字符、对文本分段、应用黏合规则、用 canvas 测量各段，并返回一个不透明句柄。`layout()` 是之后的廉价热路径：基于缓存宽度的纯算术运算。对于相同的文本和配置，不要重复调用 `prepare()`，那会抵消预计算的意义。例如，窗口调整大小时，只需重新调用 `layout()`。

如果需要类似 textarea 的文本，其中普通空格、`\t` 制表符和 `\n` 换行符保持可见，可以向 `prepare()` 传入 `{ whiteSpace: 'pre-wrap' }`：

```ts
const prepared = prepare(textareaValue, '16px Inter', { whiteSpace: 'pre-wrap' })
const { height } = layout(prepared, textareaWidth, 20)
```

其他 `prepare()` 选项：`{ wordBreak: 'keep-all' }` 对应 CSS 的 `word-break: keep-all`；`{ letterSpacing: n }` 对应 CSS `letter-spacing`（`n` 为 px 值）。

返回的高度是解锁 Web UI 的关键：
- 无需猜测与缓存的虚拟化/遮挡
- 花式用户端布局：瀑布流、JS 驱动的类 flexbox 实现、无需 CSS hack 微调几个布局值（想象一下）等
- _开发期间_（尤其现在有 AI 的情况下）验证按钮等元素上的标签不会溢出到下一行，且无需浏览器
- 防止新文本加载时因重新锚定滚动位置而发生布局偏移

### 2. 手动逐行排版段落

将 `prepare` 替换为 `prepareWithSegments`，然后：

- `layoutWithLines()` 在固定宽度下给出所有行：

```ts
import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext'

const prepared = prepareWithSegments('AGI 春天到了. بدأت الرحلة 🚀', '18px "Helvetica Neue"')
const { lines } = layoutWithLines(prepared, 320, 26) // 320px 最大宽度，26px 行高
for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].text, 0, i * 26)
```

- `measureLineStats()` 和 `walkLineRanges()` 在不构建文本字符串的情况下给出行数、宽度和游标：

```ts
import { measureLineStats, walkLineRanges } from '@chenglou/pretext'

const { lineCount, maxLineWidth } = measureLineStats(prepared, 320)
let maxW = 0
walkLineRanges(prepared, 320, line => { if (line.width > maxW) maxW = line.width })
// maxW 现在是最宽的行——即仍能容纳文本的最紧凑容器宽度！这种多行"紧缩包裹"在 Web 中一直缺失
```

- `layoutNextLineRange()` 允许在宽度逐行变化时逐行路由文本。如果还需要实际字符串，`materializeLineRange()` 可将该行范围转换为完整行：

```ts
import { layoutNextLineRange, materializeLineRange, prepareWithSegments, type LayoutCursor } from '@chenglou/pretext'

const prepared = prepareWithSegments(article, BODY_FONT)
let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
let y = 0

// 文字绕排浮动图片：图片旁边的行更窄
while (true) {
  const width = y < image.bottom ? columnWidth - image.width : columnWidth
  const range = layoutNextLineRange(prepared, cursor, width)
  if (range === null) break

  const line = materializeLineRange(prepared, range)
  ctx.fillText(line.text, 0, y)
  cursor = range.end
  y += 26
}
```

这种用法支持渲染到 canvas、SVG、WebGL 以及（最终）服务端。更丰富的示例见 `/demos/dynamic-layout` 演示。

关于手动排版中的连字符：在调用 `prepare()` / `prepareWithSegments()` 之前插入软连字符。Pretext 将其视为可选断点：未被选中的软连字符保持不可见，而被选中的断点会在尾部显示 `-`。对于混合语言或用户生成的应用文本，建议使用保守的、感知语言环境的插入方式，而非激进的模式匹配。自动连字符目前未内置。

如果手动排版需要富文本内联流的小助手——代码段、提及、标签芯片、以及类浏览器的边界空白折叠——可以使用 `@chenglou/pretext/rich-inline`。它故意只处理内联，且仅支持 `white-space: normal`：

```ts
import { materializeRichInlineLineRange, prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline'

const prepared = prepareRichInline([
  { text: 'Ship ', font: '500 17px Inter' },
  { text: '@maya', font: '700 12px Inter', break: 'never', extraWidth: 22 },
  { text: "'s rich-note", font: '500 17px Inter' },
])

walkRichInlineLineRanges(prepared, 320, range => {
  const line = materializeRichInlineLineRange(prepared, range)
  // 每个片段保存源 item 的索引、文本切片、gapBefore 及游标
})
```

故意保持简洁：
- 输入为原始内联文本，包含边界空格
- 调用方自有的 `extraWidth` 用于标签芯片的外壳宽度
- `break: 'never'` 用于芯片和提及等原子项
- 仅支持 `white-space: normal`
- 非嵌套标记树，也非通用 CSS 内联格式化引擎

### API 词汇表

用途一 API：
```ts
prepare(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedText // 一次性文本分析+测量，返回传给 `layout()` 的不透明值。确保 `font` 和 `letterSpacing` 与被测量文本的 CSS 同步。`font` 格式同 `myCanvasContext.font = ...`，如 `16px Inter`；`letterSpacing` 为 CSS 像素值。
layout(prepared: PreparedText, maxWidth: number, lineHeight: number): { height: number, lineCount: number } // 根据最大宽度和行高计算文本高度。确保 `lineHeight` 与被测量文本的 CSS `line-height` 声明同步。
```

用途二 API：
```ts
prepareWithSegments(text: string, font: string, options?: { whiteSpace?: 'normal' | 'pre-wrap', wordBreak?: 'normal' | 'keep-all', letterSpacing?: number }): PreparedTextWithSegments // 同 `prepare()`，但返回更丰富的结构，用于手动行排版
layoutWithLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): { height: number, lineCount: number, lines: LayoutLine[] } // 手动排版的高层 API。接受所有行统一的最大宽度。类似 `layout()` 的返回值，但额外返回行信息
walkLineRanges(prepared: PreparedTextWithSegments, maxWidth: number, onLine: (line: LayoutLineRange) => void): number // 手动排版的低层 API。接受所有行统一的最大宽度。为每行调用一次 `onLine`，传入实际计算的行宽和起止游标，不构建行文本字符串。对于需要试探多个宽高边界的场景非常有用（如二分搜索合适宽度值：反复调用 walkLineRanges 检查行数和高度是否"合适"）。可实现文本消息紧缩包裹和均衡文本布局。之后以满意的最大宽度调用一次 layoutWithLines，即可获取实际行信息。
measureLineStats(prepared: PreparedTextWithSegments, maxWidth: number): { lineCount: number, maxLineWidth: number } // 只返回该宽度下的行数和最宽行的宽度，避免行/字符串分配。
measureNaturalWidth(prepared: PreparedTextWithSegments): number // 返回宽度本身不触发换行时最宽的强制行宽
layoutNextLine(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLine | null // 迭代器风格 API，用于逐行以不同宽度排版！返回从 `start` 开始的 LayoutLine，段落耗尽时返回 `null`。将上一行的 `end` 游标作为下一次的 `start`。
layoutNextLineRange(prepared: PreparedTextWithSegments, start: LayoutCursor, maxWidth: number): LayoutLineRange | null // 同 layoutNextLine()，但不分配行文本字符串。适用于变宽手动排版、遮挡和虚拟化测量。
materializeLineRange(prepared: PreparedTextWithSegments, line: LayoutLineRange): LayoutLine // 将 layoutNextLineRange() 或 walkLineRanges() 返回的 LayoutLineRange 转换为带文本的完整行
type LineStats = {
  lineCount: number // 换行后的行数，如 3
  maxLineWidth: number // 最宽的换行行，如 192.5
}
type LayoutLine = {
  text: string // 本行完整文本内容，如 'hello world'
  width: number // 本行测量宽度，如 87.5
  start: LayoutCursor // 在预处理段/字素中的起始游标（含）
  end: LayoutCursor // 在预处理段/字素中的结束游标（不含）
}
type LayoutLineRange = {
  width: number // 本行测量宽度，如 87.5
  start: LayoutCursor // 在预处理段/字素中的起始游标（含）
  end: LayoutCursor // 在预处理段/字素中的结束游标（不含）
}
type LayoutCursor = {
  segmentIndex: number // prepareWithSegments 预处理富段流中的段索引
  graphemeIndex: number // 该段内的字素索引；在段边界处为 `0`
}
```

富文本内联流助手：
```ts
prepareRichInline(items: RichInlineItem[]): PreparedRichInline // 编译带原始文本的内联项。编译器负责跨项折叠空白并缓存每项的自然宽度
layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null // 逐行流式处理富文本内联流，不构建片段文本字符串
walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number // 富文本内联流的非物化行遍历器，用于紧缩包裹/统计工作
materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine // 将之前计算的富内联行范围转换为完整片段文本
measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): { lineCount: number, maxLineWidth: number } // 只返回该宽度下的行数和最宽行宽，避免片段文本分配。
type RichInlineItem = {
  text: string // 原始作者文本，含首尾可折叠空格
  font: string // 该项的 canvas 字体简写
  letterSpacing?: number // 字素间额外水平间距，单位 CSS px
  break?: 'normal' | 'never' // `never` 使该项保持原子性，如标签芯片
  extraWidth?: number // 调用方自有的水平外壳，如 padding + border 宽度
}
type RichInlineCursor = {
  itemIndex: number // 当前游标所在的源 RichInlineItem 索引
  segmentIndex: number // 该项预处理文本内的段索引
  graphemeIndex: number // 该段内的字素索引；在段边界处为 `0`
}
type RichInlineFragment = {
  itemIndex: number // 回指原始 RichInlineItem 数组的索引
  text: string // 该片段的文本切片
  gapBefore: number // 本行该片段之前折叠的边界间隙
  occupiedWidth: number // 文本宽度加 extraWidth
  start: LayoutCursor // 该项预处理文本内的起始游标
  end: LayoutCursor // 该项预处理文本内的结束游标
}
type RichInlineLine = {
  fragments: RichInlineFragment[] // 本行已物化的片段
  width: number // 本行测量宽度，含 gapBefore/extraWidth
  end: RichInlineCursor // 继续下一行的独占结束游标
}
type RichInlineFragmentRange = {
  itemIndex: number // 回指原始 RichInlineItem 数组的索引
  gapBefore: number // 本行该片段之前折叠的边界间隙
  occupiedWidth: number // 文本宽度加 extraWidth
  start: LayoutCursor // 该项预处理文本内的起始游标
  end: LayoutCursor // 该项预处理文本内的结束游标
}
type RichInlineLineRange = {
  fragments: RichInlineFragmentRange[] // 本行非物化片段的归属/范围
  width: number // 本行测量宽度，含 gapBefore/extraWidth
  end: RichInlineCursor // 继续下一行的独占结束游标
}
type RichInlineStats = {
  lineCount: number // 换行后的行数，如 3
  maxLineWidth: number // 最宽的换行行，如 192.5
}
```

其他助手：
```ts
clearCache(): void // 清除 Pretext 由 prepare() 和 prepareWithSegments() 共用的内部缓存。当应用循环使用多种字体或文本变体且希望释放缓存时很有用
setLocale(locale?: string): void // 可选（默认使用当前语言环境）。为后续 prepare() 和 prepareWithSegments() 设置语言环境。内部同时调用 clearCache()。设置新语言环境不影响已有的 prepare() 和 prepareWithSegments() 状态（不做修改）
```

注意事项：
- `PreparedText` 是不透明的快速路径句柄；`PreparedTextWithSegments` 是更丰富的手动排版句柄。
- `LayoutCursor` 是段/字素游标，不是原始字符串偏移。
- 对空字符串调用 `layout()` 返回 `{ lineCount: 0, height: 0 }`。浏览器仍会将空块的大小设为一个 `line-height`，如需该行为，请用 `Math.max(1, lineCount) * lineHeight` 进行夹紧。
- 更丰富的句柄还包含 `segLevels`，用于自定义双向文本渲染。换行 API 不读取该字段。
- 段宽度是用于换行的浏览器 canvas 宽度，不是用于自定义阿拉伯语或混合方向 x 坐标重建的精确字形位置数据。
- 若软连字符赢得断点，物化后的行文本会包含可见的尾部 `-`。
- `measureNaturalWidth()` 返回最宽的强制行宽，硬换行依然计入。
- `prepare()` 和 `prepareWithSegments()` 只做水平方向的工作，`lineHeight` 保留为排版时的输入。

## 注意事项

Pretext 目前不尝试成为完整的字体渲染引擎（也许将来会？）。当前针对的常见文本配置：
- `white-space: normal` 和 `pre-wrap`
- `word-break: normal` 和 `keep-all`
- `overflow-wrap: break-word`。极窄宽度仍可能在词内断行，但只在字素边界处。
- `line-break: auto`
- `letter-spacing` 作为数字像素值传入 `prepare()` / `prepareWithSegments()`
- 制表符遵循浏览器默认的 `tab-size: 8`
- `{ wordBreak: 'keep-all' }` 也受支持。对 CJK/韩文及无空格混合拉丁/数字/CJK 文本按预期运行，同时对超长段落保留 `overflow-wrap: break-word` 回退。
- `system-ui` 在 macOS 上对 `layout()` 精度不安全。请使用具名字体。
- 运行时需要 `Intl.Segmenter` 和 Canvas 2D 文本测量。不支持缺少 `Intl.Segmenter` 的浏览器或运行时。
- canvas `font` 简写之外的 CSS 文本特性（如 `font-optical-sizing`、`font-feature-settings`、独立的 `font-variation-settings`）不单独建模。可变字体轴只有在活动轴反映在 canvas 字体字符串中时才有帮助，例如通过字重。

## 开发

开发环境搭建与命令详见 [DEVELOPMENT.md](https://github.com/chenglou/pretext/blob/main/DEVELOPMENT.md)。

## 致谢

Sebastian Markbage 十年前用 [text-layout](https://github.com/chenglou/text-layout) 播下了第一颗种子。他的设计——用 canvas `measureText` 进行字形整形、来自 pdf.js 的双向文本、流式换行——构成了我们持续推进的架构基础。
