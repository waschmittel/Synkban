//! An idle keep-alive connection must outlive clients' own idle timeout
//! (Node: 5 s): closing at the same moment reset reused sockets (ECONNRESET).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc;
use std::time::Duration;

/// Sends `GET path` on `stream` and returns the status line (empty if closed).
fn get(stream: &mut TcpStream, path: &str) -> String {
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return String::new();
    }
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut status = String::new();
    if reader.read_line(&mut status).is_err() {
        return String::new();
    }
    let mut len = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            len = v.trim().parse().unwrap();
        }
    }
    reader.read_exact(&mut vec![0; len]).unwrap();
    status.trim_end().to_string()
}

fn assert_survives_idle(port: u16, path: &str) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    assert_eq!(get(&mut s, path), "HTTP/1.1 200 OK");
    std::thread::sleep(Duration::from_secs(6));
    assert_eq!(get(&mut s, path), "HTTP/1.1 200 OK");
}

#[test]
fn web_server_keeps_idle_connections_open() {
    let dir = tempfile::TempDir::new().unwrap();
    let data = dir.path().to_str().unwrap().to_string();
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    std::thread::spawn(move || {
        actix_web::rt::System::new().block_on(synkban::run_server(
            "127.0.0.1",
            port,
            &data,
            synkban::AllowedHosts::loopback(),
        ))
    });
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert_survives_idle(port, "/api/boards");
}

#[test]
fn desktop_server_keeps_idle_connections_open() {
    let dir = tempfile::TempDir::new().unwrap();
    let data = dir.path().to_str().unwrap().to_string();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        actix_web::rt::System::new().block_on(synkban::run_desktop_server(&data, "t0k", tx))
    });
    let port = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert_survives_idle(port, "/api/boards?token=t0k");
}
