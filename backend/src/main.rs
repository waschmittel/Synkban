fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let desktop_mode = args.iter().any(|a| a == "--desktop");

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a valid u16");
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "./data".into());

    if desktop_mode {
        #[cfg(feature = "desktop")]
        {
            let server_host = host.clone();
            let server_data_dir = data_dir.clone();

            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
                rt.block_on(synkban::run_server(&server_host, port, &server_data_dir))
                    .expect("Server failed");
            });

            let bind = format!("{host}:{port}");
            wait_for_server(&bind);

            let url = format!("http://{bind}");
            synkban::desktop::run(url);
            return Ok(());
        }
        #[cfg(not(feature = "desktop"))]
        {
            eprintln!(
                "Error: --desktop requires the 'desktop' feature.\n\
                 Rebuild with: cargo build --features desktop"
            );
            std::process::exit(1);
        }
    }

    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(synkban::run_server(&host, port, &data_dir))
}

#[cfg(feature = "desktop")]
fn wait_for_server(bind: &str) {
    use std::net::TcpStream;
    use std::time::Duration;

    let addr: std::net::SocketAddr = bind.parse().expect("Invalid bind address");
    for _ in 0..50 {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("Warning: server may not be ready after 5s");
}
