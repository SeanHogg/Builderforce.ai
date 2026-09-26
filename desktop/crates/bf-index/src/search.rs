//! Hybrid ranking — reciprocal-rank fusion of the keyword and vector lists, plus a boost
//! when a chunk's symbol IS a word of the query. Pure: the index feeds it ranked id lists.

use std::collections::HashMap;

/// RRF damping constant (the standard 60): rank 1 and rank 5 differ, rank 50 and 55 barely do.
const RRF_K: f32 = 60.0;
const EXACT_SYMBOL_BOOST: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Keyword,
    Vector,
    Both,
}

#[derive(Debug, Clone)]
pub struct Fused {
    pub id: i64,
    pub score: f32,
    pub source: Source,
}

/// Fuse two best-first id lists. `symbol_of` names a chunk's symbol for the exact-match boost.
pub fn fuse(
    keyword: &[i64],
    vector: &[i64],
    query_words: &[String],
    symbol_of: impl Fn(i64) -> Option<String>,
) -> Vec<Fused> {
    let mut acc: HashMap<i64, (f32, bool, bool)> = HashMap::new();
    for (rank, id) in keyword.iter().enumerate() {
        let e = acc.entry(*id).or_default();
        e.0 += 1.0 / (RRF_K + rank as f32 + 1.0);
        e.1 = true;
    }
    for (rank, id) in vector.iter().enumerate() {
        let e = acc.entry(*id).or_default();
        e.0 += 1.0 / (RRF_K + rank as f32 + 1.0);
        e.2 = true;
    }
    let mut out: Vec<Fused> = acc
        .into_iter()
        .map(|(id, (mut score, kw, vec))| {
            if let Some(sym) = symbol_of(id) {
                let sym = sym.to_ascii_lowercase();
                if query_words.contains(&sym) {
                    score += EXACT_SYMBOL_BOOST;
                }
            }
            let source = match (kw, vec) {
                (true, true) => Source::Both,
                (true, false) => Source::Keyword,
                _ => Source::Vector,
            };
            Fused { id, score, source }
        })
        .collect();
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.id.cmp(&b.id)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agreement_beats_single_list_and_exact_symbol_wins() {
        let kw = vec![1, 2, 3];
        let vec = vec![3, 4];
        let fused = fuse(&kw, &vec, &[], |_| None);
        assert_eq!(fused[0].id, 3, "in both lists");
        assert_eq!(fused[0].source, Source::Both);

        let words = vec!["planlimits".to_string()];
        let fused = fuse(&kw, &vec, &words, |id| (id == 2).then(|| "PlanLimits".to_string()));
        assert_eq!(fused[0].id, 2);
    }
}
