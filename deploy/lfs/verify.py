#!/usr/bin/env python3
"""Exercise a disposable candidate (never production), including a >2 GiB object."""
import base64
import hashlib
import http.client
import json
import pathlib
import ssl
import sys

scratch = pathlib.Path(sys.argv[1]).resolve()
assert scratch.name.startswith("lfs-qualification-")
# The disposable nginx uses a self-signed certificate. Production uses certbot.
context = ssl._create_unverified_context()
password = (scratch / "password").read_text().strip()
auth = "Basic " + base64.b64encode(f"pmeenan:{password}".encode()).decode()
base = "/api/qualification/test"


def connection(lan=False):
    return http.client.HTTPSConnection(
        "192.168.0.7" if lan else "127.0.0.1", 18443, context=context, timeout=120
    )


def request(method, path, body=None, headers=None, lan=False):
    client = connection(lan)
    client.request(method, path, body, headers or {})
    response = client.getresponse()
    result = response.status, dict(response.getheaders()), response.read()
    client.close()
    return result


payload = b"Parallax LFS qualification\n"
oid = hashlib.sha256(payload).hexdigest()
path = f"{base}/object/{oid}"
assert request("PUT", path, payload)[0] == 401
assert request("PUT", path, payload, {"X-Forwarded-For": "192.168.0.2", "CF-Connecting-IP": "192.168.0.2"})[0] == 401
assert request("PUT", path, payload, {"Authorization": "Basic YmFkOmJhZA=="})[0] == 401
assert request("GET", path)[0] == 404
assert request("DELETE", path, headers={"Authorization": auth})[0] == 405
assert request("PUT", path, payload, {"Authorization": auth})[0] == 200
status, headers, body = request("GET", path)
assert status == 200 and body == payload and "max-age=" in headers["Cache-Control"]
status, headers, body = request("HEAD", path)
assert status == 200 and int(headers["Content-Length"]) == len(payload) and not body
batch = json.dumps({"operation": "download", "objects": [{"oid": oid, "size": len(payload)}]})
status, headers, body = request("POST", f"{base}/objects/batch", batch, {
    "Content-Type": "application/vnd.git-lfs+json", "Host": "attacker.invalid",
    "X-Forwarded-Host": "attacker.invalid", "X-Forwarded-Proto": "http",
})
assert status == 200 and headers["Cache-Control"] == "no-store"
assert json.loads(body)["objects"][0]["actions"]["download"]["href"] == f"https://git-lfs.meenan.dev{path}"
assert request("POST", f"{base}/objects/batch", b"x" * (1024 * 1024 + 1))[0] == 413
assert request("PUT", path, b"wrong bytes", {"Authorization": auth})[0] >= 400
assert request("GET", path)[2] == payload
print("PASS: anonymous read, authenticated write, spoof rejection, bounded batch, fixed authority, hash mismatch preserves object", flush=True)

# LAN writer, streaming both directions; no multi-gigabyte client allocation.
size = 2 * 1024**3 + 17
chunk = b"lfs-test" * (1024 * 128)
digest = hashlib.sha256()
remaining = size
while remaining:
    part = chunk[:min(remaining, len(chunk))]
    digest.update(part)
    remaining -= len(part)
large_oid = digest.hexdigest()
large_path = f"{base}/object/{large_oid}"
client = connection(lan=True)
client.putrequest("PUT", large_path)
client.putheader("Content-Length", str(size))
client.endheaders()
remaining = size
while remaining:
    part = chunk[:min(remaining, len(chunk))]
    client.send(part)
    remaining -= len(part)
response = client.getresponse()
assert response.status == 200, (response.status, response.read())
response.read()
client.close()
client = connection()
client.request("GET", large_path)
response = client.getresponse()
assert response.status == 200 and int(response.getheader("Content-Length")) == size
received = 0
digest = hashlib.sha256()
while part := response.read(1024 * 1024):
    received += len(part)
    digest.update(part)
client.close()
assert received == size and digest.hexdigest() == large_oid
print(f"PASS: anonymous LAN upload and anonymous download: {size} bytes, SHA-256 {large_oid}", flush=True)
