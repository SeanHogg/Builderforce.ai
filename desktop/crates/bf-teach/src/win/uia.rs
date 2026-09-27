//! UI Automation: describe an element the person acted on, and find it again at replay.
//! Every COM object here is `!Send`, so a `Uia` lives and dies on one thread — the
//! recorder's or the run's.

use super::err;
use anyhow::Result;
use crate::model::ElementRef;
use uiautomation::patterns::{UIInvokePattern, UIValuePattern};
use uiautomation::types::{Point, Rect};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

/// How far a search walks a window's tree before giving up — large apps have tens of
/// thousands of nodes, and a replay step should fail over to the recorded position well
/// before a full walk.
const MAX_NODES: usize = 6000;

pub struct Uia {
    auto: UIAutomation,
    walker: UITreeWalker,
    root: UIElement,
}

pub struct Window {
    pub element: UIElement,
    pub title: String,
    pub rect: Rect,
}

impl Uia {
    pub fn new() -> Result<Self> {
        let auto = UIAutomation::new().map_err(err)?;
        let walker = auto.get_control_view_walker().map_err(err)?;
        let root = auto.get_root_element().map_err(err)?;
        Ok(Self { auto, walker, root })
    }

    pub fn at(&self, x: i32, y: i32) -> Option<UIElement> {
        self.auto.element_from_point(Point::new(x, y)).ok()
    }

    pub fn focused(&self) -> Option<UIElement> {
        self.auto.get_focused_element().ok()
    }

    /// The top-level window an element sits in.
    pub fn window_of(&self, el: &UIElement) -> Option<Window> {
        let mut current = el.clone();
        for _ in 0..64 {
            let parent = self.walker.get_parent(&current).ok()?;
            if self.auto.compare_elements(&parent, &self.root).unwrap_or(false) {
                return window(current);
            }
            current = parent;
        }
        None
    }

    /// Top-level windows owned by any of `pids`.
    pub fn windows_of(&self, pids: &[u32]) -> Vec<Window> {
        self.walker
            .get_children(&self.root)
            .unwrap_or_default()
            .into_iter()
            .filter(|w| pid(w).is_some_and(|p| pids.contains(&p)))
            .filter_map(window)
            .collect()
    }

    /// Describe `el` for a recorded step. `point` is where it was clicked (screen
    /// coordinates); without one, its centre is recorded.
    pub fn describe(&self, el: &UIElement, point: Option<(i32, i32)>, process_name: &str) -> ElementRef {
        let win = self.window_of(el);
        let (px, py) = point.unwrap_or_else(|| centre(el));
        let (wx, wy) = win.as_ref().map(|w| (w.rect.get_left(), w.rect.get_top())).unwrap_or((0, 0));
        ElementRef {
            name: el.get_name().unwrap_or_default(),
            automation_id: el.get_automation_id().unwrap_or_default(),
            control_type: control_type(el),
            class_name: el.get_classname().unwrap_or_default(),
            window_title: win.map(|w| w.title).unwrap_or_default(),
            process_name: process_name.to_string(),
            rel_x: px - wx,
            rel_y: py - wy,
        }
    }

    /// Find the element a step recorded, inside `win`, by accessibility identity: its
    /// automation id when it has one, else its name — always with its control type.
    pub fn find(&self, win: &Window, target: &ElementRef) -> Option<UIElement> {
        let by_id = !target.automation_id.is_empty();
        let matches = |el: &UIElement| {
            if control_type(el) != target.control_type {
                return false;
            }
            if by_id {
                el.get_automation_id().map(|id| id == target.automation_id).unwrap_or(false)
            } else {
                !target.name.is_empty() && el.get_name().map(|n| n == target.name).unwrap_or(false)
            }
        };
        if matches(&win.element) {
            return Some(win.element.clone());
        }
        let mut queue = std::collections::VecDeque::from([win.element.clone()]);
        let mut seen = 0usize;
        while let Some(node) = queue.pop_front() {
            let mut child = self.walker.get_first_child(&node).ok();
            while let Some(c) = child {
                seen += 1;
                if seen > MAX_NODES {
                    return None;
                }
                if matches(&c) {
                    return Some(c);
                }
                child = self.walker.get_next_sibling(&c).ok();
                queue.push_back(c);
            }
        }
        None
    }
}

fn window(el: UIElement) -> Option<Window> {
    let rect = el.get_bounding_rectangle().ok()?;
    Some(Window { title: el.get_name().unwrap_or_default(), rect, element: el })
}

pub fn pid(el: &UIElement) -> Option<u32> {
    el.get_process_id().ok()
}

pub fn control_type(el: &UIElement) -> String {
    el.get_control_type().map(|c| format!("{c:?}")).unwrap_or_default()
}

pub fn centre(el: &UIElement) -> (i32, i32) {
    el.get_bounding_rectangle()
        .map(|r| ((r.get_left() + r.get_right()) / 2, (r.get_top() + r.get_bottom()) / 2))
        .unwrap_or((0, 0))
}

pub fn is_password(el: &UIElement) -> bool {
    el.is_password().unwrap_or(false)
}

pub fn value(el: &UIElement) -> Option<String> {
    el.get_pattern::<UIValuePattern>().ok()?.get_value().ok()
}

/// Set a value through the Value pattern. False when the element has no writable one.
pub fn set_value(el: &UIElement, v: &str) -> bool {
    match el.get_pattern::<UIValuePattern>() {
        Ok(p) if !p.is_readonly().unwrap_or(true) => p.set_value(v).is_ok(),
        _ => false,
    }
}

/// Activate through the Invoke pattern (no pointer involved); false when there is none.
pub fn invoke(el: &UIElement) -> bool {
    el.get_pattern::<UIInvokePattern>().and_then(|p| p.invoke()).is_ok()
}

pub fn same(a: &UIElement, b: &UIElement, uia: &Uia) -> bool {
    uia.auto.compare_elements(a, b).unwrap_or(false)
}
