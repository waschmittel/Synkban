fn main() -> std::io::Result<()> {
    if std::env::args().skip(1).any(|a| a == "--version" || a == "-V") {
        println!("synkban {}", synkban::VERSION);
        return Ok(());
    }

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a valid u16");
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "./data".into());

    // Desktop mode: Electron spawns this binary with DESKTOP_TOKEN set.
    // We start on a random port, print DESKTOP_PORT=N, and run with token auth.
    if let Ok(token) = std::env::var("DESKTOP_TOKEN") {
        let (port_tx, port_rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            if let Ok(p) = port_rx.recv() {
                println!("DESKTOP_PORT={p}");
            }
        });
        let rt = tokio::runtime::Runtime::new()?;
        return rt.block_on(synkban::run_desktop_server(&data_dir, &token, port_tx));
    }

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(synkban::run_server(&host, port, &data_dir))
}
