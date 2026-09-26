//! Chunking — a source file becomes definition-sized chunks, a symbol list and the set of
//! identifiers it references.
//!
//! A chunk is one function / class / type (the unit an agent actually wants to read), not
//! a fixed window, so a search hit is ~20-80 relevant lines instead of a 4k-token window.
//! Files with no grammar, and the gaps between definitions, fall back to line windows so
//! nothing indexable is dropped.

use crate::lang::{self, LangSpec};
use crate::terms;
use std::collections::BTreeSet;
use std::path::Path;
use tree_sitter::{Node, Parser};

/// A definition larger than this is split (members, or windows) rather than stored whole.
const MAX_CHUNK_LINES: usize = 150;
/// Header lines kept for an oversized container before its members.
const CONTAINER_HEADER_LINES: usize = 25;
const WINDOW_LINES: usize = 60;
const WINDOW_OVERLAP: usize = 10;
/// A gap between definitions shorter than this (imports, blank lines) is not its own chunk.
const MIN_GAP_LINES: usize = 6;

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// 1-based, inclusive.
    pub start_line: usize,
    pub end_line: usize,
    pub symbol: Option<String>,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub line: usize,
    pub signature: String,
    pub container: Option<String>,
}

#[derive(Debug, Default)]
pub struct FileChunks {
    pub lang: Option<&'static str>,
    pub chunks: Vec<Chunk>,
    pub symbols: Vec<Symbol>,
    pub identifiers: BTreeSet<String>,
}

pub fn chunk_file(path: &Path, source: &str) -> FileChunks {
    let lines: Vec<&str> = source.lines().collect();
    if let Some((language, spec)) = lang::detect(path) {
        let mut parser = Parser::new();
        if parser.set_language(&language).is_ok() {
            if let Some(tree) = parser.parse(source, None) {
                return chunk_tree(tree.root_node(), source, &lines, spec);
            }
        }
    }
    let mut out = FileChunks::default();
    window_chunks(&lines, 1, lines.len(), None, "text", &mut out.chunks);
    out.identifiers = terms::identifiers(source, 3).map(str::to_owned).collect();
    out
}

fn chunk_tree(root: Node, source: &str, lines: &[&str], spec: &'static LangSpec) -> FileChunks {
    let mut out = FileChunks { lang: Some(spec.id), ..Default::default() };
    let mut covered = vec![false; lines.len() + 2];
    let mut walker = Walker { source, lines, spec, out: &mut out, covered: &mut covered };
    walker.visit_children(root, None);
    collect_identifiers(root, source, spec, &mut out.identifiers);

    // Gaps: runs of uncovered, non-blank lines long enough to be worth a chunk.
    let mut gap_chunks = Vec::new();
    let mut line = 1;
    while line <= lines.len() {
        if covered[line] {
            line += 1;
            continue;
        }
        let start = line;
        while line <= lines.len() && !covered[line] {
            line += 1;
        }
        let end = line - 1;
        let non_blank = (start..=end).filter(|l| !lines[l - 1].trim().is_empty()).count();
        if non_blank >= MIN_GAP_LINES {
            window_chunks(lines, start, end, None, "code", &mut gap_chunks);
        }
    }
    out.chunks.extend(gap_chunks);
    out.chunks.sort_by_key(|c| (c.start_line, c.end_line));
    out
}

struct Walker<'a> {
    source: &'a str,
    lines: &'a [&'a str],
    spec: &'static LangSpec,
    out: &'a mut FileChunks,
    covered: &'a mut Vec<bool>,
}

