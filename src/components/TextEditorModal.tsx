import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Save,
  Check,
  RotateCw,
  Copy,
  Search,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Code2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { FileEntry, PreviewResult } from "../types";

export type SupportedLanguage =
  | "html"
  | "json"
  | "nginx"
  | "shell"
  | "yaml"
  | "xml"
  | "markdown"
  | "css"
  | "javascript"
  | "plaintext";

export function detectLanguage(filename: string): SupportedLanguage {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "json";
  if (lower.endsWith(".nginx") || lower.endsWith(".conf") || lower.includes("nginx")) return "nginx";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "shell";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return "xml";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) return "css";
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return "javascript";
  }
  return "plaintext";
}

export interface ValidationResult {
  status: "valid" | "warning" | "none";
  message: string;
  line?: number;
  col?: number;
}

// Void (self-closing) elements in HTML
const HTML_VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
  "!doctype",
]);

// Real-time Format Validators
function validateContent(content: string, lang: SupportedLanguage): ValidationResult {
  if (!content.trim()) {
    return { status: "none", message: "文件为空" };
  }

  if (lang === "json") {
    try {
      JSON.parse(content);
      return { status: "valid", message: "JSON 语法结构正常" };
    } catch (err: any) {
      const msg = err?.message || String(err);
      let line: number | undefined;
      let col: number | undefined;
      const posMatch = msg.match(/position (\d+)/i);
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        const linesBefore = content.slice(0, pos).split("\n");
        line = linesBefore.length;
        col = linesBefore[linesBefore.length - 1].length + 1;
      } else {
        const lineMatch = msg.match(/line (\d+) column (\d+)/i);
        if (lineMatch) {
          line = parseInt(lineMatch[1], 10);
          col = parseInt(lineMatch[2], 10);
        }
      }
      let cleanMsg = msg.replace(/^JSON\.parse: /, "").replace(/at position \d+/i, "");
      if (
        cleanMsg.includes("Unexpected token }") ||
        cleanMsg.includes("Expected double-quoted property name")
      ) {
        cleanMsg += " (可能多写了逗号或属性名缺少双引号)";
      }
      return {
        status: "warning",
        message: line ? `第 ${line} 行：${cleanMsg.trim()}` : cleanMsg.trim(),
        line,
        col,
      };
    }
  }

  if (lang === "html" || lang === "xml") {
    const lines = content.split("\n");
    const stack: { tag: string; line: number; col: number }[] = [];

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const lineText = lines[lineNum - 1];
      const tagRegex = /<\/?([a-zA-Z0-9\-:]+)([^>]*?)(\/?)>/g;
      let m;
      while ((m = tagRegex.exec(lineText)) !== null) {
        const fullMatch = m[0];
        const tagName = m[1].toLowerCase();
        const isSelfClosing = m[3] === "/" || fullMatch.endsWith("/>");
        const isClosing = fullMatch.startsWith("</");

        if (HTML_VOID_ELEMENTS.has(tagName) || isSelfClosing || tagName.startsWith("!")) {
          continue;
        }

        if (isClosing) {
          if (stack.length === 0) {
            return {
              status: "warning",
              message: `第 ${lineNum} 行：发现孤立的多余闭合标签 </${tagName}>`,
              line: lineNum,
              col: m.index + 1,
            };
          }
          const last = stack.pop()!;
          if (last.tag !== tagName) {
            return {
              status: "warning",
              message: `第 ${lineNum} 行：标签嵌套错位，期望 </${last.tag}> (第 ${last.line} 行)，但遇到了 </${tagName}>`,
              line: lineNum,
              col: m.index + 1,
            };
          }
        } else {
          stack.push({ tag: tagName, line: lineNum, col: m.index + 1 });
        }
      }
    }

    if (stack.length > 0) {
      const unclosed = stack[stack.length - 1];
      return {
        status: "warning",
        message: `第 ${unclosed.line} 行：<${unclosed.tag}> 标签未找到对应的闭合标签 </${unclosed.tag}>`,
        line: unclosed.line,
        col: unclosed.col,
      };
    }
    return { status: "valid", message: `${lang.toUpperCase()} 标签嵌套完整正确` };
  }

  if (lang === "nginx") {
    const lines = content.split("\n");
    let openBraces = 0;
    let lastOpenLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.split("#")[0].trim();
      if (!line) continue;

      for (const ch of line) {
        if (ch === "{") {
          openBraces++;
          lastOpenLine = i + 1;
        } else if (ch === "}") {
          openBraces--;
          if (openBraces < 0) {
            return {
              status: "warning",
              message: `第 ${i + 1} 行：多余未匹配的闭合花括号 '}'`,
              line: i + 1,
            };
          }
        }
      }

      const directivesNeedSemicolon = [
        "listen",
        "server_name",
        "root",
        "index",
        "proxy_pass",
        "proxy_set_header",
        "add_header",
        "return",
        "rewrite",
        "access_log",
        "error_log",
        "ssl_certificate",
        "ssl_certificate_key",
        "client_max_body_size",
      ];
      const firstWord = line.split(/\s+/)[0];
      if (
        directivesNeedSemicolon.includes(firstWord) &&
        !line.endsWith(";") &&
        !line.endsWith("{") &&
        !line.endsWith("}")
      ) {
        return {
          status: "warning",
          message: `第 ${i + 1} 行：指令 '${firstWord}' 疑似漏写了结尾分号 ';' `,
          line: i + 1,
        };
      }
    }

    if (openBraces > 0) {
      return {
        status: "warning",
        message: `配置块未闭合：共有 ${openBraces} 个 '{' 未匹配闭合（最近在第 ${lastOpenLine} 行）`,
        line: lastOpenLine,
      };
    }
    return { status: "valid", message: "Nginx 配置块语法正常" };
  }

  if (lang === "yaml") {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\t+/.test(line)) {
        return {
          status: "warning",
          message: `第 ${i + 1} 行：YAML 规范禁止使用 Tab 制表符缩进，请使用空格`,
          line: i + 1,
        };
      }
      const trimmed = line.trim();
      if (
        !trimmed.startsWith("#") &&
        /^[a-zA-Z0-9_-]+:[^\s\n#\/]/.test(trimmed) &&
        !trimmed.startsWith("http:") &&
        !trimmed.startsWith("https:")
      ) {
        return {
          status: "warning",
          message: `第 ${i + 1} 行：冒号后疑似缺少空格 (格式建议为 key: value)`,
          line: i + 1,
        };
      }
    }
    return { status: "valid", message: "YAML 缩进格式正常" };
  }

  if (lang === "shell") {
    const lines = content.split("\n");
    let ifCount = 0;
    let forCount = 0;
    let caseCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].split("#")[0].trim();
      if (!line) continue;
      const words = line.split(/\s+/);
      if (words[0] === "if") ifCount++;
      if (words[0] === "fi" || words.includes("fi")) ifCount = Math.max(0, ifCount - 1);
      if (words[0] === "for" || words[0] === "while") forCount++;
      if (words[0] === "done" || words.includes("done")) forCount = Math.max(0, forCount - 1);
      if (words[0] === "case") caseCount++;
      if (words[0] === "esac") caseCount = Math.max(0, caseCount - 1);
    }

    if (ifCount > 0) {
      return { status: "warning", message: `Shell 结构提示：有 ${ifCount} 处 if 缺少对应的 fi 闭合` };
    }
    if (forCount > 0) {
      return { status: "warning", message: "Shell 结构提示：循环块缺少对应的 done 闭合" };
    }
    if (caseCount > 0) {
      return { status: "warning", message: "Shell 结构提示：case 语句缺少对应的 esac 闭合" };
    }
    return { status: "valid", message: "Shell 基础语法结构正常" };
  }

  return { status: "none", message: "" };
}

