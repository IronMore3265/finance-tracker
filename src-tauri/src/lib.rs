/// The desktop shell.
///
/// It hosts the same `dist/` the browser and Android builds run, and adds two
/// capabilities a web page cannot have: a native Save dialog, and a write to
/// the path that dialog returned. Both are reached from
/// `src/platform/savers/tauri.ts`, which is loaded only once
/// `platform/host.ts` has seen Tauri's globals.
///
/// Registering a plugin here is only half of granting it — what the web layer
/// may actually call is the intersection of this list and
/// `capabilities/default.json`. A plugin registered but not in the capability
/// is inert, and a permission in the capability whose plugin is not registered
/// fails at runtime.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
