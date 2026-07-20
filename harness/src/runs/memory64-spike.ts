export const MEMORY64_SPIKE_SCENARIO = "memory64-spike@1";
export const MEMORY64_SPIKE_REPORT_SCHEMA_VERSION = 1;
export const MEMORY64_SPIKE_REPEATS = 3;
export const MEMORY64_SPIKE_COMPLETION_TIMEOUT_MS = 35_000;
// Independent consumer-side pins for memory64-spike@1. These intentionally duplicate the
// producer contract: any workload change advances the scenario/report contract instead of
// silently teaching the existing consumer to accept producer drift.
export const MEMORY64_SPIKE_EXPECTED_TELEMETRY_SCHEMA_VERSION = 1;
export const MEMORY64_SPIKE_EXPECTED_COLD_SAMPLE_COUNT = 1;
export const MEMORY64_SPIKE_EXPECTED_WARMUP_SAMPLE_COUNT = 2;
export const MEMORY64_SPIKE_EXPECTED_MEASURED_SAMPLE_COUNT = 30;
export const MEMORY64_SPIKE_EXPECTED_COMPILE_BATCH_ITERATIONS = 2_048;
export const MEMORY64_SPIKE_EXPECTED_INSTANTIATE_BATCH_ITERATIONS = 32_768;
export const MEMORY64_SPIKE_EXPECTED_KERNEL_ROUNDS = 16;
export const MEMORY64_SPIKE_EXPECTED_PREPARE_ROUNDS = 8;
export const MEMORY64_SPIKE_EXPECTED_PREPARED_PAGES = 1_024;
export const MEMORY64_SPIKE_EXPECTED_HIGH_PAGES = 65_537;
export const MEMORY64_SPIKE_EXPECTED_HIGH_ADDRESS = 0x1_0000_0000;
export const MEMORY64_SPIKE_EXPECTED_HIGH_SENTINEL = 0x0bad_c0de;
export const MEMORY64_SPIKE_EXPECTED_CHECKSUM = 1_705_018_643;