// Snippet Template definitions
export interface SnippetItem {
  prefix: string;
  name: string;
  description: string;
  template: string;
  cursorOffset?: number; // Cursor position relative to inserted template start
}

const SNIPPET_COLLECTIONS: Record<SupportedLanguage, SnippetItem[]> = {
  html: [
    {
      prefix: "!",
      name: "HTML5 页面骨架 (!)",
      description: "标准 HTML5 结构骨架（带 meta viewport 与 title）",
      template: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Document</title>
</head>
<body>
  
</body>
</html>`,
      cursorOffset: 154,
    },
    {
      prefix: "div",
      name: "div 容器",
      description: "标准 <div> 容器块",
      template: `<div>\n  \n</div>`,
      cursorOffset: 8,
    },
    {
      prefix: "a",
      name: "超链接 (a)",
      description: "超链接标签",
      template: `<a href="#" target="_blank">链接文本</a>`,
      cursorOffset: 9,
    },
    {
      prefix: "link:css",
      name: "样式表引入 (link:css)",
      description: "引入外部 CSS 样式表",
      template: `<link rel="stylesheet" href="style.css">`,
      cursorOffset: 29,
    },
    {
      prefix: "script:src",
      name: "脚本引入 (script:src)",
      description: "引入外部 JavaScript 脚本",
      template: `<script src="app.js"></script>`,
      cursorOffset: 13,
    },
    {
      prefix: "table",
      name: "表格结构 (table)",
      description: "包含 thead / tbody 的标准表格",
      template: `<table>
  <thead>
    <tr>
      <th>标题 1</th>
      <th>标题 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>数据 1</td>
      <td>数据 2</td>
    </tr>
  </tbody>
</table>`,
    },
    {
      prefix: "form",
      name: "表单结构 (form)",
      description: "POST 提交表单骨架",
      template: `<form action="/api/submit" method="POST">
  <label for="name">名称:</label>
  <input type="text" id="name" name="name" required>
  <button type="submit">提交</button>
</form>`,
    },
    {
      prefix: "flex-center",
      name: "Flex 居中样式 (style)",
      description: "居中对齐样式片段",
      template: `<div style="display: flex; align-items: center; justify-content: center; height: 100vh;">
  
</div>`,
      cursorOffset: 80,
    },
  ],
  nginx: [
    {
      prefix: "server",
      name: "HTTP 80 基础虚拟主机",
      description: "标准 Nginx 80 端口静态文件服务",
      template: `server {
    listen 80;
    server_name example.com www.example.com;
    root /var/www/html;
    index index.html index.htm;

    location / {
        try_files $uri $uri/ /index.html;
    }
}`,
    },
    {
      prefix: "proxy",
      name: "反向代理 (proxy_pass)",
      description: "标准生产级反代（带客户端真实 IP 和 Host 标头）",
      template: `location /api/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 60s;
    proxy_read_timeout 60s;
}`,
    },
    {
      prefix: "websocket",
      name: "WebSocket 代理配置",
      description: "支持 WebSocket Upgrade 协议升级代理",
      template: `location /ws/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}`,
    },
    {
      prefix: "cors",
      name: "CORS 跨域响应头",
      description: "支持跨域访问全套响应头设置",
      template: `add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
if ($request_method = 'OPTIONS') {
    return 204;
}`,
    },
    {
      prefix: "ssl",
      name: "HTTPS 443 SSL 证书配置",
      description: "安全强度的 TLS 1.2/1.3 证书配置",
      template: `server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/nginx/ssl/example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/example.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        root /var/www/html;
        index index.html;
    }
}`,
    },
  ],
  shell: [
    {
      prefix: "shebang",
      name: "Bash 严谨模式头 (shebang)",
      description: "带错误即停与管道失败捕获的脚本头",
      template: `#!/usr/bin/env bash
