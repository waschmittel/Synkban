const USAGE: &str = "\
Usage: synkban [OPTIONS]

Options:
      --data-dir <path>  Data storage directory
  -h, --help             Print help
  -V, --version          Print version

Environment:
  HOST       Bind address (default 127.0.0.1)
  PORT       Bind port (default 8080)
  DATA_DIR   Data storage directory

Data directory resolution: --data-dir > DATA_DIR > data_dir in
~/.config/synkban/synkban.toml > ~/.config/synkban/data";

/// Extract `--data-dir <path>` / `--data-dir=<path>` from the args, exiting
/// with a usage error when the flag is present but no path follows.
fn parse_data_dir(args: &[String]) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--data-dir" {
            match iter.next() {
                Some(path) => return Some(path.clone()),
                None => {
                    eprintln!("error: --data-dir requires a path\n\n{USAGE}");
                    std::process::exit(2);
                }
            }
        }
        if let Some(path) = arg.strip_prefix("--data-dir=") {
            return Some(path.to_string());
        }
    }
    None
}

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|a| a == "--version" || a == "-V") {
        println!("synkban {}", synkban::VERSION);
        return Ok(());
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        return Ok(());
    }

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse()
        .expect("PORT must be a valid u16");
    let data_dir = parse_data_dir(&args)
        .or_else(|| std::env::var("DATA_DIR").ok())
        .or_else(|| synkban::config::load().data_dir)
        .unwrap_or_else(|| {
            synkban::config::default_data_dir()
                .to_string_lossy()
                .into_owned()
        });

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
