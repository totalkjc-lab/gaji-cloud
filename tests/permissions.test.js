const test = require("node:test");
const assert = require("node:assert/strict");
const { isOwner } = require("../permissions.js");

test("same id is owner", () => {
  assert.equal(isOwner("u1", "u1"), true);
});
test("different id is not owner", () => {
  assert.equal(isOwner("u1", "u2"), false);
});
test("missing current user is not owner", () => {
  assert.equal(isOwner(null, "u2"), false);
  assert.equal(isOwner(undefined, "u2"), false);
});
test("missing folder owner is not owner", () => {
  assert.equal(isOwner("u1", null), false);
});