impl Walker<'_> {
    fn visit_children(&mut self, node: Node, container: Option<&str>) {
        let mut cursor = node.walk();
        for child in node.named_children(&mut cursor) {
            self.visit(child, container);
        }
    }

    fn visit(&mut self, node: Node, container: Option<&str>) {
        let kind = node.kind();
        if self.spec.wrapper_kinds.contains(&kind) {
            // The inner declaration names the definition; the chunk spans the wrapper so
            // decorators / `export` stay attached to the code they modify.
            let mut cursor = node.walk();
            let inner = node
                .named_children(&mut cursor)
                .find(|c| self.spec.def_kinds.contains(&c.kind()));
            if let Some(inner) = inner {
                self.definition(node, inner, container);
            }
            return;
        }
        if self.spec.def_kinds.contains(&kind) {
            self.definition(node, node, container);
            return;
        }
        // Bodies (class_body, declaration_list, block of a mod) — members live one level in.
        if container.is_some() && is_body_like(kind) {
            self.visit_children(node, container);
        }
    }

    fn definition(&mut self, span: Node, decl: Node, container: Option<&str>) {
        let start = span.start_position().row + 1;
        let end = (span.end_position().row + 1).min(self.lines.len());
        if end < start {
            return;
        }
        let name = definition_name(decl, self.source);
        let kind = decl.kind().to_string();
        let decl_line = decl.start_position().row + 1;
        if let Some(name) = &name {
            self.out.symbols.push(Symbol {
                name: name.clone(),
                kind: kind.clone(),
                line: decl_line,
                signature: signature_line(self.lines, decl_line),
                container: container.filter(|c| !c.is_empty()).map(str::to_owned),
            });
        }
        let len = end - start + 1;
        let is_container = self.spec.container_kinds.contains(&decl.kind());
        if len <= MAX_CHUNK_LINES {
            self.push(start, end, name.clone(), &kind);
            // Members of a small container are still symbols (repo map), not chunks.
            if is_container {
                let before = self.out.chunks.len();
                self.visit_children(decl, name.as_deref().or(Some("")));
                self.out.chunks.truncate(before);
            }
            return;
        }
        if is_container {
            let header_end = (start + CONTAINER_HEADER_LINES - 1).min(end);
            self.push(start, header_end, name.clone(), &kind);
            let members_before = self.out.chunks.len();
            self.visit_children(decl, name.as_deref().or(Some("")));
            if self.out.chunks.len() > members_before {
                // Lines between members stay coverable by gap windows.
                return;
            }
        }
        let mut windows = Vec::new();
        window_chunks(self.lines, start, end, name, &kind, &mut windows);
        for w in windows {
            self.mark(w.start_line, w.end_line);
            self.out.chunks.push(w);
        }
    }

    fn push(&mut self, start: usize, end: usize, symbol: Option<String>, kind: &str) {
        let end = end.min(self.lines.len());
        if start == 0 || start > end {
            return;
        }
        self.mark(start, end);
        self.out.chunks.push(Chunk {
            start_line: start,
            end_line: end,
            symbol,
            kind: kind.to_string(),
            text: self.lines[start - 1..end].join("\n"),
        });
    }

    fn mark(&mut self, start: usize, end: usize) {
        for l in start..=end.min(self.covered.len() - 1) {
            self.covered[l] = true;
        }
    }
}

fn is_body_like(kind: &str) -> bool {
    matches!(
        kind,
        "class_body" | "declaration_list" | "block" | "interface_body" | "enum_body" | "field_declaration_list"
    )
}

fn definition_name(node: Node, source: &str) -> Option<String> {
    let text = |n: Node| n.utf8_text(source.as_bytes()).ok().map(str::to_owned);
    if let Some(n) = node.child_by_field_name("name") {
        return text(n);
    }
    match node.kind() {
        // `impl Foo for Bar` → "Bar"; `impl Foo` → "Foo".
        "impl_item" => node.child_by_field_name("type").and_then(text),
        // `const foo = () => …` → first declarator's name.
        "lexical_declaration" => {
            let mut c = node.walk();
            let first = node.named_children(&mut c).find(|n| n.kind() == "variable_declarator");
            first.and_then(|d| d.child_by_field_name("name")).and_then(text)
        }
        // Go `type Foo struct {…}` → first type_spec's name.
        "type_declaration" => {
            let mut c = node.walk();
            let first = node.named_children(&mut c).find(|n| n.kind() == "type_spec");
            first.and_then(|s| s.child_by_field_name("name")).and_then(text)
        }
        _ => None,
    }
}

