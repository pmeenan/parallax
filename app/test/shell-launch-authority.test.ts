import { OfflineShellServiceError } from "@parallax/engine";
import { describe, expect, it, vi } from "vitest";
import { completeInstalledRuntimeShellAdmission } from "../src/shell-launch-authority";

const ADMISSION = Object.freeze({
  generationId: `${"a".repeat(64)}:${"b".repeat(64)}`,
  releaseDigest: "b".repeat(64),
});

describe("installed runtime shell launch authority", () => {
  it("does not admit when same-generation controller authority is revoked during preflight", async () => {
    const authority = authorityFixture();
    let finishPreflight!: () => void;
    const preflight = new Promise<string>((resolve) => {
      finishPreflight = () => resolve("preflight");
    });
    const admit = vi.fn(() => Promise.resolve());
    const operation = completeInstalledRuntimeShellAdmission(
      () => preflight,
      { admit },
      ADMISSION,
      authority.value,
    );

    authority.controller.abort(
      new OfflineShellServiceError(
        "shell-release-mismatch",
        "same-generation controller was replaced",
      ),
    );
    finishPreflight();

    await expect(operation).rejects.toMatchObject({
      code: "shell-release-mismatch",
      message: "same-generation controller was replaced",
    });
    expect(admit).not.toHaveBeenCalled();
    expect(authority.markAdmitted).not.toHaveBeenCalled();
  });

  it("does not cross the immutable boundary when authority is revoked during locked admit", async () => {
    const authority = authorityFixture();
    const admit = vi.fn(async () => {
      authority.controller.abort(
        new OfflineShellServiceError("shell-release-mismatch", "controller lost during admit"),
      );
    });

    await expect(
      completeInstalledRuntimeShellAdmission(
        () => Promise.resolve("preflight"),
        { admit },
        ADMISSION,
        authority.value,
      ),
    ).rejects.toMatchObject({
      code: "shell-release-mismatch",
      message: "controller lost during admit",
    });
    expect(authority.markAdmitted).not.toHaveBeenCalled();
  });

  it("keeps the immutable result valid after successful locked admission", async () => {
    const authority = authorityFixture();

    await expect(
      completeInstalledRuntimeShellAdmission(
        () => Promise.resolve("preflight"),
        { admit: vi.fn(() => Promise.resolve()) },
        ADMISSION,
        authority.value,
      ),
    ).resolves.toBe("preflight");
    expect(authority.markAdmitted).toHaveBeenCalledOnce();

    authority.controller.abort(
      new OfflineShellServiceError("shell-release-mismatch", "controller changed later"),
    );
    expect(authority.markAdmitted).toHaveBeenCalledOnce();
  });
});

function authorityFixture() {
  const controller = new AbortController();
  const markAdmitted = vi.fn();
  return {
    controller,
    markAdmitted,
    value: Object.freeze({
      markAdmitted,
      signal: controller.signal,
    }),
  };
}
