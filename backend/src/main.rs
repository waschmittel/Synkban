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
            run_desktop(data_dir);
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
fn run_desktop(data_dir: String) {
    let token = uuid::Uuid::new_v4().to_string().replace("-", "");
    let (port_tx, port_rx) = std::sync::mpsc::channel();

    let server_data_dir = data_dir.clone();
    let server_token = token.clone();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("Failed to create Tokio runtime");
        rt.block_on(synkban::run_desktop_server(
            &server_data_dir,
            &server_token,
            port_tx,
        ))
        .expect("Server failed");
    });

    let port = port_rx.recv().expect("Failed to get server port");
    wait_for_server(port, &token);

    let url = format!("http://127.0.0.1:{port}/?token={token}");
    synkban::desktop::run(url);
}

#[cfg(feature = "desktop")]
fn wait_for_server(port: u16, token: &str) {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    let addr = format!("127.0.0.1:{port}");
    let request = format!(
        "GET /api/boards?token={token} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n"
    );

    for _ in 0..100 {
        if let Ok(mut stream) = TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(200),
        ) {
            stream.set_read_timeout(Some(Duration::from_millis(500))).ok();
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut buf = [0u8; 32];
                if let Ok(n) = stream.read(&mut buf) {
                    if n > 0 && buf.starts_with(b"HTTP/") {
                        return;
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("Warning: server may not be ready after 10s");
}
