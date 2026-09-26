//! SQLite persistence for one workspace index — the only module that writes SQL.
//!
//! One file per workspace under the app data dir (never inside the repo). FTS5 carries the
//! keyword side; vectors are BLOBs on the chunk row, NULL until the embedder reaches them.

use crate::chunk::FileChunks;
use crate::embed;
use crate::terms;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const SCHEMA_VERSION: &str = "1";

pub struct Store {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct ChunkRow {
    pub id: i64,
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub symbol: Option<String>,
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct SymbolRow {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: usize,
    pub signature: String,
    pub container: Option<String>,
    /// Distinct OTHER files that reference the name — the repo-map importance signal.
    pub refs: usize,
}

#[derive(Debug, Clone, Default)]
pub struct Counts {
    pub files: usize,
    pub chunks: usize,
    pub embedded: usize,
    pub symbols: usize,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        let store = Self { conn: Connection::open_in_memory()? };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        let version: Option<String> =
            self.conn.query_row("SELECT value FROM meta WHERE key='schema'", [], |r| r.get(0)).optional()?;
        if version.as_deref() != Some(SCHEMA_VERSION) {
            // A cache, never a source of truth: an older layout is dropped and rebuilt.
            self.conn.execute_batch(
                "DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS chunks_fts;
                 DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS file_idents;",
            )?;
        }
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files(
                path TEXT PRIMARY KEY, hash TEXT NOT NULL, lang TEXT, indexed_at INTEGER NOT NULL);
             CREATE TABLE IF NOT EXISTS chunks(
                id INTEGER PRIMARY KEY, path TEXT NOT NULL, start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL, symbol TEXT, kind TEXT NOT NULL, text TEXT NOT NULL,
                embedding BLOB);
             CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
             CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(symbol, path, body);
             CREATE TABLE IF NOT EXISTS symbols(
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL,
                line INTEGER NOT NULL, signature TEXT NOT NULL, container TEXT);
             CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
             CREATE INDEX IF NOT EXISTS symbols_path ON symbols(path);
             CREATE TABLE IF NOT EXISTS file_idents(
                path TEXT NOT NULL, ident TEXT NOT NULL, PRIMARY KEY(path, ident)) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS file_idents_ident ON file_idents(ident);",
        )?;
        self.set_meta("schema", SCHEMA_VERSION)?;
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn file_hash(&self, path: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT hash FROM files WHERE path=?1", [path], |r| r.get(0)).optional()?)
    }

