import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const execFileAsync = promisify(execFile);

describe("production deployment contract", () => {
  it("keeps nginx static, isolated, and cache-correct for mutable and immutable responses", async () => {
    const config = await readFile(
      resolve(repositoryRoot, "deploy/nginx/parallax-web.com.conf"),
      "utf8",
    );
    expect(config).toContain("root /var/www/parallax-web.com;");
    expect(config).toContain('map "$status:$http_range:$uri" $parallax_cache_control');
    expect(config).toContain('default "no-cache";');
    expect(config).toContain('"~^(?:200|304)::/immutable/[a-z0-9-]+-[a-f0-9]{64}\\.[a-z0-9]+$"');
    expect(config).not.toMatch(/^\s*~[^\r\n]*\{64\}/m);
    expect(config).toContain('"public, max-age=31536000, immutable"');
    const immutableRule = /"~([^"]+)"\s+"public, max-age=31536000, immutable";/.exec(config)?.[1];
    if (immutableRule === undefined) throw new Error("nginx immutable map rule is missing");
    const immutableMatch = new RegExp(immutableRule);
    const immutablePath = `/immutable/model-${"a".repeat(64)}.gguf`;
    expect([
      immutableMatch.test(`200::${immutablePath}`),
      immutableMatch.test(`304::${immutablePath}`),
      immutableMatch.test(`200:bytes=0-0:${immutablePath}`),
      immutableMatch.test(`206:bytes=0-0:${immutablePath}`),
      immutableMatch.test(`416:bytes=123-123:${immutablePath}`),
      immutableMatch.test("200::/index.html"),
    ]).toEqual([true, true, false, false, false, false]);
    expect(config).toContain('add_header Cross-Origin-Opener-Policy "same-origin" always;');
    expect(config).toContain('add_header Cross-Origin-Embedder-Policy "require-corp" always;');
    expect(config.match(/add_header Cross-Origin-Opener-Policy/g)?.length).toBe(4);
    expect(config).toContain("try_files $uri =404;");
    expect(config).toContain("add_header Allow $parallax_allow always;");
    expect(config).toContain('map "$request_method:$uri" $parallax_allow');
    expect(config).toContain('default "GET, HEAD";');
    expect(config).toContain('"POST:/uninstall" "";');
    expect(config).toContain('~^[^:]+:/uninstall$ "POST";');
    expect(config).not.toContain("include /etc/nginx/mime.types;");
    expect(config.match(/^\s*default_type application\/octet-stream;\s*$/gm)).toHaveLength(1);
    expect(config.match(/^\s*etag on;\s*$/gm)).toHaveLength(1);
    expect(config).toContain("application/javascript js;");
    expect(config).toContain("application/json json map;");
    expect(config).toContain("image/ktx2 ktx2;");
    expect(config).toContain("application/octet-stream meshopt;");
    expect(config).toContain("application/wasm wasm;");
    expect(config).toContain('map "$request_method:$uri" $parallax_method_allowed');
    expect(config).toContain('"POST:/uninstall" 1;');
    expect(config).toContain("~^(?:GET|HEAD): 1;");
    expect(config).toContain("if ($parallax_method_allowed = 0)");
    expect(config).not.toContain("if ($request_method !~ ^(GET|HEAD)$)");
    expect(config.match(/"POST:[^"]+" 1;/g)).toEqual(['"POST:/uninstall" 1;']);
    expect(config.indexOf('map "$request_method:$uri"')).toBeLessThan(config.indexOf("server {"));
    expect(config).toContain(
      'map "$request_method:$http_sec_fetch_site:$http_sec_fetch_mode:$http_sec_fetch_user:$http_sec_fetch_dest:$is_args"',
    );
    expect(config).toContain("return 405;");
    expect(config).toContain("server_name www.parallax-web.com;");
    expect(config).toContain("return 308 https://parallax-web.com$request_uri;");
    expect(config.match(/return 308 https:\/\/parallax-web\.com\$request_uri;/g)).toHaveLength(2);
    expect(config).toContain("location = /");
    expect(config).toContain("try_files /index.html =404;");
    expect(config).toContain("location = /service-worker.js");
    expect(config).toContain("try_files /service-worker.js =404;");
    expect(config).toContain("location = /uninstall");
    expect(config).toContain("$parallax_clear_site_data");
    expect(config).toContain('"POST:same-origin:navigate:?1:document:"');
    expect(config).toContain("add_header Clear-Site-Data $parallax_clear_site_data always;");
    expect(config).toContain("if ($request_method != POST)");
    expect(config).toContain('if ($parallax_clear_site_data = "")');
    expect(config).toContain('add_header Cache-Control "no-store" always;');
    expect(config).not.toMatch(/location\s+[~^][^{]*uninstall/);
    expect(config.match(/add_header Cache-Control/g)?.length).toBe(4);
    expect(config.match(/add_header Cross-Origin-Embedder-Policy/g)?.length).toBe(4);
    expect(config.match(/add_header X-Content-Type-Options/g)?.length).toBe(4);
    expect(config).not.toMatch(/\badd_header\s+Accept-Ranges\b/i);
    expect(config).not.toMatch(/\b(proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass)\b/);
    expect(config).not.toMatch(/\bcloudflare\b/i);
  });

  it("fixes the only remote target and keeps preview as the default", async () => {
    const packageDocument = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    expect(packageDocument.scripts?.["deploy:production"]).toBe(
      "powershell -NoProfile -File deploy/Deploy-Production.ps1",
    );
    expect(packageDocument.scripts?.["deploy:production:apply"]).toBe(
      "powershell -NoProfile -File deploy/Deploy-Production-Apply.ps1",
    );
    expect(packageDocument.scripts?.["deploy:model-content"]).toBe(
      "powershell -NoProfile -File deploy/Deploy-Model-Content.ps1",
    );
    expect(packageDocument.scripts?.["deploy:model-content:apply"]).toBe(
      "powershell -NoProfile -File deploy/Deploy-Model-Content-Apply.ps1",
    );
    const packageCommands = Object.values(packageDocument.scripts ?? {}).join("\n");
    expect(packageCommands).not.toContain("-- -Deploy");
    expect(packageCommands).not.toMatch(/deploy:(?:production|model-content)[^\n]*--/);

    const script = await readFile(resolve(repositoryRoot, "deploy/Deploy-Production.ps1"), "utf8");
    expect(script).toContain("[switch]$Deploy");
    expect(script).toContain("PREVIEW ONLY");
    expect(script).toContain("$productionEntryInternalLoadOnly = [bool]$InternalLoadOnly");
    expect(script).toContain("if (-not $productionEntryInternalLoadOnly)");
    expect(script).toContain("PARALLAX_PRODUCTION_ENTRYPOINT_COMPLETE mode=$mode");
    expect(script).toContain("'pnpm.cmd'");
    expect(script).toContain("'plex'");
    expect(script).toContain("/var/www/parallax-web.com");
    expect(script).toContain("test ! -L");
    expect(script).toContain("0`$parent_mode & 022");
    expect(script).toContain("findmnt -rn -o TARGET");
    expect(script).not.toContain("mktemp");
    expect(script).toContain("deployment-lock-present:$($script:RemoteLock)");
    expect(script).toContain(".parallax-deploy.lock");
    expect(script).toContain("ExpectedParentIdentity");
    expect(script).toContain("expected.inventory");
    expect(script).toContain("$manifest.schemaVersion -ne 15");
    expect(script).toContain("offline-shell v1 compatibility contract");
    expect(script).toContain("stable service-worker artifact");
    expect(script).toContain("sha256sum");
    expect(script).toContain("cmp -s");
    expect(script).toContain("'scp.exe'");
    expect(script).not.toMatch(/\brsync\b/);
    expect(script).not.toMatch(/\b(staging|backup)\b/i);
    expect(script).not.toMatch(/Remove-Item|Clear-Content/);
    expect(script).not.toMatch(/Copy-ToRemote[^\r\n]*site/i);

    const tests = await readFile(
      resolve(repositoryRoot, "deploy/Deploy-Production.Tests.ps1"),
      "utf8",
    );
    expect(tests).not.toContain("C:\\Program Files\\Git");
    expect(tests).toContain("PARALLAX_RUN_POSIX_DEPLOY_TESTS");
    expect(tests).toContain("Get-Command sh.exe");
    expect(tests).toContain("Get-Command wsl.exe");
  });

  it("uses fixed no-argument same-process apply wrappers", async () => {
    const contracts = [
      {
        childName: "Deploy-Production.ps1",
        completionMarker: "PARALLAX_PRODUCTION_ENTRYPOINT_COMPLETE mode=deploy",
        wrapperName: "Deploy-Production-Apply.ps1",
      },
      {
        childName: "Deploy-Model-Content.ps1",
        completionMarker: "PARALLAX_TEST_ONLY_MODEL_CHILD_COMPLETE",
        wrapperName: "Deploy-Model-Content-Apply.ps1",
      },
    ] as const;
    const expectedWrapperSource = (childName: string) =>
      [
        "[CmdletBinding()]",
        "param()",
        "",
        "$ErrorActionPreference = 'Stop'",
        "Set-StrictMode -Version Latest",
        "",
        "$LASTEXITCODE = 0",
        `& (Join-Path $PSScriptRoot '${childName}') -Deploy -Confirm:$false`,
        "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      ].join("\n");
    const childStub = [
      "[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]",
      "param(",
      "    [switch]$Deploy,",
      "    [Parameter(ValueFromRemainingArguments = $true)][object[]]$RemainingArguments",
      ")",
      "Set-StrictMode -Version Latest",
      "if ($env:PARALLAX_APPLY_WRAPPER_TEST_MODE -ceq 'throw') {",
      "    throw [System.InvalidOperationException]::new('PARALLAX_APPLY_CHILD_THROW')",
      "}",
      "if ($env:PARALLAX_APPLY_WRAPPER_TEST_MODE -ceq 'exit') { exit 37 }",
      "$confirm = $PSBoundParameters['Confirm']",
      "$argumentCount = 0",
      "if ($null -ne $RemainingArguments) { $argumentCount = $RemainingArguments.Length }",
      "[pscustomobject]@{",
      "    ArgumentCount = $argumentCount",
      "    BoundParameterNames = @($PSBoundParameters.Keys | Sort-Object)",
      "    ChildPath = [System.IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)",
      "    ConfirmIsPresent = $confirm.IsPresent",
      "    ConfirmType = $confirm.GetType().FullName",
      "    DeployIsPresent = $Deploy.IsPresent",
      "    DeployType = $Deploy.GetType().FullName",
      "} | ConvertTo-Json -Compress",
      "Write-Output $env:PARALLAX_APPLY_WRAPPER_TEST_MARKER",
      "",
    ].join("\r\n");
    const fakeRoot = await mkdtemp(join(tmpdir(), "parallax-apply-wrapper-"));
    try {
      for (const contract of contracts) {
        const repositoryWrapperPath = resolve(repositoryRoot, "deploy", contract.wrapperName);
        const wrapperSource = await readFile(repositoryWrapperPath, "utf8");
        expect(wrapperSource.replaceAll("\r\n", "\n").trimEnd()).toBe(
          expectedWrapperSource(contract.childName),
        );
        expect(wrapperSource).not.toContain("PARALLAX_PRODUCTION_ENTRYPOINT_COMPLETE");

        const wrapperPath = join(fakeRoot, contract.wrapperName);
        const childPath = join(fakeRoot, contract.childName);
        await writeFile(wrapperPath, wrapperSource, "utf8");
        await writeFile(childPath, childStub, "utf8");
        const runWrapper = async (
          mode: "success" | "throw" | "exit",
          extraArguments: readonly string[] = [],
        ) => {
          try {
            const result = await execFileAsync(
              "powershell.exe",
              ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapperPath, ...extraArguments],
              {
                cwd: repositoryRoot,
                env: {
                  ...process.env,
                  PARALLAX_APPLY_WRAPPER_TEST_MARKER: contract.completionMarker,
                  PARALLAX_APPLY_WRAPPER_TEST_MODE: mode,
                },
                timeout: 15_000,
                windowsHide: true,
              },
            );
            return { code: 0, stderr: result.stderr, stdout: result.stdout };
          } catch (error: unknown) {
            const failure = error as Readonly<{
              code?: number | string;
              stderr?: string;
              stdout?: string;
            }>;
            return {
              code: failure.code,
              stderr: failure.stderr ?? "",
              stdout: failure.stdout ?? "",
            };
          }
        };

        const success = await runWrapper("success");
        if (success.code !== 0) {
          throw new Error(
            `Apply wrapper ${contract.wrapperName} failed its inert child contract:\n` +
              `stdout=${success.stdout}\nstderr=${success.stderr}`,
          );
        }
        expect(success.code).toBe(0);
        expect(success.stderr).toBe("");
        const successLines = success.stdout.trim().split(/\r?\n/);
        expect(successLines).toHaveLength(2);
        const binding = JSON.parse(successLines[0] ?? "") as Readonly<{
          ArgumentCount: number;
          BoundParameterNames: readonly string[];
          ChildPath: string;
          ConfirmIsPresent: boolean;
          ConfirmType: string;
          DeployIsPresent: boolean;
          DeployType: string;
        }>;
        expect(binding).toEqual({
          ArgumentCount: 0,
          BoundParameterNames: ["Confirm", "Deploy"],
          ChildPath: resolve(childPath),
          ConfirmIsPresent: false,
          ConfirmType: "System.Management.Automation.SwitchParameter",
          DeployIsPresent: true,
          DeployType: "System.Management.Automation.SwitchParameter",
        });
        expect(successLines[1]).toBe(contract.completionMarker);

        const thrown = await runWrapper("throw");
        expect(thrown.code).not.toBe(0);
        expect(`${thrown.stdout}\n${thrown.stderr}`).toContain("PARALLAX_APPLY_CHILD_THROW");

        const exited = await runWrapper("exit");
        expect(exited.code).toBe(37);

        const targeted = await runWrapper("success", ["-RemoteHost", "attacker"]);
        expect(targeted.code).not.toBe(0);
        expect(`${targeted.stdout}\n${targeted.stderr}`).toMatch(
          /parameter cannot be\s+found.*RemoteHost/is,
        );
        expect(targeted.stdout).not.toContain(contract.completionMarker);
      }
    } finally {
      await rm(fakeRoot, { force: true, recursive: true });
    }
  }, 30_000);

  it("routes pinned pnpm preview/apply commands to exact PowerShell arguments", async () => {
    const fakeRoot = await mkdtemp(join(tmpdir(), "parallax-pnpm-deploy-"));
    const capturePath = join(fakeRoot, "arguments.txt");
    const fakePowerShell = join(fakeRoot, "powershell.cmd");
    await writeFile(
      fakePowerShell,
      [
        "@echo off",
        '> "%PARALLAX_DEPLOY_ARGUMENT_CAPTURE%" echo %*',
        "echo PARALLAX_TEST_ONLY_PNPM_POWERSHELL_SHIM",
        "",
      ].join("\r\n"),
      "utf8",
    );
    const environment = {
      ...process.env,
      PARALLAX_DEPLOY_ARGUMENT_CAPTURE: capturePath,
      PATH: `${fakeRoot};${process.env.PATH ?? ""}`,
    };
    const runPnpmScript = async (
      script:
        | "deploy:model-content"
        | "deploy:model-content:apply"
        | "deploy:production"
        | "deploy:production:apply",
    ) => {
      try {
        return await execFileAsync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `pnpm.cmd --config.engine-strict=false run ${script}`],
          {
            cwd: repositoryRoot,
            env: environment,
            timeout: 15_000,
            windowsHide: true,
          },
        );
      } catch (error: unknown) {
        const output = error as Readonly<{ stderr?: string; stdout?: string }>;
        throw new Error(
          `Mocked pnpm ${script} failed:\nstdout=${output.stdout ?? ""}\nstderr=${output.stderr ?? ""}`,
          { cause: error },
        );
      }
    };
    try {
      const pnpmVersion = await execFileAsync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", "pnpm.cmd --version"],
        { cwd: repositoryRoot, env: environment, timeout: 15_000, windowsHide: true },
      );
      expect(pnpmVersion.stdout.trim()).toBe("11.12.0");

      const preview = await runPnpmScript("deploy:production");
      expect(preview.stdout).toContain("PARALLAX_TEST_ONLY_PNPM_POWERSHELL_SHIM");
      expect((await readFile(capturePath, "utf8")).trim()).toBe(
        "-NoProfile -File deploy/Deploy-Production.ps1",
      );

      const apply = await runPnpmScript("deploy:production:apply");
      expect(apply.stdout).toContain("PARALLAX_TEST_ONLY_PNPM_POWERSHELL_SHIM");
      const applyArguments = (await readFile(capturePath, "utf8")).trim();
      expect(applyArguments).toBe("-NoProfile -File deploy/Deploy-Production-Apply.ps1");
      expect(applyArguments).not.toContain(" -- ");
      expect(applyArguments).not.toMatch(/-Deploy|-Confirm|plex|\/var\/www/i);

      const modelPreview = await runPnpmScript("deploy:model-content");
      expect(modelPreview.stdout).toContain("PARALLAX_TEST_ONLY_PNPM_POWERSHELL_SHIM");
      expect((await readFile(capturePath, "utf8")).trim()).toBe(
        "-NoProfile -File deploy/Deploy-Model-Content.ps1",
      );

      const modelApply = await runPnpmScript("deploy:model-content:apply");
      expect(modelApply.stdout).toContain("PARALLAX_TEST_ONLY_PNPM_POWERSHELL_SHIM");
      const modelApplyArguments = (await readFile(capturePath, "utf8")).trim();
      expect(modelApplyArguments).toBe("-NoProfile -File deploy/Deploy-Model-Content-Apply.ps1");
      expect(modelApplyArguments).not.toContain(" -- ");
      expect(modelApplyArguments).not.toMatch(/-Deploy|-Confirm|plex|\/var\/www/i);
    } finally {
      await rm(fakeRoot, { force: true, recursive: true });
    }
  });

  it("binds model-content v2 to logical identity without a committed host directory", async () => {
    const contract = JSON.parse(
      await readFile(resolve(repositoryRoot, "deploy/model-content.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(contract.schemaVersion).toBe(2);
    expect(contract.source).toEqual({
      id: "gemma-4-E2B-it-qat-GGUF-66a399f6",
      registryKey: "production-model-content",
    });
    expect(contract).not.toHaveProperty("localDirectory");
  });

  it("exercises deployment orchestration plus an executed fail-closed mount guard", async () => {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(repositoryRoot, "deploy/Deploy-Production.Tests.ps1"),
      ],
      { cwd: repositoryRoot, timeout: 30_000, windowsHide: true },
    );
    expect(result.stdout).toContain("Deploy-Production behavior tests: PASS");
  }, 30_000);

  it("runs the destructive model-content uploader safety suite in the unit gate", async () => {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(repositoryRoot, "deploy/Deploy-Model-Content.Tests.ps1"),
      ],
      { cwd: repositoryRoot, timeout: 15_000, windowsHide: true },
    );
    expect(result.stdout).toContain("Deploy-Model-Content behavior tests: PASS");
  }, 15_000);

  it("resolves model content only through the bounded machine-local registry contract", async () => {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve(repositoryRoot, "deploy/Resolve-ModelContentSource.Tests.ps1"),
      ],
      { cwd: repositoryRoot, timeout: 15_000, windowsHide: true },
    );
    expect(result.stdout).toContain("Resolve-ModelContentSource behavior tests: PASS");
  }, 15_000);

  it("keeps committed deployment, result, and documentation contracts free of user paths", async () => {
    const paths = [
      "deploy/model-content.json",
      "deploy/Deploy-Production.ps1",
      "deploy/Deploy-Production-Apply.ps1",
      "deploy/Deploy-Model-Content.ps1",
      "deploy/Deploy-Model-Content-Apply.ps1",
      "deploy/README.md",
      "docs/decisions.md",
      "harness/src/model-source-verification-run.ts",
      "harness/src/model-source-verification-result.ts",
    ];
    const documents = await Promise.all(
      paths.map(async (path) => readFile(resolve(repositoryRoot, path), "utf8")),
    );
    expect(documents.join("\n")).not.toMatch(/[A-Za-z]:\\Users\\[^\\\s]+/i);
  });

  it("declares nginx rollback ordering for test and reload failure", async () => {
    const installer = await readFile(
      resolve(repositoryRoot, "deploy/Install-Nginx-Production.sh"),
      "utf8",
    );
    expect(installer).toContain('cp -p -- "$active" "$backup"');
    expect(installer).toContain("trap cleanup EXIT");
    expect(installer).toContain("set +e");
    expect(installer).toContain("restore_active");
    expect(installer).toContain("nginx -t");
    expect(installer).toContain("systemctl reload nginx");
    expect(installer.indexOf("nginx -t")).toBeLessThan(installer.indexOf("systemctl reload nginx"));
    expect(installer.indexOf("installed=1")).toBeLessThan(installer.indexOf("install -o root"));
    expect(installer).toContain('rm -f -- "$backup"');
    expect(installer).not.toContain('rm -f -- "$candidate"');
    expect(installer).toContain(
      "prior nginx include restoration failed; manual intervention required",
    );
    expect(installer).toContain("internal nginx backup retained at $backup");
    expect(installer).toContain("caller-owned candidate retained at $candidate");
  });

  it("documents exclusive-root and retained-lock recovery contracts", async () => {
    const readme = await readFile(resolve(repositoryRoot, "deploy/README.md"), "utf8");
    expect(readme).toContain("webroot is exclusively owned by Parallax deployment");
    expect(readme).toContain("ACME HTTP-01 challenge files");
    expect(readme).toContain("Recover a retained deployment lock");
    expect(readme).toContain("never overwrite a final object");
    expect(readme).toContain("retain the 0700 root and lock");
  });
});
