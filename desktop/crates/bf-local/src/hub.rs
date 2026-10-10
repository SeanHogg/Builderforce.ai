//! The model hub: open models Synapse offers to install, as DATA, and which size and
//! quantization this machine can run. Memory is the limit that matters on a desktop —
//! the weights plus the context must fit with room left for everything else — so each
//! variant gets the highest-fidelity quantization that fits, and the hub marks the one
//! model it recommends for this machine.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Quant {
    #[serde(rename = "Q4_K_M")]
    Q4,
    #[serde(rename = "Q8_0")]
    Q8,
    #[serde(rename = "F16")]
    F16,
}

impl Quant {
    /// Effective bits per weight, scales included.
    fn bits(self) -> f64 {
        match self {
            Quant::Q4 => 4.85,
            Quant::Q8 => 8.5,
            Quant::F16 => 16.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Purpose {
    Chat,
    Code,
}

pub struct Variant {
    /// Billions of parameters.
    pub params_b: f64,
    /// The runtime's tag for each quantization offered.
    pub tags: &'static [(Quant, &'static str)],
}

pub struct HubModel {
    pub id: &'static str,
    pub name: &'static str,
    pub purpose: Purpose,
    pub variants: &'static [Variant],
}

pub const HUB: &[HubModel] = &[
    HubModel {
        id: "llama3.2",
        name: "Llama 3.2",
        purpose: Purpose::Chat,
        variants: &[
            Variant { params_b: 1.2, tags: &[(Quant::Q4, "llama3.2:1b-instruct-q4_K_M"), (Quant::Q8, "llama3.2:1b-instruct-q8_0"), (Quant::F16, "llama3.2:1b-instruct-fp16")] },
            Variant { params_b: 3.2, tags: &[(Quant::Q4, "llama3.2:3b-instruct-q4_K_M"), (Quant::Q8, "llama3.2:3b-instruct-q8_0"), (Quant::F16, "llama3.2:3b-instruct-fp16")] },
        ],
    },
    HubModel {
        id: "llama3.1",
        name: "Llama 3.1",
        purpose: Purpose::Chat,
        variants: &[
            Variant { params_b: 8.0, tags: &[(Quant::Q4, "llama3.1:8b-instruct-q4_K_M"), (Quant::Q8, "llama3.1:8b-instruct-q8_0"), (Quant::F16, "llama3.1:8b-instruct-fp16")] },
            Variant { params_b: 70.6, tags: &[(Quant::Q4, "llama3.1:70b-instruct-q4_K_M"), (Quant::Q8, "llama3.1:70b-instruct-q8_0")] },
        ],
    },
    HubModel {
        id: "qwen2.5",
        name: "Qwen 2.5",
        purpose: Purpose::Chat,
        variants: &[
            Variant { params_b: 7.6, tags: &[(Quant::Q4, "qwen2.5:7b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5:7b-instruct-q8_0"), (Quant::F16, "qwen2.5:7b-instruct-fp16")] },
            Variant { params_b: 14.8, tags: &[(Quant::Q4, "qwen2.5:14b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5:14b-instruct-q8_0")] },
            Variant { params_b: 32.8, tags: &[(Quant::Q4, "qwen2.5:32b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5:32b-instruct-q8_0")] },
        ],
    },
    HubModel {
        id: "qwen2.5-coder",
        name: "Qwen 2.5 Coder",
        purpose: Purpose::Code,
        variants: &[
            Variant { params_b: 7.6, tags: &[(Quant::Q4, "qwen2.5-coder:7b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5-coder:7b-instruct-q8_0"), (Quant::F16, "qwen2.5-coder:7b-instruct-fp16")] },
            Variant { params_b: 14.8, tags: &[(Quant::Q4, "qwen2.5-coder:14b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5-coder:14b-instruct-q8_0")] },
            Variant { params_b: 32.8, tags: &[(Quant::Q4, "qwen2.5-coder:32b-instruct-q4_K_M"), (Quant::Q8, "qwen2.5-coder:32b-instruct-q8_0")] },
        ],
    },
    HubModel {
        id: "gemma2",
        name: "Gemma 2",
        purpose: Purpose::Chat,
        variants: &[
            Variant { params_b: 9.2, tags: &[(Quant::Q4, "gemma2:9b-instruct-q4_K_M"), (Quant::Q8, "gemma2:9b-instruct-q8_0")] },
            Variant { params_b: 27.2, tags: &[(Quant::Q4, "gemma2:27b-instruct-q4_K_M"), (Quant::Q8, "gemma2:27b-instruct-q8_0")] },
        ],
    },
];

/// The context's working memory and the runtime itself, on top of the weights.
const OVERHEAD_BYTES: f64 = 1.2e9;
/// The share of the machine's memory a model may take; the rest is for everything else.
const BUDGET_SHARE: f64 = 0.6;

/// Bytes a model of `params_b` billion parameters needs at `quant`.
pub fn estimate_bytes(params_b: f64, quant: Quant) -> u64 {
    (params_b * 1e9 * quant.bits() / 8.0 + OVERHEAD_BYTES) as u64
}

pub fn budget_bytes(total_memory: u64) -> u64 {
    (total_memory as f64 * BUDGET_SHARE) as u64
}

/// One variant as the window shows it: its size, the quantization chosen for this
/// machine (none when even the smallest does not fit), and every tag on offer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantView {
    pub params_b: f64,
    pub pick: Option<PickView>,
    pub options: Vec<PickView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickView {
    pub quant: Quant,
    pub tag: String,
    pub bytes: u64,
    pub fits: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelView {
    pub id: &'static str,
    pub name: &'static str,
    pub purpose: Purpose,
    pub variants: Vec<VariantView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubView {
    pub total_memory: u64,
    pub budget: u64,
    pub models: Vec<ModelView>,
    /// The tag recommended for this machine: the most parameters that fit.
    pub recommended: Option<String>,
}

pub fn view(total_memory: u64) -> HubView {
    let budget = budget_bytes(total_memory);
    let mut best: Option<(f64, Quant, String)> = None;
    let models = HUB
        .iter()
        .map(|m| ModelView {
            id: m.id,
            name: m.name,
            purpose: m.purpose,
            variants: m
                .variants
                .iter()
                .map(|v| {
                    let options: Vec<PickView> = v
                        .tags
                        .iter()
                        .map(|(q, tag)| {
                            let bytes = estimate_bytes(v.params_b, *q);
                            PickView { quant: *q, tag: tag.to_string(), bytes, fits: bytes <= budget }
                        })
                        .collect();
                    let pick = options.iter().filter(|o| o.fits).max_by_key(|o| o.quant).cloned();
                    // The recommendation is a general-purpose model: most parameters first,
                    // then the better quantization.
                    if let (Some(p), Purpose::Chat) = (&pick, m.purpose) {
                        let better = best.as_ref().is_none_or(|(b, bq, _)| v.params_b > *b || (v.params_b == *b && p.quant > *bq));
                        if better {
                            best = Some((v.params_b, p.quant, p.tag.clone()));
                        }
                    }
                    VariantView { params_b: v.params_b, pick, options }
                })
                .collect(),
        })
        .collect();
    HubView { total_memory, budget, models, recommended: best.map(|(_, _, t)| t) }
}

/// This machine's memory, in bytes. On Apple silicon it is the memory the GPU shares.
pub fn total_memory() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1_000_000_000;

    #[test]
    fn estimates_grow_with_bits_and_parameters() {
        assert!(estimate_bytes(7.6, Quant::Q4) < estimate_bytes(7.6, Quant::Q8));
        assert!(estimate_bytes(7.6, Quant::Q8) < estimate_bytes(14.8, Quant::Q8));
        // ~4.6 GB of weights for a 7.6B model at Q4_K_M, plus overhead.
        let q4 = estimate_bytes(7.6, Quant::Q4);
        assert!(q4 > 5 * GB && q4 < 6 * GB, "{q4}");
    }

    #[test]
    fn a_small_machine_gets_a_small_model_and_a_big_one_a_bigger_model() {
        let small = view(8 * GB);
        let rec = small.recommended.expect("something fits in 8 GB");
        assert!(rec.starts_with("llama3.2:3b"), "{rec}");
        let big = view(64 * GB);
        assert!(big.recommended.unwrap().contains("32b"));
        let tiny = view(GB);
        assert!(tiny.recommended.is_none());
    }

    #[test]
    fn each_variant_picks_its_best_quant_that_fits() {
        let v = view(16 * GB);
        let qwen7 = &v.models.iter().find(|m| m.id == "qwen2.5").unwrap().variants[0];
        assert_eq!(qwen7.pick.as_ref().map(|p| p.quant), Some(Quant::Q8));
        let qwen32 = &v.models.iter().find(|m| m.id == "qwen2.5").unwrap().variants[2];
        assert!(qwen32.pick.is_none());
        assert!(qwen32.options.iter().all(|o| !o.fits));
    }

    #[test]
    fn every_tag_names_its_family() {
        for m in HUB {
            for v in m.variants {
                for (_, tag) in v.tags {
                    assert!(tag.starts_with(&format!("{}:", m.id)), "{tag}");
                }
            }
        }
    }
}
