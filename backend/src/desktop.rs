pub fn run(url: String) {
    tauri::Builder::default()
        .setup(move |app| {
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url.parse().unwrap()),
            )
            .title("Synkban")
            .inner_size(1200.0, 800.0)
            .build()?;

            #[cfg(debug_assertions)]
            window.open_devtools();
            let _ = &window;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Failed to run Tauri application");
}
