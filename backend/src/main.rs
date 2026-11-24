const USAGE: &str = "\
Usage:
  synkban [OPTIONS]
  synkban export <output-dir> [--data-dir <path>]

Commands:
  export <output-dir>    Write or incrementally update a Readable Mirror (HTML + attachments)

Options:
      --data-dir <path>  Data storage directory
  -h, --help             Print help
  -V, --version          Print version

Environment:
  HOST           Bind address (default 127.0.0.1)
  PORT           Bind port (default 8080)
  DATA_DIR       Data storage directory
  ALLOWED_HOSTS  Extra host names to answer to, comma-separated, or *
                 (default: loopback only; any when HOST is 0.0.0.0 or ::)

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

fn resolve_data_dir(cli_data_dir: Option<String>) -> String {
    cli_data_dir
        .or_else(|| std::env::var("DATA_DIR").ok())
        .or_else(|| synkban::config::load().data_dir)
        .unwrap_or_else(|| {
            synkban::config::default_data_dir()
                .to_string_lossy()
                .into_owned()
        })
}

fn run_export_cli(args: &[String]) -> ! {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        println!("{USAGE}");
        std::process::exit(0);
    }

    let mut data_dir_arg: Option<String> = None;
    let mut output_dir: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--data-dir" {
            let Some(val) = args.get(i + 1) else {
                eprintln!("error: --data-dir requires a path\n\n{USAGE}");
                std::process::exit(2);
            };
            data_dir_arg = Some(val.clone());
            i += 2;
        } else if let Some(val) = arg.strip_prefix("--data-dir=") {
            data_dir_arg = Some(val.to_string());
            i += 1;
        } else if arg.starts_with('-') {
            eprintln!("error: unknown option {arg}\n\n{USAGE}");
            std::process::exit(2);
        } else if output_dir.is_none() {
            output_dir = Some(arg.clone());
            i += 1;
        } else {
            eprintln!("error: unexpected argument {arg}\n\n{USAGE}");
            std::process::exit(2);
        }
    }

    let Some(out) = output_dir else {
        eprintln!("error: export requires <output-dir>\n\n{USAGE}");
        std::process::exit(2);
    };
    let data_dir = resolve_data_dir(data_dir_arg);
    match synkban::mirror::export_to_dir(
        std::path::Path::new(&data_dir),
        std::path::Path::new(&out),
    ) {
        Ok(stats) => {
            println!(
                "Mirrored {} board(s), {} card(s) to {} ({} card(s) written, {} pruned, {} attachment(s) copied)",
                stats.boards,
                stats.cards,
                out,
                stats.cards_written,
                stats.cards_pruned,
                stats.attachments_copied
            );
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}

fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "export") {
        run_export_cli(&args[1..]);
    }
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
    let data_dir = resolve_data_dir(parse_data_dir(&args));

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
    let allowed =
        synkban::AllowedHosts::for_web(&host, std::env::var("ALLOWED_HOSTS").ok().as_deref());
    rt.block_on(synkban::run_server(&host, port, &data_dir, allowed))
}
