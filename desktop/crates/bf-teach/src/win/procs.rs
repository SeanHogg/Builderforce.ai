//! Which processes belong to the program the app launched: the launched process, its
//! descendants, and any process with the same executable name (many Windows apps hand off
//! to another instance on start). Recording and replay act only inside this scope — never
//! in the rest of the desktop, and never in Synapse itself.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};

const REFRESH_EVERY: Duration = Duration::from_millis(1000);

pub struct Scope {
    root: u32,
    exe_name: String,
    sys: System,
    allowed: HashSet<u32>,
    names: HashMap<u32, String>,
    refreshed: Option<Instant>,
}

impl Scope {
    pub fn new(root_pid: u32, program: &str) -> Self {
        let exe_name = program.rsplit(['/', '\\']).next().unwrap_or(program).to_lowercase();
        let mut s = Self { root: root_pid, exe_name, sys: System::new(), allowed: HashSet::new(), names: HashMap::new(), refreshed: None };
        s.refresh();
        s
    }

    fn refresh(&mut self) {
        self.sys.refresh_processes(ProcessesToUpdate::All, true);
        let own = std::process::id();
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        self.names.clear();
        self.allowed.clear();
        for (pid, p) in self.sys.processes() {
            let pid = pid.as_u32();
            let name = p.name().to_string_lossy().to_string();
            if let Some(parent) = p.parent() {
                children.entry(parent.as_u32()).or_default().push(pid);
            }
            if name.to_lowercase() == self.exe_name && pid != own {
                self.allowed.insert(pid);
            }
            self.names.insert(pid, name);
        }
        let mut visited = HashSet::new();
        let mut stack = vec![self.root];
        while let Some(pid) = stack.pop() {
            if pid == own || !visited.insert(pid) {
                continue;
            }
            self.allowed.insert(pid);
            stack.extend(children.get(&pid).into_iter().flatten().copied());
        }
        self.refreshed = Some(Instant::now());
    }

    /// Whether `pid` is the launched program. A pid not seen before triggers a refresh
    /// (the program may have just started a child), at most once a second.
    pub fn contains(&mut self, pid: u32) -> bool {
        if self.allowed.contains(&pid) {
            return true;
        }
        self.refresh_if_stale();
        self.allowed.contains(&pid)
    }

    pub fn name(&self, pid: u32) -> String {
        self.names.get(&pid).cloned().unwrap_or_default()
    }

    fn refresh_if_stale(&mut self) {
        if self.refreshed.is_none_or(|t| t.elapsed() >= REFRESH_EVERY) {
            self.refresh();
        }
    }

    pub fn pids(&mut self) -> Vec<u32> {
        self.refresh_if_stale();
        self.allowed.iter().copied().collect()
    }

    /// Whether the launched program is still running — false once the person closed it
    /// (the root and every process of the same program are gone).
    pub fn root_alive(&mut self) -> bool {
        self.refresh_if_stale();
        self.sys.process(Pid::from_u32(self.root)).is_some() || !self.allowed.is_empty()
    }
}
