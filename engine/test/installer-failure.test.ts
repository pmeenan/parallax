import { describe, expect, it } from "vitest";
import {
  assertCanonicalInstallerFailureDiagnostic,
  createInstallerFailureDiagnostic,
  INSTALLER_FAILURE_RULES,
  installerFailureRecoveryAction,
  isCanonicalInstallerFailureMessage,
  parseInstallerResponse,
  sanitizeInstallerFailureMessage,
} from "../src";

describe("installer failure authority", () => {
  it("accepts every authoritative tuple and rejects the complete code/class/evidence cross-product", () => {
    for (const rule of INSTALLER_FAILURE_RULES) {
      for (const operation of rule.operations) {
        const resourceId = rule.resourcePresence === "forbidden" ? null : "resource-a";
        const diagnostic = createInstallerFailureDiagnostic(
          rule.code,
          rule.failureClass,
          rule.failureEvidence,
          "safe failure",
          resourceId,
          operation,
        );
        expect(assertCanonicalInstallerFailureDiagnostic(diagnostic)).toEqual(rule);
        expect(installerFailureRecoveryAction(diagnostic)).toBe(rule.recoveryAction);
      }
    }
    for (const code of new Set(INSTALLER_FAILURE_RULES.map((rule) => rule.code))) {
      for (const failureClass of new Set(
        INSTALLER_FAILURE_RULES.map((rule) => rule.failureClass),
      )) {
        for (const failureEvidence of new Set(
          INSTALLER_FAILURE_RULES.map((rule) => rule.failureEvidence),
        )) {
          for (const operation of ["install", "repair", "session", "target-status"] as const) {
            const candidates = INSTALLER_FAILURE_RULES.filter(
              (rule) =>
                rule.code === code &&
                rule.failureClass === failureClass &&
                rule.failureEvidence === failureEvidence &&
                rule.operations.includes(operation),
            );
            if (candidates.length > 0) continue;
            expect(() =>
              createInstallerFailureDiagnostic(
                code,
                failureClass,
                failureEvidence,
                "safe failure",
                null,
                operation,
              ),
            ).toThrow(/tuple/u);
          }
        }
      }
    }
  });

  it.each([
    ["control-split secret", "to\u200bken=split\u0000-secret"],
    ["basic authorization", "Authorization: Basic dXNlcjpwYXNz"],
    ["bearer authorization", "Authorization:\r\n Bearer top-secret"],
    ["digest authorization", "Authorization: Digest username=x, response=top-secret"],
    ["drive path with spaces", 'failed at "C:\\Users\\Private Person\\Secret File.bin"'],
    ["UNC path with spaces", 'failed at "\\\\server\\Private Share\\Secret File.bin"'],
    ["POSIX path with spaces", 'failed at "/home/private person/secret file.bin"'],
    ["file URL", "file:///C:/Users/private/secret.bin"],
    ["HTTP URL", "https://example.test/private path?token=top-secret"],
    ["password assignment", "password = top-secret"],
    ["API key assignment", "api-key:'top-secret'"],
    ["access token", "ACCESS_TOKEN=top-secret"],
    ["refresh-token query", "request failed?refresh-token=top-secret because quota was exceeded"],
    ["client secret", "client_secret=top-secret"],
    ["drive cause", "C:\\Private\\secret.bin because quota was exceeded"],
    ["UNC cause", "\\\\server\\private\\secret.bin because quota was exceeded"],
    ["POSIX cause", "/home/private/secret.bin because quota was exceeded"],
    [
      "unquoted spaced path cause",
      "C:\\Private Folder\\Secret File.bin because quota was exceeded",
    ],
    ["unquoted spaced path fail closed", "C:\\Private Folder\\Secret File.bin"],
  ])("canonically sanitizes %s", (_label, value) => {
    const sanitized = sanitizeInstallerFailureMessage(value);
    expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
    expect(sanitized).not.toMatch(
      /top-secret|split-secret|Private Person|private person|Secret File|private\/secret|dXNlcjpwYXNz|username=x|\p{Cc}|\p{Cf}/iu,
    );
    if (value.includes("because quota")) expect(sanitized).toContain("because quota was exceeded");
  });

  it("redacts Authorization credentials across every Unicode Cc/Cf separator", () => {
    const separators: string[] = [];
    for (let codePoint = 0; codePoint <= 0x10_ffff; codePoint += 1) {
      const candidate = String.fromCodePoint(codePoint);
      if (/[\p{Cc}\p{Cf}]/u.test(candidate)) separators.push(candidate);
    }
    expect(separators.length).toBeGreaterThan(100);

    for (const separator of separators) {
      for (const [scheme, credential] of [
        ["bAsIc", "BasicCredentialLeft"],
        ["bEaReR", "BearerCredentialLeft"],
      ] as const) {
        const sanitized = sanitizeInstallerFailureMessage(
          `aUtHoRiZaTiOn${separator}:${separator}${scheme}${separator}${credential}${separator}CredentialRight because quota was exceeded`,
        );
        expect(sanitized).toBe("Authorization: <credential> because quota was exceeded");
        expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
      }

      const digest = sanitizeInstallerFailureMessage(
        `aUtHoRiZaTiOn${separator}:${separator}dIgEsT${separator}username=DigestCredentialLeft,${separator}response=DigestCredentialRight because quota was exceeded`,
      );
      expect(digest).toBe("Authorization: <credential> because quota was exceeded");
      expect(isCanonicalInstallerFailureMessage(digest)).toBe(true);

      expect(
        sanitizeInstallerFailureMessage(
          `Authorization${separator}:Bearer${separator}NoCauseLeft${separator}NoCauseRight`,
        ),
      ).toBe("Authorization: <credential>");
    }
  });

  it("redacts folded, mixed-control, and control-deleted Authorization shadows", () => {
    for (const value of [
      "Authorization:\r\n\tbEaReR\u200bCredentialLeft\u0000CredentialRight because quota was exceeded",
      "Authori\u200bzation:\tBearer\tCredentialLeft because quota was exceeded",
      "AUTHORIZATION:\u2060DIGEST\r\n\tusername=CredentialLeft,\u200bresponse=CredentialRight because quota was exceeded",
    ]) {
      const sanitized = sanitizeInstallerFailureMessage(value);
      expect(sanitized).toBe("Authorization: <credential> because quota was exceeded");
      expect(sanitized).not.toMatch(/CredentialLeft|CredentialRight/u);
      expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
    }
  });

  it.each([
    [
      "same line",
      "Authorization: Bearer CredentialOne because quota was exceeded",
      "Authorization: <credential> because quota was exceeded",
    ],
    [
      "folded continuation",
      "Authorization: Bearer CredentialOne\r\n because quota was exceeded",
      "Authorization: <credential> because quota was exceeded",
    ],
    [
      "non-folded line",
      "Authorization: Bearer CredentialOne\r\nbecause quota was exceeded",
      "Authorization: <credential> because quota was exceeded",
    ],
    [
      "control-separated due-to",
      "Authorization: Basic CredentialOne due\tto quota",
      "Authorization: <credential> due to quota",
    ],
    [
      "folded reason",
      "Authorization: Digest username=CredentialOne\r\n reason: quota",
      "Authorization: <credential> reason: quota",
    ],
    [
      "folded quota",
      "Authorization: Bearer CredentialOne\r\n\tquota was exceeded",
      "Authorization: <credential> quota was exceeded",
    ],
  ])("preserves a causal clause on a %s boundary", (_label, value, expected) => {
    const sanitized = sanitizeInstallerFailureMessage(value);
    expect(sanitized).toBe(expected);
    expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
  });

  it("consumes every folded Authorization credential continuation before the cause", () => {
    const reviewerProbe =
      "aUtHoRiZaTiOn:\r\n\tbEaReR\r\n\tCredentialFirst\u200bHalf\r\n CredentialSecond\r\n\tCredentialThird\r\nbecause quota was exceeded";
    const sanitized = sanitizeInstallerFailureMessage(reviewerProbe);
    expect(sanitized).toBe("Authorization: <credential> because quota was exceeded");
    expect(sanitized).not.toMatch(/CredentialFirst|Half|Second|Third/u);
    expect(isCanonicalInstallerFailureMessage(reviewerProbe)).toBe(false);
    expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
  });

  it("consumes folded Digest parameters and a no-cause Authorization tail", () => {
    const digest = sanitizeInstallerFailureMessage(
      'Authorization:\r\n\tDigest\r\n\tusername="CredentialUser",\r\n realm="CredentialRealm",\r\n\tresponse="CredentialResponse"\r\nduring verification',
    );
    expect(digest).toBe("Authorization: <credential> during verification");
    expect(digest).not.toMatch(/CredentialUser|CredentialRealm|CredentialResponse/u);
    expect(
      sanitizeInstallerFailureMessage(
        "Authorization:\r\n\tBearer\r\n\tCredentialFirst\r\n CredentialSecond",
      ),
    ).toBe("Authorization: <credential>");
  });

  it("does not treat cause text inside quoted Digest auth-params as an external cause", () => {
    const reviewerProbe =
      'Authorization:\r\n\tDigest username="because quota", realm="reason=due to", nonce="after, while", uri="/when/during", response="since until", opaque="caused by; on account"\r\nbecause quota was exceeded';
    const sanitized = sanitizeInstallerFailureMessage(reviewerProbe);
    expect(sanitized).toBe("Authorization: <credential> because quota was exceeded");
    expect(sanitized).not.toMatch(
      /because quota",|reason=|due to"|after,|while"|\/when|during"|since until|caused by|on account"/u,
    );
    expect(isCanonicalInstallerFailureMessage(reviewerProbe)).toBe(false);
    expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
  });

  it("redacts every cause keyword and pair inside every quoted Digest field", () => {
    const fields = ["username", "realm", "nonce", "uri", "response", "opaque"] as const;
    const causes = [
      "because",
      "after",
      "while",
      "when",
      "during",
      "reason",
      "quota",
      "since",
      "until",
      "due to",
      "caused by",
      "on account",
    ] as const;
    for (const field of fields) {
      for (const cause of causes) {
        const sanitized = sanitizeInstallerFailureMessage(
          `Authorization: Digest ${field}="Credential ${cause}, equals=value"\r\nbecause external cause`,
        );
        expect(sanitized).toBe("Authorization: <credential> because external cause");
        expect(sanitized).not.toContain(`Credential ${cause}`);
      }
    }
  });

  it("tracks Digest escapes and folded controls through quoted values", () => {
    const sanitized = sanitizeInstallerFailureMessage(
      'Authorization: Digest username="Credential \\"because\\" \\\\ due to", realm="Credential\r\n reason,\r\n\tquota=inside", nonce="Credential=after,while"\r\nreason: external cause',
    );
    expect(sanitized).toBe("Authorization: <credential> reason: external cause");
    expect(sanitized).not.toMatch(/Credential|because|due to|quota=inside|after,while/u);
  });

  it("fails closed on malformed or ambiguous Digest boundaries", () => {
    for (const value of [
      'Authorization: Digest username="Credential because quota was exceeded',
      'Authorization: Digest username="Credential dangling\\',
      "Authorization: Digest username Credential because quota was exceeded",
      'Authorization: Digest username="Credential" continuation because quota was exceeded',
      'Authorization: Digest username="Credential", reason because quota was exceeded',
    ]) {
      const sanitized = sanitizeInstallerFailureMessage(value);
      expect(sanitized).toBe("Authorization: <credential>");
      expect(sanitized).not.toMatch(/Credential|because|quota|continuation|reason/u);
      expect(isCanonicalInstallerFailureMessage(value)).toBe(false);
      expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
    }
  });

  it("fails closed on every cause-shaped Digest assignment boundary", () => {
    const causes = [
      "because",
      "after",
      "while",
      "when",
      "during",
      "reason",
      "quota",
      "since",
      "until",
      "due to",
      "caused by",
      "on account",
    ] as const;
    const priorParams = ['username="PriorCredential"', "username=PriorCredential"] as const;
    const boundaries = [" ", "\t", "\u200b", "\r\n\t"] as const;
    for (const cause of causes) {
      for (const priorParam of priorParams) {
        for (const boundary of boundaries) {
          const value = `Authorization: Digest ${priorParam}${boundary}${cause}${boundary}=${boundary}"CredentialLeak"`;
          const sanitized = sanitizeInstallerFailureMessage(value);
          expect(sanitized).toBe("Authorization: <credential>");
          expect(sanitized).not.toMatch(/PriorCredential|CredentialLeak/u);
          expect(isCanonicalInstallerFailureMessage(value)).toBe(false);
          expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
        }
      }
    }
  });

  it("fails closed on cause-shaped identifier assignments without a comma", () => {
    for (const value of [
      'Authorization: Digest username="PriorCredential" reason = "CredentialLeak"',
      'Authorization: Digest username=PriorCredential because\t=\t"CredentialLeak"',
      'Authorization: Digest username="PriorCredential"\r\n\tdue to\u200b=\u200bCredentialLeak',
      'Authorization: Digest username="PriorCredential" because hidden-param = CredentialLeak',
      'Authorization: Digest username="PriorCredential" quota continuation=CredentialLeak',
      'Authorization: Digest username="PriorCredential" becauseToken=CredentialLeak',
    ]) {
      const sanitized = sanitizeInstallerFailureMessage(value);
      expect(sanitized).toBe("Authorization: <credential>");
      expect(sanitized).not.toMatch(/PriorCredential|CredentialLeak|hidden-param|continuation/u);
      expect(isCanonicalInstallerFailureMessage(value)).toBe(false);
    }
    expect(
      sanitizeInstallerFailureMessage(
        'Authorization: Digest username="PriorCredential" because quota was exceeded',
      ),
    ).toBe("Authorization: <credential> because quota was exceeded");
  });

  it("fails closed for every RFC tchar assignment after every Digest cause boundary", () => {
    const causes = [
      "because",
      "after",
      "while",
      "when",
      "during",
      "reason",
      "quota",
      "since",
      "until",
      "due to",
      "caused by",
      "on account",
    ] as const;
    const priorParams = ['username="PriorCredential"', "username=PriorCredential"] as const;
    const boundaries = [" ", "\t", "\u200b", "\r\n\t"] as const;
    const tcharCategories = [
      "A",
      "0",
      "!",
      "#",
      "$",
      "%",
      "&",
      "'",
      "*",
      "+",
      "-",
      ".",
      "^",
      "_",
      "`",
      "|",
      "~",
    ] as const;
    for (const cause of causes) {
      for (const priorParam of priorParams) {
        for (const boundary of boundaries) {
          for (const tchar of tcharCategories) {
            for (const assignment of [
              `${boundary}=${boundary}CredentialLeak`,
              `${boundary}=${boundary}"CredentialLeak"`,
              '\r\n\t=\r\n\t"CredentialLeak"',
            ]) {
              const value = `Authorization: Digest ${priorParam}${boundary}${cause}${boundary}${tchar}param${assignment}`;
              const sanitized = sanitizeInstallerFailureMessage(value);
              expect(sanitized).toBe("Authorization: <credential>");
              expect(sanitized).not.toMatch(/PriorCredential|CredentialLeak/u);
            }
          }
        }
      }
    }
  });

  it("intentionally fails closed when an otherwise external Digest cause contains equals", () => {
    for (const value of [
      'Authorization: Digest username="PriorCredential" because 123 = "CredentialLeak"',
      'Authorization: Digest username="PriorCredential" reason !\u200b=\u200b"CredentialLeak"',
      'Authorization: Digest username="PriorCredential"\r\n\tdue\tto\r\n\t`token`\r\n\t=\r\n\tCredentialLeak',
      'Authorization: Digest username="PriorCredential" because the unrelated diagnostic says "expected=actual"',
    ]) {
      const sanitized = sanitizeInstallerFailureMessage(value);
      expect(sanitized).toBe("Authorization: <credential>");
      expect(sanitized).not.toMatch(/PriorCredential|CredentialLeak|expected=actual/u);
      expect(isCanonicalInstallerFailureMessage(value)).toBe(false);
      expect(isCanonicalInstallerFailureMessage(sanitized)).toBe(true);
    }
    expect(
      sanitizeInstallerFailureMessage(
        'Authorization: Digest username="PriorCredential" because quota was exceeded',
      ),
    ).toBe("Authorization: <credential> because quota was exceeded");
  });

  it("normalizes non-secret controls as boundaries while joining obfuscated secrets", () => {
    expect(sanitizeInstallerFailureMessage("operation failed due\tto quota")).toBe(
      "operation failed due to quota",
    );
    expect(sanitizeInstallerFailureMessage("<credential>\u200bbecause quota")).toBe(
      "<credential> because quota",
    );
    expect(
      sanitizeInstallerFailureMessage(
        "pass\u200bword=Credential\u0000Value\u200bbecause quota was exceeded",
      ),
    ).toBe("<secret> because quota was exceeded");
    expect(
      sanitizeInstallerFailureMessage(
        "request?to\u200bken=Credential\u0000Value\u200bdue\tto quota",
      ),
    ).toBe("request?<secret> due to quota");
  });

  it("rejects control-boundary and control-deleted secret shadows as non-canonical", () => {
    for (const value of [
      "Authorization:\tBearer\tabc123",
      "Authorization: Bearer abc123",
      "Authorization:Bearerabc123",
      "pass\u200bword=abc123",
      "password=abc123",
      "to\u0000ken=abc123",
      "token=abc123",
    ]) {
      expect(isCanonicalInstallerFailureMessage(value)).toBe(false);
    }
  });

  it("rejects valid-length unsanitized protocol messages and every forged tuple", () => {
    const base = {
      code: "integrity",
      failureClass: "installer-transfer",
      failureEvidence: "transfer-integrity",
      expectedReleaseDigest: "a".repeat(64),
      failureSource: "operation",
      kind: "failure",
      message: "safe failure",
      operation: "repair",
      requestId: 1,
      resourceId: "resource-a",
    } as const;
    expect(() =>
      parseInstallerResponse({ ...base, message: "failed at C:\\Private\\secret.bin" }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({ ...base, message: "Authorization:\tBearer\tabc123" }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        message:
          "Authorization:\r\n\tBearer\r\n\tCredentialFirst\r\n CredentialSecond\r\nbecause quota was exceeded",
      }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        message:
          'Authorization: Digest username="PriorCredential"\r\n\treason\u200b=\u200b"CredentialLeak"',
      }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        message:
          'Authorization: Digest username="PriorCredential" because the diagnostic says "expected=actual"',
      }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        message:
          'Authorization: Digest username="because quota", realm="reason=due to", response="Credential"\r\nbecause external cause',
      }),
    ).toThrow(/sanitized/u);
    expect(() =>
      parseInstallerResponse({ ...base, failureClass: "quota", failureEvidence: "quota-exceeded" }),
    ).toThrow(/tuple/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        code: "quota",
        failureClass: "quota",
        failureEvidence: "quota-exceeded",
        expectedReleaseDigest: null,
        resourceId: "resource-a",
        operation: "install",
      }),
    ).not.toThrow();
    expect(() =>
      parseInstallerResponse({
        ...base,
        expectedReleaseDigest: null,
        operation: "target-status",
      }),
    ).toThrow(/tuple/u);
    expect(() =>
      parseInstallerResponse({
        ...base,
        code: "protocol",
        expectedReleaseDigest: null,
        failureClass: "protocol",
        failureEvidence: "protocol-request",
        failureSource: "session",
        operation: "session",
      }),
    ).toThrow(/resource presence/u);
  });
});
