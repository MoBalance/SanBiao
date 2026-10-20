# 三表（SanBiao）

三表是一套只包含 JSON 的公开规则仓库，用于发布版本化的检测规则与知识题包。它不是应用、
二进制、容器、API、数据库或常驻服务，不需要编译或部署。

## 名称出处

“三表”取自墨子判断言论真伪的三项标准：

- **本**：上本之于古者圣王之事，以历史依据检验主张；
- **原**：下原察百姓耳目之实，以可以观察、复核的经验事实检验主张；
- **用**：发以为刑政，观其中国家百姓人民之利，以实际效用检验主张。

英文代号为 `SanBiao`。仓库用版本化规则表达依据，用实际探针产生可观察证据，并用明确的
评分与限制说明约束结论，分别对应“本、原、用”的方法精神。

## 项目仓库

- 三表规则仓库：<https://github.com/MoBalance/SanBiao>
- 法仪探测引擎：<https://github.com/MoBalance/TheStandard>
- 明鬼独立检测控制台：<https://github.com/MoBalance/GhostReveal>

法仪从本仓库读取规则 Manifest，明鬼通过法仪的公开 API 使用这些规则产生检测报告。三个项目
分别发布，三表只提供静态 JSON，不包含可执行程序、服务端或运行时配置。

## 仓库结构

```text
SanBiao/
├── README.md
├── manifest.json
├── schemas/
│   ├── repository.schema.json
│   ├── core-rule.schema.json
│   └── knowledge-pack.schema.json
├── rules/
│   └── the-standard/
│       └── stable.json
└── packs/
    └── demo/
        └── the-standard-demo-model.json
```

`manifest.json` 是唯一发现入口。`coreRules` 指向当前法仪规则文档；`knowledgePacks` 按身份、
频道、相对 JSON 路径、规范摘要和目标选择器索引题包。消费者不得枚举仓库目录，也不得执行
仓库内容。

`schemas/core-rule.schema.json` 描述规则文档的稳定信封、当前 payload 版本和顶层能力分区，供
编辑器、代码审查和静态 JSON Schema 工具尽早发现字段遗漏、未知顶层字段或错误类型。它不替代
法仪的强类型解析、资源上限和语义校验；能通过 Schema 的文档仍必须通过法仪测试和规范摘要校验。

当前仓库 release 为 `2026.10.19.3`，其中法仪规则版本为 `2026.10.19.3`。增加或修改 Schema 同样必须递增 release，即使规则文档和
题包摘要本身没有变化。

## 发布地址

默认公开 Manifest 地址：

```text
https://raw.githubusercontent.com/MoBalance/SanBiao/main/manifest.json
```

生产部署可以把 `main` 固定为 40 位 Git commit。固定版本让报告同时记录精确规则版本、规范摘要
和源提交；使用分支地址时仍必须保留规则版本与摘要。

## 规则所有权

`rules/the-standard/stable.json` 负责所有需要独立迭代的规则事实：

- 探针按模式和协议的启用矩阵；
- 提示词、演示响应、上下文梯度、采样计划和输出上限；
- 声明式行为预期；
- 模型、供应方映射和标识符前缀；
- 判定、证据等级、分数、置信度、权重、严重度和分析阈值；
- Juice 模板、档位计划、经验值、模型族映射、校准来源、family 状态和限制说明；
- 中转完整性审计的启用矩阵、敏感标记、扣分项和安全摘要；
- 检测器英文标签、摘要以及不支持和错误说明；
- 缓存复用探针的轮次、共享前缀模板、usage 字段指针和轮次指令；
- 注入量探针的基线提示词、包装提示词、预期额外 token 数与估算阈值；
- 知识截止的串行二分锚点（客观事件 + 日期 + 四选一 + 正确答案）、窗口、提问上限、无效化标记和说明；
- 联网证据探针的提示词、来源 URL 键、执行标记，以及每种协议声明的请求体片段与模式标签；
- 推理 IQ 的评分版本（`scoringVersion`）、八道可验证且答案唯一的题目（题型、期望答案、整型容差）、
  作答格式说明、拒答标记与截断停止原因；评分版本随报告保存，旧报告永不按新题库重算；
- 思维链回传探针的提示词、thinking 类型与预算、思维块与脱敏块类型、字段键、摘要与全文的字符阈值、
  非 Claude 模型标记、模式标签，以及“仅 Anthropic 协议可观测、签名只检查存在性”的限制说明；
