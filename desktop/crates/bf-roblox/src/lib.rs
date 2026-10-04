//! Spawn's link to Roblox Studio.
//!
//!   - [`plugin`]: writes the Spawn Studio plugin into Studio's local plugins folder —
//!     no Creator Store visit, no file to copy;
//!   - [`Bridge`]: the loopback server that plugin long-polls — Spawn asks it for a
//!     picture of the open place, hands it a build's operations, and hears back what it
//!     applied and what the last play-test printed.
//!
//! No Rojo, no sync server and no second process: the app IS the bridge, so a player
//! installs one thing and opens Studio.

pub mod bridge;
pub mod plugin;

pub use bridge::{Bridge, BridgeError, BridgeStatus, JobResult, Snapshot};