    pub fn all_paths(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT path FROM files")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Replace everything stored for one file in a single transaction.
    pub fn replace_file(&mut self, path: &str, hash: &str, fc: &FileChunks, now: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        delete_file_rows(&tx, path)?;
        tx.execute(
            "INSERT INTO files(path, hash, lang, indexed_at) VALUES(?1, ?2, ?3, ?4)",
            params![path, hash, fc.lang, now],
        )?;
        {
            let mut ins_chunk = tx.prepare(
                "INSERT INTO chunks(path, start_line, end_line, symbol, kind, text) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            let mut ins_fts = tx.prepare("INSERT INTO chunks_fts(rowid, symbol, path, body) VALUES(?1, ?2, ?3, ?4)")?;
            let path_terms = terms::search_terms(path).join(" ");
            for c in &fc.chunks {
                ins_chunk.execute(params![path, c.start_line as i64, c.end_line as i64, c.symbol, c.kind, c.text])?;
                let id = tx.last_insert_rowid();
                let sym_terms = c.symbol.as_deref().map(|s| terms::search_terms(s).join(" ")).unwrap_or_default();
                ins_fts.execute(params![id, sym_terms, path_terms, terms::search_terms(&c.text).join(" ")])?;
            }
            let mut ins_sym = tx.prepare(
                "INSERT INTO symbols(name, kind, path, line, signature, container) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            for s in &fc.symbols {
                ins_sym.execute(params![s.name, s.kind, path, s.line as i64, s.signature, s.container])?;
            }
            let mut ins_ident = tx.prepare("INSERT OR IGNORE INTO file_idents(path, ident) VALUES(?1, ?2)")?;
            for ident in &fc.identifiers {
                ins_ident.execute(params![path, ident])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_file(&mut self, path: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        delete_file_rows(&tx, path)?;
        tx.commit()?;
        Ok(())
    }

    pub fn counts(&self) -> Result<Counts> {
        let one = |sql: &str| -> Result<usize> { Ok(self.conn.query_row(sql, [], |r| r.get::<_, i64>(0))? as usize) };
        Ok(Counts {
            files: one("SELECT COUNT(*) FROM files")?,
            chunks: one("SELECT COUNT(*) FROM chunks")?,
            embedded: one("SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL")?,
            symbols: one("SELECT COUNT(*) FROM symbols")?,
        })
    }

    /// BM25 over symbol (heaviest), path and body terms. `rank` is lower-is-better.
    pub fn keyword_search(&self, fts: &str, path_prefix: Option<&str>, limit: usize) -> Result<Vec<i64>> {
        let like = path_prefix.map(|p| format!("{}%", escape_like(p))).unwrap_or_else(|| "%".into());
        let mut stmt = self.conn.prepare(
            "SELECT f.rowid FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
             WHERE chunks_fts MATCH ?1 AND c.path LIKE ?2 ESCAPE '\\'
             ORDER BY bm25(chunks_fts, 6.0, 2.0, 1.0) LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![fts, like, limit as i64], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn chunks_by_ids(&self, ids: &[i64]) -> Result<Vec<ChunkRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, start_line, end_line, symbol, kind, text FROM chunks WHERE id=?1")?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(row) = stmt.query_row([id], chunk_row).optional()? {
                out.push(row);
            }
        }
        Ok(out)
    }

    /// Chunks still lacking a vector, oldest first, for the background embedder.
    pub fn unembedded(&self, limit: usize) -> Result<Vec<ChunkRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, start_line, end_line, symbol, kind, text FROM chunks
             WHERE embedding IS NULL ORDER BY id LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit as i64], chunk_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn set_embeddings(&mut self, rows: &[(i64, Vec<f32>)]) -> Result<()> {
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE chunks SET embedding=?2 WHERE id=?1")?;
            for (id, v) in rows {
                stmt.execute(params![id, embed::to_blob(v)])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn clear_embeddings(&self) -> Result<()> {
        self.conn.execute("UPDATE chunks SET embedding=NULL", [])?;
        Ok(())
    }

    /// Every stored vector with its path — the in-memory vector cache is built from this.
    pub fn all_embeddings(&self) -> Result<Vec<(i64, String, Vec<f32>)>> {
        let mut stmt = self.conn.prepare("SELECT id, path, embedding FROM chunks WHERE embedding IS NOT NULL")?;
        let rows = stmt.query_map([], |r| {
            let blob: Vec<u8> = r.get(2)?;
            Ok((r.get(0)?, r.get(1)?, embed::from_blob(&blob)))
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn symbols_ranked(&self) -> Result<Vec<SymbolRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.name, s.kind, s.path, s.line, s.signature, s.container,
                    (SELECT COUNT(*) FROM file_idents fi WHERE fi.ident = s.name AND fi.path <> s.path) AS refs
             FROM symbols s",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SymbolRow {
                name: r.get(0)?,
                kind: r.get(1)?,
                path: r.get(2)?,
                line: r.get::<_, i64>(3)? as usize,
                signature: r.get(4)?,
                container: r.get(5)?,
                refs: r.get::<_, i64>(6)? as usize,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn symbol_exists(&self, name: &str) -> Result<bool> {
        Ok(self.conn.query_row("SELECT EXISTS(SELECT 1 FROM symbols WHERE name=?1)", [name], |r| r.get(0))?)
    }

    pub fn ident_exists(&self, name: &str) -> Result<bool> {
        Ok(self.conn.query_row("SELECT EXISTS(SELECT 1 FROM file_idents WHERE ident=?1)", [name], |r| r.get(0))?)
    }

    /// A path reference matches a file when the file path ends with it (`src/a.ts` matches
    /// `api/src/a.ts`).
    pub fn path_exists(&self, suffix: &str) -> Result<bool> {
        let like = format!("%{}", escape_like(suffix));
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\')",
            params![suffix, like],
            |r| r.get(0),
        )?)
    }
}

fn delete_file_rows(tx: &rusqlite::Transaction, path: &str) -> Result<()> {
    tx.execute("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE path=?1)", [path])?;
    tx.execute("DELETE FROM chunks WHERE path=?1", [path])?;
    tx.execute("DELETE FROM symbols WHERE path=?1", [path])?;
    tx.execute("DELETE FROM file_idents WHERE path=?1", [path])?;
    tx.execute("DELETE FROM files WHERE path=?1", [path])?;
    Ok(())
}

fn chunk_row(r: &rusqlite::Row) -> rusqlite::Result<ChunkRow> {
    Ok(ChunkRow {
        id: r.get(0)?,
        path: r.get(1)?,
        start_line: r.get::<_, i64>(2)? as usize,
        end_line: r.get::<_, i64>(3)? as usize,
        symbol: r.get(4)?,
        kind: r.get(5)?,
        text: r.get(6)?,
    })
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}