- 检测板块的稳定标识、英文标签、说明、默认启用集合，以及每个板块声明的引擎策略（每个策略只归属一个板块）。

法仪实现只负责严格解析、协议处理、统计与匹配算法、密钥保护、资源上限和故障隔离。

## 安全契约

- JSON 只能表达数据，禁止脚本、任意表达式、远程包含和可执行模板；
- 路径只能是仓库内相对 `.json` 路径，禁止目录穿越、凭据、查询参数和片段；
- Manifest 最大 256 KiB，单个文档最大 1 MiB；
- 未知字段、重复身份、无效目标、错误摘要、不安全路径和未知 Schema 版本全部拒绝；
- 没有通过验证的法仪规则时不得生成检测报告；首次加载失败返回 `rules_unavailable`，后续更新
  失败时只保留内存中最后一份有效快照。

## 规范摘要

每个 `digest` 都是规范 UTF-8 JSON 的 SHA-256。对象键按字节顺序递归排序，数组保持原顺序，
数值使用最短等价 JSON 表示。摘要只存于 `manifest.json`，被引用文档不包含自指摘要。

## 报告来源

法仪 0.1.1012 及以上版本会把本仓库 `manifest.json` 的 `release` 写入检测报告和健康状态，并分别
记录 Manifest 与目标 JSON 文档来自 `remote` 还是 `local_fallback`。两个来源都必须经过相同的
路径、大小、Schema、强类型和摘要校验；`local_fallback` 只表示读取位置，不代表放宽校验。

## Juice 校准来源与分类状态

规则文档中的 `calibration` 记录校准批次、完成时间、独立运行次数、每档模板数、是否复用对话
历史、跨轮接受值和未解决观察。当前批次使用两轮完整矩阵，每个 effort 使用三个保持数值恒等的
模板，所有请求均独立发送且不复用对话历史。

每个 family 必须声明 `calibrationState`：`confirmed`、`partial`、`historical` 或 `unstable`。
只有 `classificationEnabled: true` 的 family 才能进入法仪身份候选；被禁用的历史与不稳定 family
仍保留在规则中供审计和后续复测，但不会因为单档位碰撞而命名模型。规范有限小数（例如 `8.855`）
可以作为规则值；带前导零、冗余小数尾零、符号或指数形式的规则值会被拒绝。

Juice 是可复核的经验辅助指纹，不是物理后端身份的密码学证明。中转可以识别探针或伪造正值，
供应方、路由和模型迭代也可能改变观测；任何身份判断都需要与独立协议和行为证据交叉验证。

报告不会写入 GitHub Raw 地址、本地目录或访问凭据。消费者可以组合仓库 release、文档 version、
文档 digest 与法仪版本，判断两份报告是否使用相同规则依据；仅比较某一个字段不足以确认可比性。

## 发布流程

1. 修改或增加 JSON 文档；
2. 递增文档版本与仓库 `release`；
3. 重新计算规范 SHA-256 并更新 `manifest.json`；
4. 使用法仪测试验证 Manifest 和所有引用文档；
5. 提交并发布静态 JSON 仓库，不需要重启任何服务。

## Acknowledgements and research references

三表的规则分区和发布契约吸收了以下公开资料的研究启发：

- [Your Agent Is Mine: Measuring Malicious Intermediary Attacks on the LLM Supply Chain](https://arxiv.org/pdf/2604.08407)：中转层工具调用改写、条件触发、透明日志和响应完整性边界；
- [LLMmap](https://github.com/pasquini-dario/LLMmap)：多样提示模板、开放集候选与行为指纹的组织方式；
- [api-relay-audit](https://github.com/toby-bridges/api-relay-audit)：按查询意图拆分中转审计、模型替换、流完整性和“不确定”边界的报告方式。

论文属于学术出版物；LLMmap 采用 GPL-3.0；api-relay-audit 采用 AGPL-3.0-only。上述链接只用于
研究、术语和能力设计启发。SanBiao 的 JSON 规则、摘要、字段和发布流程均由本项目
独立编写，没有复制第三方源代码、模型权重、提示词或规则内容；第三方项目的许可证和版权仍归其
各自作者所有。法仪消费本仓库，明鬼通过法仪 API 展示结果：
[TheStandard](https://github.com/MoBalance/TheStandard) ·
[GhostReveal](https://github.com/MoBalance/GhostReveal)。