fn signature_line(lines: &[&str], line: usize) -> String {
    let raw = lines.get(line - 1).map(|l| l.trim()).unwrap_or("");
    let mut sig: String = raw.chars().take(160).collect();
    if raw.chars().count() > 160 {
        sig.push('…');
    }
    sig
}

fn collect_identifiers(root: Node, source: &str, spec: &LangSpec, out: &mut BTreeSet<String>) {
    let mut cursor = root.walk();
    let mut descend = true;
    loop {
        if descend {
            let node = cursor.node();
            if spec.ident_kinds.contains(&node.kind()) {
                if let Ok(t) = node.utf8_text(source.as_bytes()) {
                    if t.len() >= 3 {
                        out.insert(t.to_owned());
                    }
                }
            }
            if cursor.goto_first_child() {
                continue;
            }
        }
        if cursor.goto_next_sibling() {
            descend = true;
            continue;
        }
        if !cursor.goto_parent() {
            break;
        }
        descend = false;
    }
}

fn window_chunks(lines: &[&str], start: usize, end: usize, symbol: Option<String>, kind: &str, out: &mut Vec<Chunk>) {
    if start == 0 || start > end || end > lines.len() {
        return;
    }
    let mut s = start;
    loop {
        let e = (s + WINDOW_LINES - 1).min(end);
        let text = lines[s - 1..e].join("\n");
        if !text.trim().is_empty() {
            out.push(Chunk { start_line: s, end_line: e, symbol: symbol.clone(), kind: kind.to_string(), text });
        }
        if e >= end {
            break;
        }
        s = e + 1 - WINDOW_OVERLAP;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_definitions_become_chunks_and_symbols() {
        let src = r#"import { x } from './x';

export function resolveMembership(userId: string) {
  return lookup(userId);
}

export class PlanLimits {
  max = 3;
  check(n: number) {
    return n <= this.max;
  }
}

const helper = () => 1;
"#;
        let fc = chunk_file(Path::new("a.ts"), src);
        assert_eq!(fc.lang, Some("typescript"));
        let names: Vec<_> = fc.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"resolveMembership"));
        assert!(names.contains(&"PlanLimits"));
        assert!(names.contains(&"check"), "class members are symbols: {names:?}");
        assert!(names.contains(&"helper"));
        let f = fc.chunks.iter().find(|c| c.symbol.as_deref() == Some("resolveMembership")).unwrap();
        assert_eq!((f.start_line, f.end_line), (3, 5));
        assert!(f.text.starts_with("export function"));
        let check = fc.symbols.iter().find(|s| s.name == "check").unwrap();
        assert_eq!(check.container.as_deref(), Some("PlanLimits"));
        assert!(fc.identifiers.contains("lookup"));
    }

    #[test]
    fn oversized_container_splits_into_header_and_members() {
        let mut src = String::from("class Big {\n");
        for i in 0..40 {
            src.push_str(&format!("  m{i}() {{\n    a();\n    b();\n    c();\n  }}\n"));
        }
        src.push_str("}\n");
        let fc = chunk_file(Path::new("big.ts"), &src);
        let member_chunks = fc.chunks.iter().filter(|c| c.kind == "method_definition").count();
        assert_eq!(member_chunks, 40);
        assert!(fc.chunks.iter().any(|c| c.symbol.as_deref() == Some("Big") && c.end_line <= 25));
    }

    #[test]
    fn rust_impl_named_by_type() {
        let src = "struct Foo;\nimpl Foo {\n    fn bar(&self) {}\n}\n";
        let fc = chunk_file(Path::new("x.rs"), src);
        assert!(fc.symbols.iter().any(|s| s.name == "Foo" && s.kind == "impl_item"));
        assert!(fc.symbols.iter().any(|s| s.name == "bar" && s.container.as_deref() == Some("Foo")));
    }

    #[test]
    fn plain_text_uses_windows() {
        let src: String = (0..130).map(|i| format!("line {i}\n")).collect();
        let fc = chunk_file(Path::new("notes.md"), &src);
        assert!(fc.lang.is_none());
        assert_eq!(fc.chunks.len(), 3);
        assert_eq!(fc.chunks[1].start_line, 51);
    }
}
