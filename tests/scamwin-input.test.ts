import assert from "node:assert/strict";
import test from "node:test";
import { checkInputSchema, validatePreparedImage } from "../lib/scamwin/input";

const empty = { url: "", message: "", promisedBenefit: "", intendedAction: "", images: [] };
const png = { name: "offer.png", mediaType: "image/png" as const, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" };

test("intake supports message-only but rejects empty, unknown and excessive input", () => {
  assert.equal(checkInputSchema.parse({ ...empty, message: "Please pay a fee" }).message, "Please pay a fee");
  assert.equal(checkInputSchema.safeParse(empty).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "hello", ownerId: "forged" }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "a".repeat(12001) }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "a".repeat(8000), intendedAction: "b".repeat(4001) }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, images: Array(5).fill(png) }).success, false);
});

test("URL input accepts only a single credential-free public HTTP destination", () => {
  for (const url of ["https://example.org/refund", "http://example.org/"]) assert.equal(checkInputSchema.safeParse({ ...empty, url }).success, true);
  for (const url of ["file:///etc/passwd", "https://a:b@example.org/", "http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/", "https://example.org:3000/", "https://example.org/\nhttps://other.org/"]) assert.equal(checkInputSchema.safeParse({ ...empty, url }).success, false, url);
});

test("optional company and public reference fields preserve minimal input and enforce shared text limits", () => {
  assert.deepEqual(checkInputSchema.parse({ ...empty, message: "hello" }), { ...empty, message: "hello" });
  assert.equal(checkInputSchema.parse({ ...empty, claimedCompany: " Acme ", offerReference: " 12345 " }).offerReference, "12345");
  assert.equal(checkInputSchema.safeParse({ ...empty, offerReference: "https://acme.example/careers/jobs/42" }).success, true);
  assert.equal(checkInputSchema.safeParse({ ...empty, claimedCompany: "Acme" }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "hello", claimedCompany: "a".repeat(201) }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, offerReference: "a".repeat(4097) }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "a".repeat(11900), claimedCompany: "b".repeat(100) }).success, true);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "a".repeat(11900), claimedCompany: "b".repeat(101) }).success, false);
  assert.equal(checkInputSchema.safeParse({ ...empty, message: "a".repeat(11999), offerReference: "12" }).success, false);
});

test("prepared image type, signature, base64 and decoded byte cap are enforced", () => {
  assert.equal(validatePreparedImage(png).byteLength, 24);
  for (const image of [{ ...png, mediaType: "image/jpeg" }, { ...png, dataUrl: "data:image/png;base64,hello" }, { ...png, dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, { ...png, dataUrl: "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(160 * 1024)]).toString("base64") }]) assert.throws(() => validatePreparedImage(image));
});
