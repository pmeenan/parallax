import { describe, expect, it } from "vitest";
import { parseTypeperfSample } from "./windows-storage-activity.js";

describe("Windows physical-disk activity", () => {
  it("parses finite nonnegative typeperf samples without depending on localized timestamps", () => {
    expect(
      parseTypeperfSample(
        '"07/17/2026 10:43:08.481","2418499.862186","1746637.532606","0.000387","3.000000"',
        123_456,
      ),
    ).toEqual({
      averageReadLatencySeconds: 0.000387,
      currentQueueLength: 3,
      diskReadBytesPerSecond: 2_418_499.862186,
      diskWriteBytesPerSecond: 1_746_637.532606,
      intervalEndedAtEpochMs: 123_456,
      intervalMs: 1_000,
    });
  });

  it("ignores headers and malformed or negative samples", () => {
    expect(parseTypeperfSample('"(PDH-CSV 4.0)","counter"', 1)).toBeNull();
    expect(parseTypeperfSample('"date","not-a-number","1","2","3"', 1)).toBeNull();
    expect(parseTypeperfSample('"date","-1","1","2","3"', 1)).toBeNull();
  });
});