set -euo pipefail
IFS=$'\\n\\t'

echo "=== 脚本开始执行 ==="
`,
    },
    {
      prefix: "if",
      name: "If-Else 条件分支",
      description: "标准 Shell 条件判断",
      template: `if [[ -f "/path/to/file" ]]; then
    echo "文件存在"
else
    echo "文件不存在"
fi`,
    },
    {
      prefix: "for",
      name: "For 循环数组遍历",
      description: "遍历数组或列表",
      template: `items=("alpha" "beta" "gamma")
for item in "\${items[@]}"; do
    echo "Processing: $item"
done`,
    },
    {
      prefix: "func",
      name: "标准函数模板",
      description: "带参数提取的 Bash 函数",
      template: `my_function() {
    local arg1="$1"
    local arg2="\${2:-default_val}"
    echo "Running with $arg1, $arg2"
}`,
    },
  ],
  json: [
    {
      prefix: "object",
      name: "基础 JSON 对象",
      description: "标准键值对象结构",
      template: `{\n  "name": "example",\n  "version": "1.0.0",\n  "enabled": true\n}`,
    },
    {
      prefix: "package",
      name: "package.json 骨架",
      description: "Node.js package.json 基础骨架",
      template: `{
  "name": "my-project",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC"
}`,
    },
  ],
  yaml: [
    {
      prefix: "docker-compose",
      name: "Docker Compose 基础服务",
      description: "标准 docker-compose.yml 结构",
      template: `version: '3.8'

services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    restart: always`,
    },
  ],
  xml: [],
  markdown: [
    {
      prefix: "table",
      name: "Markdown 表格",
      description: "标准 Markdown 表格排版",
      template: `| 列名 1 | 列名 2 | 列名 3 |
