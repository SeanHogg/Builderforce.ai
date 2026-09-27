//! Windows: UI Automation for what was acted on, a low-level input hook for when, and
//! SendInput (enigo) for replay when an element cannot be driven through its pattern.

pub(crate) mod input;
pub(crate) mod procs;
pub mod recording;
pub mod replay;
pub(crate) mod shot;
pub(crate) mod uia;
pub mod vault;

/// UI Automation, xcap and enigo errors all implement Debug; not all of them implement
/// `std::error::Error + Send + Sync`, which `?` into anyhow needs.
pub(crate) fn err<E: std::fmt::Debug>(e: E) -> anyhow::Error {
    anyhow::anyhow!("{e:?}")
}
