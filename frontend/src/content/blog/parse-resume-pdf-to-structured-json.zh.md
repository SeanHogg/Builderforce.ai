## 简历解析的难题

简历天生就是非结构化的。在版式、章节命名、日期格式或内容组织上，都没有通用标准。一份简历可能把教育背景放在最前，也可能放在最后；可能用“工作经历”“职业背景”或“职业履历”；日期可能写成“2020–2023”“Jan 2020 - Dec 2023”或“1/2020 to 12/2023”。

对于任何需要大规模处理简历的系统——ATS 平台、招聘网站、HR 分析、招聘 CRM——这些非结构化数据都必须转换为一致的、机器可读的格式。这就是简历解析。

传统的基于正则表达式的解析器，会因版式差异而在 20–30% 的简历上失效。像 Builderforce 的 PDF 转 JSON 工具这样的现代 AI 解析器，通过理解上下文而不只是匹配模式，达到了 95% 以上的提取准确率。

## 输出模式

Builderforce 的 PDF 转 JSON 工具会生成一个干净的 JSON 对象，包含以下顶层字段：

```json
{
  "basics": {
    "name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string",
    "website": "string",
    "summary": "string"
  },
  "work": [
    {
      "company": "string",
      "position": "string",
      "startDate": "YYYY-MM",
      "endDate": "YYYY-MM | Present",
      "highlights": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string",
      "graduationDate": "YYYY"
    }
  ],
  "skills": ["string"],
  "certifications": ["string"]
}
```

该模式兼容 JSON Resume 标准，因此很容易与现有的工具和流水线集成。

## 如何使用解析器

**交互式（浏览器）：**
1. 打开位于 Builderforce/tools/pdf-to-json 的 PDF 转 JSON 工具。
2. 拖入 PDF 文件或粘贴简历文本。
3. 点击“解析”——AI 会提取结构化数据并显示 JSON。
4. 复制 JSON，或下载为 .json 文件。

解析器能够处理多栏版式、表格、创意排版和非标准的章节标题。它适用于由 Word、Google Docs、LaTeX、Canva 和各类设计工具生成的 PDF。

## 常见的解析陷阱

**纯图片 PDF。** 有些 PDF 是扫描图像，而不是文本。这类文件在解析前需要先做 OCR。Builderforce 的解析器内置了针对扫描文档的 OCR，但对低质量扫描件，准确率会降到约 85%。

**多语言简历。** 解析器在处理英文简历时效果最好。对其他语言的支持正在改进，但可能会漏掉日期格式和章节命名中的细微差别。

**设计感过强的简历。** 带有信息图、时间线、技能条和环形布局的简历，在提取过程中会丢失一些格式上的细微之处。数据仍会被捕获，但纯视觉元素（比如“Python 熟练度 85%”的技能条）可能无法转换到 JSON 输出中。

**合并的职位。** 如果有人在同一家公司的一行里列出两个职称（“高级工程师 → 资深工程师，2020–2024”），解析器可能会生成一条记录而不是两条。请对这类情况进行抽查。

## 常见问题

### 解析器接受哪些文件格式？

PDF 转 JSON 工具接受 PDF 和 DOCX 文件，以及粘贴的纯文本。PDF 文件可以是文本型的，也可以是扫描件（已包含 OCR）。

### 输出与 JSON Resume 格式兼容吗？

兼容。输出模式遵循 JSON Resume 标准（jsonresume.org），仅在证书和技能方面有少量扩展。你可以把输出直接用于任何兼容 JSON Resume 的工具或主题。

---

**立即试用：** Builderforce 上的 [PDF 转 JSON](/tools/pdf-to-json)。
