//! End-to-end over the operation surface every transport shares. Run with
//! `--no-default-features` so no embedding model is downloaded.

use bf_context::{api, api::ops, server, Registry};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

fn workspace() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    std::fs::write(
        dir.path().join("src/billing.ts"),
        "export function applyStripeWebhook(event: unknown) {\n  return postLedgerEntry(event);\n}\n",
    )
    .unwrap();
    dir
}

fn wait_ready(reg: &std::sync::Arc<Registry>, root: &std::path::Path) -> Value {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let st = api::dispatch(reg, ops::STATUS, json!({ "root": root })).unwrap();
        if st["phase"]["state"] != "scanning" {
            return st;
        }
        assert!(Instant::now() < deadline, "index never finished scanning: {st}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn search_repo_map_and_references_through_dispatch() {
    let ws = workspace();
    let data = tempfile::tempdir().unwrap();
    let reg = Registry::new(data.path().to_path_buf());
    let st = wait_ready(&reg, ws.path());
    assert_eq!(st["files"], 1);

    let hits = api::dispatch(&reg, ops::SEARCH, json!({ "root": ws.path(), "query": "stripe webhook" })).unwrap();
    assert_eq!(hits["results"][0]["path"], "src/billing.ts");
    assert_eq!(hits["results"][0]["symbol"], "applyStripeWebhook");

    let map = api::dispatch(&reg, ops::REPO_MAP, json!({ "root": ws.path() })).unwrap();
    assert!(map["map"].as_str().unwrap().contains("applyStripeWebhook"));

    let refs = api::dispatch(
        &reg,
        ops::CHECK_REFERENCES,
        json!({ "root": ws.path(), "texts": ["Webhooks go through `applyStripeWebhook()`.", "Use `retiredHelperFn()`."] }),
    )
    .unwrap();
    assert_eq!(refs["results"][0]["missing"].as_array().unwrap().len(), 0);
    assert_eq!(refs["results"][1]["missing"][0]["reference"], "retiredHelperFn");

    let ws_list = api::dispatch(&reg, ops::WORKSPACES, Value::Null).unwrap();
    assert_eq!(ws_list["workspaces"].as_array().unwrap().len(), 1);
    assert!(api::dispatch(&reg, "nope", Value::Null).is_err());
}

#[test]
fn http_requires_token_and_refuses_browser_origins() {
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("BUILDERFORCE_DESKTOP_DISCOVERY", data.path().join("desktop.json"));
    let reg = Registry::new(data.path().to_path_buf());
    let running = server::start(reg).unwrap();
    let base = format!("http://127.0.0.1:{}/v1", running.discovery.port);

    let no_token = ureq::get(&format!("{base}/health")).call();
    assert!(matches!(no_token, Err(ureq::Error::Status(401, _))));

    let auth = format!("Bearer {}", running.discovery.token);
    let from_browser = ureq::get(&format!("{base}/health")).set("Authorization", &auth).set("Origin", "https://evil.example").call();
    assert!(matches!(from_browser, Err(ureq::Error::Status(403, _))));

    let ok: Value = ureq::get(&format!("{base}/health")).set("Authorization", &auth).call().unwrap().into_json().unwrap();
    assert!(ok["version"].is_string());

    let found = bf_context::discovery::find_live().expect("discovery file points at the live server");
    assert_eq!(found.port, running.discovery.port);
    running.stop();
    assert!(bf_context::discovery::read().is_none(), "stop withdraws the discovery file");
}
