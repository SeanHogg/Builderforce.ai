//! Code references inside free text (a recalled memory, a fact) — the paths and symbols it
//! names — so the index can say which of them no longer exist. A memory that tells the
//! agent "use `resolveMembership`" after that function was deleted is confidently wrong;
//! this is how it gets flagged instead of obeyed.
//!
//! Extraction is deliberately conservative: only spans that are unambiguously code (a path
//! with a source extension or a slash, or a camelCase / snake_case / `call()` identifier)
//! are checked. `npm test`, `--flag` and plain words are never flagged.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Path,
    Symbol,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CodeRef {
    pub reference: String,
    pub kind: RefKind,
}

const SOURCE_EXTS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "cs", "kt", "swift", "rb", "php", "vue",
    "svelte", "css", "scss", "sql", "json", "toml", "yaml", "yml", "md",
];

pub fn extract(text: &str) -> Vec<CodeRef> {
    let mut out: Vec<CodeRef> = Vec::new();
    let mut push = |r: CodeRef| {
        if !out.contains(&r) {
            out.push(r);
        }
    };
    // Backticked spans first: the strongest signal that something is code.
    let mut rest = text;
    while let Some(open) = rest.find('`') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('`') else { break };
        if let Some(r) = classify(&after[..close]) {
            push(r);
        }
        rest = &after[close + 1..];
    }
    // Bare paths outside backticks (`api/src/foo.ts` often appears unquoted).
    for word in text.split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | ',' | '"' | '\'' | '`')) {
        let w = word.trim_end_matches(['.', ':', ';']);
        if w.contains('/') && has_source_ext(w) {
            if let Some(r) = classify(w) {
                push(r);
            }
        }
    }
    out
}

fn classify(span: &str) -> Option<CodeRef> {
    let s = span.trim();
    if s.is_empty() || s.len() > 200 || s.contains(char::is_whitespace) {
        return None;
    }
    if s.starts_with('-') || s.starts_with("http://") || s.starts_with("https://") || s.starts_with('@') {
        return None;
    }
    if s.contains('/') || has_source_ext(s) {
        let p = strip_line_suffix(s.trim_start_matches("./"));
        if p.contains("..") || p.contains('*') || p.ends_with('/') && p.len() < 3 {
            return None;
        }
        return (has_source_ext(p) || p.contains('/')).then(|| CodeRef { reference: p.to_string(), kind: RefKind::Path });
    }
    let ident = s.trim_end_matches("()");
    let last = ident.rsplit(['.', ':']).next().unwrap_or(ident);
    let code_like = s.ends_with("()") || last.contains('_') || has_inner_upper(last);
    let valid = last.len() >= 4
        && last.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false)
        && last.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    (code_like && valid && !is_screaming_constant_word(last))
        .then(|| CodeRef { reference: last.to_string(), kind: RefKind::Symbol })
}

fn has_source_ext(s: &str) -> bool {
    let base = strip_line_suffix(s);
    base.rsplit_once('.')
        .map(|(stem, ext)| !stem.is_empty() && SOURCE_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// `src/a.ts:42` / `src/a.ts#L42` → `src/a.ts`.
fn strip_line_suffix(s: &str) -> &str {
    let s = s.split('#').next().unwrap_or(s);
    match s.rsplit_once(':') {
        Some((head, tail)) if !tail.is_empty() && tail.chars().all(|c| c.is_ascii_digit() || c == '-') => head,
        _ => s,
    }
}

fn has_inner_upper(s: &str) -> bool {
    s.chars().skip(1).any(|c| c.is_ascii_uppercase()) && s.chars().any(|c| c.is_ascii_lowercase())
}

/// `TODO`, `README` — all-caps words that are prose, not identifiers.
fn is_screaming_constant_word(s: &str) -> bool {
    !s.contains('_') && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refs(t: &str) -> Vec<String> {
        extract(t).into_iter().map(|r| r.reference).collect()
    }

    #[test]
    fn extracts_code_and_skips_prose() {
        let t = "Use `resolveMembership()` from `api/src/auth/membership.ts:42`, not `npm test` or `--force`. \
                 Also see frontend/src/lib/planLimits.ts. `TODO` and `the` are prose; `ONE_PORT` is code.";
        let r = refs(t);
        assert!(r.contains(&"resolveMembership".to_string()));
        assert!(r.contains(&"api/src/auth/membership.ts".to_string()));
        assert!(r.contains(&"frontend/src/lib/planLimits.ts".to_string()));
        assert!(r.contains(&"ONE_PORT".to_string()));
        assert!(!r.iter().any(|x| x.contains("npm") || x.contains("force") || x == "TODO" || x == "the"));
    }

    #[test]
    fn qualified_names_check_last_segment() {
        assert_eq!(refs("`Store::replaceFile`"), vec!["replaceFile"]);
        assert_eq!(refs("`adminApi.createReleaseNote`"), vec!["createReleaseNote"]);
    }
}
