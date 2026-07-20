# Rust/WebAssembly threads spike

This M0 module is a bounded platform probe, not a production job system. Two dedicated
workers instantiate the same Rust-authored `wasm32-unknown-unknown` module over one
fixed-size shared linear memory. Atomic task claims and reductions prove concurrent
participation; the task kernel uses `simd128` and the build enables the project baseline
features (`atomics`, `simd128`, and `relaxed-simd`) unconditionally.

The crate forbids unsafe Rust. Browser APIs and worker orchestration remain in the
TypeScript engine service. The generated bindings and optimized `.wasm` are build
outputs and are not checked in. The repository-level `rust-toolchain.toml` pins the
dated nightly and components; `pnpm build:wasm` additionally verifies exact rustc,
Cargo, wasm-bindgen CLI, and Binaryen versions before emitting the module.
