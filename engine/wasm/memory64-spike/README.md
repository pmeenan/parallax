# WebAssembly memory64 spike

This pair of hand-written modules keeps the measured operation identical while changing
only linear-memory address width. Both begin at one 64 KiB page, grow to 64 MiB, fill the
same deterministic words eight times, and expose the same scan kernel; the harness invokes
that kernel for sixteen rounds. The memory64 module additionally
grows to 65,537 pages and round-trips a sentinel at byte address `0x1_0000_0000`, proving
that one module actually addresses data beyond 4 GiB rather than merely declaring the
feature.

The modules are intentionally WAT/Binaryen rather than Rust. The experiment needs exact
control over i32 versus i64 addresses in the paired prepare/scan functions and a
beyond-4-GiB instruction that does not commit a multi-gigabyte Rust heap. The extra proof
export exists only in memory64, so binary size and whole-module compile/instantiate timings
are end-to-end apparatus observations rather than a pointer-width-only comparison.
Production engine modules remain Rust-authored under D-085; memory32 remains their default
under P-001.
