//! System tray: the service keeps running with the window closed, so the tray is how the
//! person reopens it or quits. Labels follow the OS locale (the five product locales).

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

struct Labels {
    open: &'static str,
    quit: &'static str,
    tooltip: &'static str,
}

fn labels() -> Labels {
    let locale = sys_locale::get_locale().unwrap_or_default().to_ascii_lowercase();
    let lang = locale.split(['-', '_']).next().unwrap_or("en");
    match lang {
        "de" => Labels { open: "Öffnen", quit: "Beenden", tooltip: "Builderforce Desktop — indiziert lokal" },
        "es" => Labels { open: "Abrir", quit: "Salir", tooltip: "Builderforce Desktop — indexa en local" },
        "fr" => Labels { open: "Ouvrir", quit: "Quitter", tooltip: "Builderforce Desktop — indexation locale" },
        "zh" => Labels { open: "打开", quit: "退出", tooltip: "Builderforce Desktop — 本地索引" },
        _ => Labels { open: "Open", quit: "Quit", tooltip: "Builderforce Desktop — indexing locally" },
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let l = labels();
    let open = MenuItem::with_id(app, "open", l.open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main").menu(&menu).tooltip(l.tooltip);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
