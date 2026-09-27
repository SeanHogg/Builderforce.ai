//! `bf-context` — the headless context service.
//!
//!   bf-context serve                  run the service (what the desktop app does, minus the UI)
//!   bf-context mcp [--root <dir>]     MCP stdio server for Claude Code / Cursor (default root: cwd)
//!   bf-context index <dir>            index a workspace once and print its status
//!   bf-context search <dir> <query>   search a workspace and print the hits as JSON

use anyhow::{anyhow, Result};
use bf_context::{api::ops, client::Client, mcp, paths, server, Registry};
use serde_json::json;
use std::path::PathBuf;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("serve") => serve(),
        Some("mcp") => mcp::run_stdio(root_arg(&args[1..])?),
        Some("index") => {
            let root = PathBuf::from(args.get(1).ok_or_else(|| anyhow!("usage: bf-context index <dir>"))?);
            index_once(root)
        }
        Some("search") => {
            let root = args.get(1).ok_or_else(|| anyhow!("usage: bf-context search <dir> <query>"))?;
            let query = args[2..].join(" ");
            let out = Client::connect("cli").call(ops::SEARCH, json!({ "root": root, "query": query }))?;
            println!("{}", serde_json::to_string_pretty(&out)?);
            Ok(())
        }
        _ => {
            eprintln!("usage: bf-context <serve | mcp [--root <dir>] | index <dir> | search <dir> <query>>");
            std::process::exit(2);
        }
    }
}

fn root_arg(rest: &[String]) -> Result<PathBuf> {
    match rest.iter().position(|a| a == "--root") {
        Some(i) => rest.get(i + 1).map(PathBuf::from).ok_or_else(|| anyhow!("--root needs a directory")),
        None => Ok(std::env::current_dir()?),
    }
}

fn serve() -> Result<()> {
    let reg = Registry::new(paths::data_dir());
    reg.start_background();
    let running = server::start(reg)?;
    eprintln!("bf-context {} listening on 127.0.0.1:{}", env!("CARGO_PKG_VERSION"), running.discovery.port);
    // Park until killed; the discovery file is withdrawn by the next start or goes stale.
    loop {
        std::thread::park();
    }
}

fn index_once(root: PathBuf) -> Result<()> {
    let reg = Registry::new(paths::data_dir());
    let index = reg.ensure(&root)?;
    index.scan()?;
    if index.embed_pending().is_err() {
        index.embedding_unavailable();
    }
    println!("{}", serde_json::to_string_pretty(&index.status())?);
    Ok(())
}
