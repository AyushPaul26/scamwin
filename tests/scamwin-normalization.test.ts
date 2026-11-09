import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRegistryHostname, registryIndicatorId } from "../lib/scamwin/registry-normalization";

test("registry normalization preserves exact-host scope and converts IDNA", () => {
  for (const [input, expected] of [
    ["EXAMPLE.COM.", "example.com"],
    ["WWW.Example.com", "www.example.com"],
    ["refund.login.example.com", "refund.login.example.com"],
    ["BÜCHER.de", "xn--bcher-kva.de"],
  ]) assert.equal(normalizeRegistryHostname(input), expected);
  assert.notEqual(registryIndicatorId("www.example.com"), registryIndicatorId("example.com"));
});

test("registry rejects URL components, ambiguous syntax and nonpublic hosts", () => {
  for (const input of ["", " example.com", "example.com ", "https://example.com", "user@example.com", "example.com:443", "example.com/", "example.com?q=1", "example.com#x", "example%2ecom", "example\\com", "example..com", "example.com..", "-bad.com", "bad-.com", "_sip.example.com", "localhost", "a.localhost", "a.local", "a.internal", "a.test", "a.invalid", "127.0.0.1", "2130706433", "[::1]", "a." + "b".repeat(64), "a.".repeat(127) + "com", "example.com\n"]) {
    assert.throws(() => normalizeRegistryHostname(input), /bare public hostname/, input);
  }
});

test("registry hashes ABI encoding with version and indicator type, not packed encoding", () => {
  // Frozen cross-client vector also asserted against Solidity indicatorId in web3 tests.
  assert.equal(registryIndicatorId("EXAMPLE.COM."), "0x1b675ce2f38ca4f8b5b9d102255153525e41c8cb2e44c37928a9dd75098294ab");
});

test("registry rejects numeric/hyphen-only top-level labels just as Solidity does", () => {
  assert.throws(() => normalizeRegistryHostname("example.12-3"), /bare public hostname/);
});
