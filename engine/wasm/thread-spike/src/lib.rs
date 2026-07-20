#![forbid(unsafe_code)]

use core::arch::wasm32::{u32x4, u32x4_add, u32x4_extract_lane, v128_xor};
use core::sync::atomic::{AtomicU32, Ordering};
use wasm_bindgen::prelude::wasm_bindgen;

static NEXT_TASK: AtomicU32 = AtomicU32::new(0);
static COMPLETED_TASKS: AtomicU32 = AtomicU32::new(0);
static CHECKSUM: AtomicU32 = AtomicU32::new(0);
static WORKER_MASK: AtomicU32 = AtomicU32::new(0);
static TASK_COUNT: AtomicU32 = AtomicU32::new(0);
static READY_WORKERS: AtomicU32 = AtomicU32::new(0);

const MIX_ROUNDS: u32 = 24;

#[wasm_bindgen]
pub fn reset(task_count: u32) {
    NEXT_TASK.store(0, Ordering::SeqCst);
    COMPLETED_TASKS.store(0, Ordering::SeqCst);
    CHECKSUM.store(0, Ordering::SeqCst);
    WORKER_MASK.store(0, Ordering::SeqCst);
    TASK_COUNT.store(task_count, Ordering::SeqCst);
    READY_WORKERS.store(0, Ordering::SeqCst);
}

#[wasm_bindgen]
pub fn run(worker_index: u32, worker_count: u32) -> u32 {
    let worker_bit = 1_u32.checked_shl(worker_index).unwrap_or(0);
    let task_count = TASK_COUNT.load(Ordering::SeqCst);
    let mut claimed = 0;
    let mut local_checksum = 0;

    READY_WORKERS.fetch_add(1, Ordering::SeqCst);
    while READY_WORKERS.load(Ordering::SeqCst) < worker_count {
        core::hint::spin_loop();
    }

    loop {
        let task = NEXT_TASK.fetch_add(1, Ordering::SeqCst);
        if task >= task_count {
            break;
        }
        local_checksum ^= mix_task(task);
        claimed += 1;
    }

    CHECKSUM.fetch_xor(local_checksum, Ordering::SeqCst);
    COMPLETED_TASKS.fetch_add(claimed, Ordering::SeqCst);
    if claimed > 0 {
        WORKER_MASK.fetch_or(worker_bit, Ordering::SeqCst);
    }
    claimed
}

#[wasm_bindgen]
pub fn completed_tasks() -> u32 {
    COMPLETED_TASKS.load(Ordering::SeqCst)
}

#[wasm_bindgen]
pub fn checksum() -> u32 {
    CHECKSUM.load(Ordering::SeqCst)
}

#[wasm_bindgen]
pub fn worker_mask() -> u32 {
    WORKER_MASK.load(Ordering::SeqCst)
}

#[wasm_bindgen]
pub fn reference_checksum(task_count: u32) -> u32 {
    (0..task_count).fold(0, |checksum, task| checksum ^ mix_task(task))
}

fn mix_task(task: u32) -> u32 {
    let mut lanes = u32x4(
        task,
        task ^ 0x9e37_79b9,
        task.wrapping_mul(0x85eb_ca6b),
        task.rotate_left(13),
    );
    let increment = u32x4(0x7f4a_7c15, 0x94d0_49bb, 0x27d4_eb2d, 0x1656_67b1);
    for _ in 0..MIX_ROUNDS {
        lanes = u32x4_add(lanes, increment);
        lanes = v128_xor(lanes, u32x4_add(lanes, lanes));
    }
    u32x4_extract_lane::<0>(lanes)
        ^ u32x4_extract_lane::<1>(lanes)
        ^ u32x4_extract_lane::<2>(lanes)
        ^ u32x4_extract_lane::<3>(lanes)
}