| :--- | :---: | ---: |
| 内容 A | 内容 B | 内容 C |`,
    },
  ],
  css: [
    {
      prefix: "reset",
      name: "CSS 基础重置",
      description: "通用 box-sizing 与 margin 归零",
      template: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}`,
    },
  ],
  javascript: [
    {
      prefix: "async-fetch",
      name: "Async/Await Fetch 请求",
      description: "标准带错误处理的 JSON API 请求",
      template: `async function fetchData(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(\`HTTP error! status: \${res.status}\`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("请求失败:", err);
    throw err;
  }
}`,
    },
  ],
  plaintext: [],
};

interface TextEditorModalProps {
  entry: FileEntry;
  previewResult: PreviewResult | null;
  loading: boolean;
  error: string | null;
  isOpen: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  onSave: (content: string) => Promise<boolean>;
  onClose: () => void;
  onReload: (mode?: "tail" | "head") => void;
}

export const TextEditorModal: React.FC<TextEditorModalProps> = ({
  entry,
  previewResult,
  loading,
  error,
  isOpen,
  isSaving,
  saveSuccess,
  onSave,
  onClose,
  onReload,
}) => {
  const [content, setContent] = useState<string>("");
  const [isWrap, setIsWrap] = useState<boolean>(true);
  const [cursorPos, setCursorPos] = useState<{ line: number; col: number }>({ line: 1, col: 1 });
  const [showSnippetsMenu, setShowSnippetsMenu] = useState<boolean>(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState<boolean>(false);
  const [formatSuccess, setFormatSuccess] = useState<boolean>(false);

  // Search in editor state
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState<number>(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const lang = useMemo(() => detectLanguage(entry.name), [entry.name]);
  const isDirty = useMemo(() => {
    return previewResult ? content !== previewResult.content : false;
  }, [content, previewResult]);

  // Sync initial content on open or when previewResult updates
  useEffect(() => {
    if (previewResult) {
      setContent(previewResult.content);
    }
  }, [previewResult]);

  // Auto-focus textarea on load
  useEffect(() => {
    if (isOpen && !loading) {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [isOpen, loading]);

  // Validation Result (Debounced calculation)
  const validation = useMemo(() => {
    return validateContent(content, lang);
  }, [content, lang]);

  // Line count and numbers
  const lines = useMemo(() => {
    return content.split("\n");
  }, [content]);

  // Sync scrolling between textarea and line number gutter
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) {
      gutterRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Update cursor line & col position
  const updateCursorPosition = useCallback(() => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart || 0;
    const textBefore = content.substring(0, pos);
    const splitLines = textBefore.split("\n");
    setCursorPos({
      line: splitLines.length,
      col: splitLines[splitLines.length - 1].length + 1,
    });
  }, [content]);

  // Jump to specific line (used by validation warnings)
  const jumpToLine = (targetLine?: number) => {
    if (!targetLine || !textareaRef.current) return;
    const allLines = content.split("\n");
    let charOffset = 0;
    for (let i = 0; i < Math.min(targetLine - 1, allLines.length); i++) {
      charOffset += allLines[i].length + 1;
    }
    textareaRef.current.focus();
    textareaRef.current.selectionStart = textareaRef.current.selectionEnd = charOffset;
    updateCursorPosition();

    // Scroll to the line
    const approxLineHeight = 18; // approx px per line
    textareaRef.current.scrollTop = Math.max(0, (targetLine - 3) * approxLineHeight);
  };

  // Insert snippet template at current cursor
  const insertSnippet = (snippet: SnippetItem) => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const newContent = content.substring(0, start) + snippet.template + content.substring(end);
    setContent(newContent);
    setShowSnippetsMenu(false);

    const targetPos = start + (snippet.cursorOffset ?? snippet.template.length);
    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = targetPos;
      updateCursorPosition();
    }, 10);
  };

  // Format / Prettify Content
  const handleFormatContent = () => {
    if (lang === "json") {
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        setContent(formatted);
        setFormatSuccess(true);
        setTimeout(() => setFormatSuccess(false), 2000);
      } catch (err: any) {
        alert(`格式化失败: ${err?.message || "JSON 格式不合法"}`);
      }
    } else {
      // Basic whitespace / empty lines clean-up
      const cleaned = content
        .split("\n")
        .map((l) => l.trimEnd())
        .join("\n");
      setContent(cleaned);
      setFormatSuccess(true);
      setTimeout(() => setFormatSuccess(false), 2000);
    }
  };

  // Advanced Keyboard Handlers: Tab indent, Auto-close brackets & HTML tags
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    // Ctrl+S / Cmd+S: Save file
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave(content);
      return;
    }

    // Ctrl+F / Cmd+F: Toggle Search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setShowSearch(true);
      setTimeout(() => searchInputRef.current?.select(), 50);
      return;
    }

    // Tab key: Snippet expansion or 2-space indentation
    if (e.key === "Tab") {
      e.preventDefault();
      // Check if word immediately before cursor matches any snippet prefix
      const beforeCursor = content.substring(0, start);
      const match = beforeCursor.match(/([a-zA-Z0-9_:\-!]+)$/);
      const availableSnippets = SNIPPET_COLLECTIONS[lang] || [];

      if (match && !e.shiftKey) {
        const word = match[1];
        const found = availableSnippets.find((s) => s.prefix === word);
        if (found) {
          const replaceStart = start - word.length;
          const newContent =
            content.substring(0, replaceStart) + found.template + content.substring(end);
          setContent(newContent);
          const newCursor = replaceStart + (found.cursorOffset ?? found.template.length);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = newCursor;
            updateCursorPosition();
          }, 10);
          return;
        }
      }

      // Default: insert 2 spaces
      const newVal = content.substring(0, start) + "  " + content.substring(end);
      setContent(newVal);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        updateCursorPosition();
      }, 0);
      return;
    }

    // Auto-close brackets & quotes
    const PAIRS: Record<string, string> = {
      "(": ")",
      "[": "]",
      "{": "}",
      '"': '"',
      "'": "'",
      "`": "`",
    };

    if (PAIRS[e.key] && start === end) {
      const closeChar = PAIRS[e.key];
      // Only auto-pair if not directly followed by alphanumeric
      const nextChar = content.charAt(start);
      if (!nextChar || /\s|[)\]};,>]/.test(nextChar)) {
        e.preventDefault();
        const newVal = content.substring(0, start) + e.key + closeChar + content.substring(end);
        setContent(newVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
          updateCursorPosition();
        }, 0);
        return;
      }
    }

    // Auto tag closing for HTML/XML: typing '>' when opening a tag
    if (e.key === ">" && (lang === "html" || lang === "xml") && start === end) {
      const textBefore = content.substring(0, start);
      const tagMatch = textBefore.match(/<([a-zA-Z0-9\-:]+)([^>]*)$/);
      if (tagMatch && !tagMatch[0].startsWith("</") && !tagMatch[2].endsWith("/")) {
        const tagName = tagMatch[1].toLowerCase();
        if (!HTML_VOID_ELEMENTS.has(tagName)) {
          e.preventDefault();
          const closeTag = `</${tagMatch[1]}>`;
          const newVal = content.substring(0, start) + ">" + closeTag + content.substring(end);
          setContent(newVal);
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 1; // Cursor stays in between ><
            updateCursorPosition();
          }, 0);
          return;
        }
      }
    }

    // Enter key: Smart indentation between braces {} or tags ><
    if (e.key === "Enter" && start === end) {
      const prevChar = content.charAt(start - 1);
      const nextChar = content.charAt(start);

      // Current line indent level
      const currentLine = content.substring(0, start).split("\n").pop() || "";
      const indentMatch = currentLine.match(/^(\s*)/);
      const currentIndent = indentMatch ? indentMatch[1] : "";

      if ((prevChar === "{" && nextChar === "}") || (prevChar === ">" && nextChar === "<")) {
        e.preventDefault();
        const extraIndent = "  ";
        const insertText = `\n${currentIndent}${extraIndent}\n${currentIndent}`;
        const newVal = content.substring(0, start) + insertText + content.substring(end);
        setContent(newVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd =
            start + 1 + currentIndent.length + extraIndent.length;
          updateCursorPosition();
        }, 0);
        return;
      } else if (currentIndent) {
        e.preventDefault();
        const insertText = `\n${currentIndent}`;
        const newVal = content.substring(0, start) + insertText + content.substring(end);
        setContent(newVal);
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
          updateCursorPosition();
        }, 0);
        return;
      }
    }
  };

  // Search logic
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      setActiveMatchIdx(-1);
      return;
    }
    const matches: number[] = [];
    const query = searchQuery.toLowerCase();
    const lowerContent = content.toLowerCase();
    let idx = lowerContent.indexOf(query);
    while (idx !== -1) {
      matches.push(idx);
      idx = lowerContent.indexOf(query, idx + query.length);
    }
    setSearchMatches(matches);
    setActiveMatchIdx(matches.length > 0 ? 0 : -1);
  }, [searchQuery, content]);

  const goToMatch = (matchIndex: number) => {
    if (!textareaRef.current || matchIndex < 0 || matchIndex >= searchMatches.length) return;
    const pos = searchMatches[matchIndex];
    textareaRef.current.focus();
    textareaRef.current.selectionStart = pos;
    textareaRef.current.selectionEnd = pos + searchQuery.length;
    setActiveMatchIdx(matchIndex);
    updateCursorPosition();
  };

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (activeMatchIdx + 1) % searchMatches.length;
    goToMatch(nextIdx);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (activeMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    goToMatch(prevIdx);
  };

  // Safe Close Request
  const requestClose = () => {
    if (isDirty) {
      setShowUnsavedPrompt(true);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  const availableSnippets = SNIPPET_COLLECTIONS[lang] || [];

  return createPortal(
    <div
      style={{ zIndex: 10000 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-100 select-none"
      onClick={requestClose}
    >
      <div
        className="w-[980px] max-w-full h-[88vh] max-h-[920px] bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-120"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Editor Top Toolbar */}
        <div className="h-12 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 flex items-center justify-between flex-shrink-0">
          {/* File Title & Info */}
          <div className="flex items-center space-x-2.5 min-w-0 pr-3">
            <div className="w-7 h-7 rounded-lg bg-[#007AFF]/15 text-[#007AFF] flex items-center justify-center flex-shrink-0">
              <Code2 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-[13px] text-[var(--text-primary)] truncate font-mono">
                  {entry.name}
                </span>
                {isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="有未保存修改" />
                )}
                <span className="text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded bg-[var(--hover-item)] text-[var(--text-secondary)]">
                  {lang}
                </span>
              </div>
              <div className="text-[10.5px] text-[var(--text-tertiary)] truncate font-mono">
                {entry.path}
              </div>
            </div>
          </div>

          {/* Action Buttons Bar */}
          <div className="flex items-center space-x-1.5 flex-shrink-0">
            {/* Snippets Dropdown */}
            {availableSnippets.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSnippetsMenu(!showSnippetsMenu)}
                  className={`px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium flex items-center space-x-1.5 transition cursor-pointer ${
                    showSnippetsMenu
                      ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                      : "bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                  title="插入常用代码片段与模板"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>常用片段</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showSnippetsMenu ? "rotate-180" : ""}`} />
                </button>

                {showSnippetsMenu && (
                  <div
                    className="absolute right-0 top-9 z-50 w-72 max-h-80 overflow-y-auto bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-1.5 text-[11.5px] apple-vibrancy-popover animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase border-b border-[var(--border-subtle)]/50 mb-1">
                      {lang.toUpperCase()} 常用代码模板 (可按 Tab 展开)
                    </div>
                    {availableSnippets.map((s) => (
                      <div
                        key={s.prefix}
                        onClick={() => insertSnippet(s)}
                        className="px-2 py-1.5 rounded-lg hover:bg-[var(--hover-item)] cursor-pointer text-left transition flex flex-col group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--text-primary)] group-hover:text-[#007AFF]">
                            {s.name}
                          </span>
                          <span className="text-[10px] font-mono px-1 rounded bg-[var(--bg-app)] text-[var(--text-secondary)]">
                            {s.prefix}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-[var(--text-tertiary)] mt-0.5 truncate">
                          {s.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Format / Prettify Button */}
            <button
              type="button"
              onClick={handleFormatContent}
              title="代码排版与格式化"
              className={`px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[11.5px] font-medium flex items-center space-x-1.5 transition cursor-pointer ${
                formatSuccess
                  ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {formatSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>已格式化</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5 text-[#007AFF]" />
                  <span>格式化</span>
                </>
              )}
            </button>

            {/* Find Search Button */}
            <button
              type="button"
              onClick={() => {
                setShowSearch(!showSearch);
                if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
              }}
              title="搜索文本 (⌘F)"
              className={`p-1.5 rounded-lg border border-[var(--border-subtle)] transition cursor-pointer ${
                showSearch
                  ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/30"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            {/* Wrap Toggle */}
            <button
              type="button"
              onClick={() => setIsWrap(!isWrap)}
              title={isWrap ? "当前自动换行 (点击改为不换行)" : "当前横向滚动 (点击改为自动换行)"}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium border border-[var(--border-subtle)] transition cursor-pointer ${
                isWrap
                  ? "bg-[#007AFF]/15 text-[#007AFF] border-[#007AFF]/25"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)]"
              }`}
            >
              {isWrap ? "已换行" : "未换行"}
            </button>

            {/* Copy Button */}
            <button
              type="button"
              onClick={() => {
                if (content) navigator.clipboard.writeText(content);
              }}
              title="复制全部内容"
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>

            {/* Reload Button */}
            <button
              type="button"
              onClick={() => {
                if (isDirty && !window.confirm("刷新将丢失未保存的改动，确定继续吗？")) return;
                onReload(previewResult?.mode || "tail");
              }}
              title="重新读取服务器最新内容"
              className="p-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--hover-item)] text-[var(--text-secondary)] hover:text-[#007AFF] transition cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#007AFF]" : ""}`} />
            </button>

            {/* Save Button */}
            <button
              type="button"
              onClick={() => onSave(content)}
              disabled={isSaving}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium flex items-center space-x-1.5 shadow-sm transition active:scale-95 cursor-pointer ${
                saveSuccess
                  ? "bg-emerald-600 text-white"
                  : isDirty
                  ? "bg-[#007AFF] hover:bg-[#0A84FF] text-white"
                  : "bg-[var(--hover-item)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              }`}
            >
              {saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>已保存</span>
                </>
              ) : isSaving ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>保存{isDirty ? "*" : ""} (⌘S)</span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={requestClose}
              title="关闭 (Esc)"
              className="p-1.5 rounded-lg hover:bg-[var(--hover-item)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Floating Bar */}
        {showSearch && (
          <div className="px-4 py-2 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center justify-between text-xs animate-in slide-in-from-top-1 duration-100 flex-shrink-0">
            <div className="flex items-center space-x-2 flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.shiftKey ? handlePrevMatch() : handleNextMatch();
                  } else if (e.key === "Escape") {
                    setShowSearch(false);
                  }
                }}
                placeholder="在当前文件中查找文本 (Enter 下一个，Shift+Enter 上一个)..."
                className="flex-1 bg-[var(--input-bg)] border border-[var(--border-subtle)] focus:border-[#007AFF] rounded-md px-2 py-1 text-[11.5px] font-mono text-[var(--text-primary)] outline-none"
              />
              <span className="text-[11px] text-[var(--text-tertiary)] font-mono flex-shrink-0">
                {searchMatches.length > 0
                  ? `${activeMatchIdx + 1} / ${searchMatches.length}`
                  : searchQuery
                  ? "无结果"
                  : ""}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={handlePrevMatch}
                disabled={searchMatches.length === 0}
                className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 text-[var(--text-secondary)]"
                title="上一个匹配"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                disabled={searchMatches.length === 0}
                className="p-1 rounded hover:bg-[var(--hover-item)] disabled:opacity-30 text-[var(--text-secondary)]"
                title="下一个匹配"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSearch(false)}
                className="p-1 rounded hover:bg-[var(--hover-item)] text-[var(--text-tertiary)]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Truncated File Notice */}
        {previewResult && previewResult.is_truncated && (
          <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-500 flex items-center justify-between flex-shrink-0">
            <span>
              ⚠️ 注意：此文件较大（当前仅截取预览了部分）。保存将以此内容覆盖，如需完整编辑建议下载修改。
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => onReload(previewResult.mode === "tail" ? "head" : "tail")}
                className="underline hover:text-amber-400 font-medium cursor-pointer"
              >
                {previewResult.mode === "tail" ? "切换查看开头" : "切换查看尾部"}
              </button>
            </div>
          </div>
        )}

        {/* Main Editor Body: Line Numbers + Textarea */}
        <div className="flex-1 flex overflow-hidden bg-[var(--bg-terminal)] relative">
          {loading ? (
            <div className="flex-1 flex items-center justify-center space-x-2 text-[var(--text-tertiary)] text-xs">
              <RotateCw className="w-5 h-5 animate-spin text-[#007AFF]" />
              <span>正在读取文件内容...</span>
            </div>
          ) : error ? (
            <div className="flex-1 p-6 text-red-400 font-mono text-xs">
              {error}
            </div>
          ) : (
            <div className="flex-1 flex overflow-hidden relative">
              {/* Line Numbers Gutter */}
              <div
                ref={gutterRef}
                className="w-12 py-3 bg-[var(--bg-app)]/40 border-r border-[var(--border-subtle)] text-[var(--text-tertiary)]/70 font-mono text-[12px] leading-[20px] select-none text-right pr-2.5 overflow-hidden flex-shrink-0"
              >
                {lines.map((_, i) => {
                  const lineNum = i + 1;
                  const isCurrent = cursorPos.line === lineNum;
                  return (
                    <div
                      key={lineNum}
                      className={`h-[20px] ${
                        isCurrent ? "text-[#007AFF] font-bold" : ""
                      }`}
                    >
                      {lineNum}
                    </div>
                  );
                })}
              </div>

              {/* Textarea Input Core */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  updateCursorPosition();
                }}
                onKeyDown={handleKeyDown}
                onClick={updateCursorPosition}
                onKeyUp={updateCursorPosition}
                onScroll={handleScroll}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                placeholder="文件为空，可在此直接输入内容..."
                style={{
                  lineHeight: "20px",
                }}
                className={`flex-1 py-3 px-3 font-mono text-[12px] resize-none outline-none border-none bg-transparent text-[var(--text-primary)] selection:bg-[#007AFF]/30 ${
                  isWrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto"
                }`}
                wrap={isWrap ? "soft" : "off"}
              />
            </div>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="h-7 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 flex items-center justify-between text-[11px] font-mono text-[var(--text-secondary)] select-none flex-shrink-0">
          {/* Left: Cursor Line & Col & Stats */}
          <div className="flex items-center space-x-3">
            <span>
              第 <strong className="text-[var(--text-primary)]">{cursorPos.line}</strong> 行，第{" "}
              <strong className="text-[var(--text-primary)]">{cursorPos.col}</strong> 列
            </span>
            <span className="text-[var(--border-subtle)]">|</span>
            <span>
              共 {lines.length} 行 · {content.length} 字符
            </span>
          </div>

          {/* Center: Real-time Syntax Format Validation Badge */}
          <div className="flex items-center space-x-2">
            {validation.status === "valid" ? (
              <div className="flex items-center space-x-1.5 text-emerald-500 font-sans">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{validation.message}</span>
              </div>
            ) : validation.status === "warning" ? (
              <button
                type="button"
                onClick={() => jumpToLine(validation.line)}
                title="点击跳转至问题所在行"
                className="flex items-center space-x-1.5 text-amber-500 hover:text-amber-400 font-sans cursor-pointer group bg-amber-500/10 px-2 py-0.5 rounded transition"
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="truncate max-w-sm group-hover:underline">
                  {validation.message}
                </span>
                {validation.line && (
                  <span className="text-[10px] underline ml-1 font-mono">跳转</span>
                )}
              </button>
            ) : null}
          </div>

          {/* Right: Language, Indent, Encoding */}
          <div className="flex items-center space-x-3">
            <span className="uppercase text-[var(--text-primary)] font-semibold">{lang}</span>
            <span className="text-[var(--border-subtle)]">|</span>
            <span>空格: 2</span>
            <span className="text-[var(--border-subtle)]">|</span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>

      {/* Unsaved Changes Confirmation Dialog */}
      {showUnsavedPrompt && (
        <div
          style={{ zIndex: 10005 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-[3px] flex items-center justify-center p-4 animate-in fade-in duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-[420px] max-w-full bg-[var(--bg-app)] border border-[var(--border-subtle)] rounded-xl shadow-2xl p-5 flex flex-col space-y-4 animate-in zoom-in-95 duration-120">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-full bg-amber-500/15 text-amber-500 flex-shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
                  未保存的修改
                </h3>
                <p className="text-[12px] text-[var(--text-secondary)] mt-1.5 leading-normal">
                  文件「<span className="font-mono font-medium text-[var(--text-primary)]">{entry.name}</span>」已被修改。是否在关闭前保存？
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setShowUnsavedPrompt(false)}
                className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--text-secondary)] hover:bg-[var(--hover-item)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUnsavedPrompt(false);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-lg text-[12px] text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
              >
                放弃修改并关闭
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await onSave(content);
                  if (ok) {
                    setShowUnsavedPrompt(false);
                    onClose();
                  }
                }}
                className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[#007AFF] hover:bg-[#0A84FF] text-white transition active:scale-95 shadow-sm cursor-pointer"
              >
                保存并关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};
