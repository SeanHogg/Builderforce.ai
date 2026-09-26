//! Identifier-aware term splitting — the ONE tokenizer both the keyword index and the
//! query use, so `resolveMembership`, `resolve_membership` and "resolve membership" all
//! meet on the same terms.

/// Split text into lowercase search terms. Each identifier contributes itself (lowercased)
/// plus its camelCase / snake_case / kebab parts, so a query word matches a compound name.
pub fn search_terms(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for word in identifiers(text, 2) {
        let lower = word.to_ascii_lowercase();
        let parts = split_identifier(word);
        if parts.len() > 1 {
            for p in parts {
                if p.len() >= 2 {
                    out.push(p);
                }
            }
        }
        out.push(lower);
    }
    out
}

/// Identifier-shaped words (`[A-Za-z_][A-Za-z0-9_]*`) of at least `min_len` characters.
pub fn identifiers(text: &str, min_len: usize) -> impl Iterator<Item = &str> {
    text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(move |w| w.len() >= min_len && !w.as_bytes()[0].is_ascii_digit())
}

/// `parseHTTPResponse_v2` → ["parse", "http", "response", "v2"].
pub fn split_identifier(word: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let chars: Vec<char> = word.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if c == '_' || c == '-' {
            if !cur.is_empty() {
                parts.push(std::mem::take(&mut cur));
            }
            continue;
        }
        let boundary = if cur.is_empty() {
            false
        } else {
            let prev = chars[i - 1];
            let next_is_lower = chars.get(i + 1).map(|n| n.is_ascii_lowercase()).unwrap_or(false);
            (prev.is_ascii_lowercase() && c.is_ascii_uppercase())
                || (prev.is_ascii_uppercase() && c.is_ascii_uppercase() && next_is_lower)
        };
        if boundary {
            parts.push(std::mem::take(&mut cur));
        }
        cur.push(c.to_ascii_lowercase());
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}

/// An FTS5 MATCH expression from free text: every distinct term quoted, OR-joined.
/// Quoting makes each term a literal, so user text can never inject FTS syntax.
pub fn fts_query(text: &str) -> Option<String> {
    let mut seen = std::collections::BTreeSet::new();
    let terms: Vec<String> = search_terms(text)
        .into_iter()
        .filter(|t| t.len() >= 2 && !STOPWORDS.contains(&t.as_str()) && seen.insert(t.clone()))
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" OR "))
    }
}

const STOPWORDS: &[&str] = &[
    "the", "and", "for", "where", "what", "how", "does", "is", "are", "of", "to", "in", "on", "we", "do",
    "it", "a", "an", "with", "that", "this", "which", "who", "when", "be", "or", "by", "from", "at", "as",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_camel_snake_and_acronyms() {
        assert_eq!(split_identifier("resolveMembership"), vec!["resolve", "membership"]);
        assert_eq!(split_identifier("resolve_membership"), vec!["resolve", "membership"]);
        assert_eq!(split_identifier("parseHTTPResponse"), vec!["parse", "http", "response"]);
        assert_eq!(split_identifier("PlanLimits"), vec!["plan", "limits"]);
    }

    #[test]
    fn query_terms_include_parts_and_whole() {
        let q = fts_query("where are PlanLimits enforced?").unwrap();
        assert!(q.contains("\"plan\""));
        assert!(q.contains("\"limits\""));
        assert!(q.contains("\"planlimits\""));
        assert!(q.contains("\"enforced\""));
        assert!(!q.contains("\"where\""));
    }

    #[test]
    fn query_is_injection_safe() {
        let q = fts_query("foo\" OR bar NEAR(").unwrap();
        assert!(!q.contains("\"\""));
        assert!(q.split(" OR ").all(|t| t.starts_with('"') && t.ends_with('"')));
    }
}
