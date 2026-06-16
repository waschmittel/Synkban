fn main() {
    // Bake the build version (set by build.sh) into the binary. Falls back to
    // "dev" for a bare `cargo build` outside the build script.
    println!("cargo:rerun-if-env-changed=SYNKBAN_VERSION");
    let version = std::env::var("SYNKBAN_VERSION").unwrap_or_else(|_| "dev".to_string());
    println!("cargo:rustc-env=SYNKBAN_VERSION={version}");
}
