//! Repo map — the codebase's shape in a token budget: files ordered by how much the rest of
//! the repo depends on their symbols, each with its most-referenced definitions and their
//! signature lines. This is what an agent gets on turn one instead of exploring blind.

use crate::store::SymbolRow;
use std::collections::HashMap;

/// Rough chars-per-token for code; the map is trimmed to `max_tokens * CHARS_PER_TOKEN`.
const CHARS_PER_TOKEN: usize = 4;
const MAX_SYMBOLS_PER_FILE: usize = 8;

pub struct RepoMapOptions<'a> {
    pub max_tokens: usize,
    /// Paths (or path prefixes) the caller is working in; their files rank first.
    pub focus: &'a [String],
}

pub fn render(symbols: &[SymbolRow], opts: &RepoMapOptions) -> String {
    let mut by_file: HashMap<&str, Vec<&SymbolRow>> = HashMap::new();
    for s in symbols {
        by_file.entry(s.path.as_str()).or_default().push(s);
    }
    let mut files: Vec<(&str, f64, Vec<&SymbolRow>)> = by_file
        .into_iter()
        .map(|(path, mut syms)| {
            syms.sort_by(|a, b| b.refs.cmp(&a.refs).then(a.line.cmp(&b.line)));
            // log-damped so one hugely imported util does not bury every other file.
            let mut score: f64 = syms.iter().map(|s| (1.0 + s.refs as f64).ln()).sum();
            if opts.focus.iter().any(|f| path.starts_with(f.as_str()) || f.starts_with(path)) {
                score += 1_000.0;
            }
            (path, score, syms)
        })
        .collect();
    files.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(b.0)));

    let budget = opts.max_tokens.max(64) * CHARS_PER_TOKEN;
    let mut out = String::new();
    let mut omitted = 0usize;
    for (path, _, syms) in &files {
        let mut block = format!("{path}\n");
        for s in syms.iter().take(MAX_SYMBOLS_PER_FILE) {
            let indent = if s.container.is_some() { "    " } else { "  " };
            block.push_str(&format!("{indent}{}: {}\n", s.line, s.signature));
        }
        if syms.len() > MAX_SYMBOLS_PER_FILE {
            block.push_str(&format!("  … {} more\n", syms.len() - MAX_SYMBOLS_PER_FILE));
        }
        if out.len() + block.len() > budget {
            omitted += 1;
            continue;
        }
        out.push_str(&block);
    }
    if omitted > 0 {
        out.push_str(&format!("… {omitted} more files (use semantic_search to reach them)\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sym(name: &str, path: &str, refs: usize) -> SymbolRow {
        SymbolRow {
            name: name.into(),
            kind: "function_declaration".into(),
            path: path.into(),
            line: 1,
            signature: format!("function {name}()"),
            container: None,
            refs,
        }
    }

    #[test]
    fn most_depended_on_file_first_and_budget_respected() {
        let syms = vec![sym("leaf", "a/leaf.ts", 0), sym("core", "a/core.ts", 40), sym("mid", "a/mid.ts", 3)];
        let map = render(&syms, &RepoMapOptions { max_tokens: 1000, focus: &[] });
        let core = map.find("a/core.ts").unwrap();
        let mid = map.find("a/mid.ts").unwrap();
        let leaf = map.find("a/leaf.ts").unwrap();
        assert!(core < mid && mid < leaf);

        let many: Vec<SymbolRow> = (0..50).map(|i| sym(&format!("f{i}"), &format!("dir/file{i}.ts"), i)).collect();
        let tiny = render(&many, &RepoMapOptions { max_tokens: 64, focus: &[] });
        assert!(tiny.len() <= 64 * CHARS_PER_TOKEN + 80);
        assert!(tiny.contains("more files"));
    }

    #[test]
    fn focus_ranks_first() {
        let syms = vec![sym("core", "a/core.ts", 40), sym("leaf", "b/leaf.ts", 0)];
        let focus = vec!["b/".to_string()];
        let map = render(&syms, &RepoMapOptions { max_tokens: 1000, focus: &focus });
        assert!(map.find("b/leaf.ts").unwrap() < map.find("a/core.ts").unwrap());
    }
}
