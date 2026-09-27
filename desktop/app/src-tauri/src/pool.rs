//! Commands run off the UI thread: a store call is a round trip to the memory server and a
//! cloud call is a round trip to builderforce.ai, and neither may freeze the window.

use std::sync::Arc;
use tauri::State;

/// Run `f` on the blocking pool with the managed state `S`.
pub async fn blocking<S, T>(state: State<'_, Arc<S>>, f: impl FnOnce(&S) -> Result<T, String> + Send + 'static) -> Result<T, String>
where
    S: Send + Sync + 'static,
    T: Send + 'static,
{
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(&state)).await.map_err(|e| e.to_string())?
}
