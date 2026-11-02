// Keep argument text intact; only whitespace outside strings/escapes is reformatted.
export function formatNginx(source: string): string {
  const lines: string[] = [];
  let pending = "";
  let depth = 0;
  let quote = "";
  let escaped = false;
  let sameLine = false;
  let continued = false;
  let generatedSpace = false;
  const directiveText = () => generatedSpace ? pending.slice(0, -1) : pending;
  const emit = (text: string) => {
    lines.push("  ".repeat(depth) + text);
    pending = "";
    generatedSpace = false;
    sameLine = true;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (escaped) { pending += c; escaped = false; generatedSpace = false; continue; }
    if (c === "\\") { pending += c; escaped = true; generatedSpace = false; continue; }
    if (quote) {
      pending += c;
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") { pending += c; quote = c; generatedSpace = false; continue; }
    if (c === "$" && source[i + 1] === "{") {
      const end = source.indexOf("}", i + 2);
      if (end < 0) throw new Error("Nginx 变量缺少闭合花括号");
      pending += source.slice(i, end + 1); generatedSpace = false; i = end; continue;
    }
    if (c === "#") {
      const end = source.indexOf("\n", i);
      const comment = source.slice(i, end < 0 ? source.length : end).trimEnd();
      if (pending.trim()) { emit(directiveText()); continued = true; }
      if (sameLine && lines.length) lines[lines.length - 1] += " " + comment;
      else emit(comment);
      sameLine = false;
      i = end < 0 ? source.length : end;
      continue;
    }
    if (/\s/.test(c)) {
      if (pending && !generatedSpace) { pending += " "; generatedSpace = true; }
      if (c === "\n") sameLine = false;
      continue;
    }
    // Preserve regex quantifiers inside an unquoted argument.
    if (c === "{" && pending && !pending.endsWith(" ")) {
      const quantifier = source.slice(i).match(/^\{\d+(?:,\d*)?\}/);
      if (quantifier) { pending += quantifier[0]; generatedSpace = false; i += quantifier[0].length - 1; continue; }
    }
    if (c === "{") {
      if (!pending.trim() && !continued) throw new Error("Nginx 配置块缺少指令名称");
      emit(directiveText() + " {"); depth++; continued = false;
    } else if (c === ";") {
      if (!pending.trim() && !continued) throw new Error("Nginx 存在空指令");
      emit(directiveText() + ";"); continued = false;
    } else if (c === "}") {
      if (pending.trim() || continued) throw new Error("Nginx 指令末尾缺少分号");
      if (!depth) throw new Error("Nginx 存在多余的闭合花括号");
      depth--; emit("}");
    } else { pending += c; generatedSpace = false; }
  }
  if (quote || escaped) throw new Error("Nginx 字符串或转义未结束");
  if (depth) throw new Error("Nginx 配置块缺少闭合花括号");
  if (pending.trim() || continued) throw new Error("Nginx 指令末尾缺少分号");
  return lines.length ? lines.join("\n") + "\n" : "";
}

export async function formatDocument(content: string, language: string, filename: string): Promise<string> {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  if (language === "nginx") {
    return formatNginx(content.replace(/\r\n/g, "\n")).replace(/\n/g, eol);
  }
  if (["html", "javascript", "json"].includes(language)) {
    const [prettier, babel, estree, html, typescript] = await Promise.all([
      import("prettier/standalone"), import("prettier/plugins/babel"),
      import("prettier/plugins/estree"), import("prettier/plugins/html"),
      import("prettier/plugins/typescript"),
    ]);
    const parser = language === "html" ? "html" : language === "json"
      ? (filename.toLowerCase().endsWith(".jsonc") ? "jsonc" : "json")
      : /\.(?:ts|tsx)$/i.test(filename) ? "typescript" : "babel";
    return prettier.format(content, {
      parser, plugins: [babel, estree, html, typescript],
      tabWidth: 2, useTabs: false, endOfLine: eol === "\r\n" ? "crlf" : "lf",
    });
  }
  return content.split(/\r?\n/).map(line => line.trimEnd()).join(eol);
}

export function isFormatShortcut(event: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string; isComposing?: boolean }): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyF" && !event.isComposing;
}
