//! Generate Rust types + tonic service stubs from `proto/matcher.v1.proto`.
//!
//! The single source of truth for the wire format is the .proto file at the
//! workspace root. Any edits to it MUST be matched by edits to
//! `docs/matcher-architecture.md` in the same PR (per spec sign-off rule).

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("matcher-types lives two levels deep in the workspace")
        .to_path_buf();

    let proto_path = workspace_root.join("proto").join("matcher.v1.proto");

    println!("cargo:rerun-if-changed={}", proto_path.display());

    // Use the pre-built protoc shipped by `protoc-bin-vendored` so we don't
    // depend on a system protoc being on PATH. Hermetic across hosts.
    if std::env::var_os("PROTOC").is_none() {
        std::env::set_var(
            "PROTOC",
            protoc_bin_vendored::protoc_bin_path()
                .expect("protoc-bin-vendored is missing a binary for this host"),
        );
    }

    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_protos(&[&proto_path], &[workspace_root.join("proto")])?;

    Ok(())
}
