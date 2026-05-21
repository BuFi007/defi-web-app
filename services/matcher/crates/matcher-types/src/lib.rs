//! Shared wire-format types.
//!
//! The prost-generated module `proto::matcher::v1` holds the gRPC messages.
//! The `eip712` module holds the typed-data schemas for signed intents.

#![forbid(unsafe_code)]

pub mod eip712;

/// Prost-generated proto definitions.
pub mod proto {
    /// `matcher.v1` package.
    pub mod matcher {
        /// `matcher.v1` package contents.
        pub mod v1 {
            tonic::include_proto!("matcher.v1");
        }
    }
}
