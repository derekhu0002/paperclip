import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normDir,
  routingLabelFor,
  filterUnhandled,
  opencodeBusySql,
  buildCarrierIssue,
} from "./poller.mjs";

test("normDir normalizes windows paths to forward slashes without trailing slash", () => {
  assert.equal(normDir("D:\\Projects\\my-army"), "D:/Projects/my-army");
  assert.equal(normDir("D:/Projects/my-army/"), "D:/Projects/my-army");
});

test("routingLabelFor uses the explicit label or the project suffix", () => {
  assert.equal(routingLabelFor({ project: "paperclip" }, "pm"), "pm:paperclip");
  assert.equal(routingLabelFor({ project: "paperclip", routingLabel: "custom:x" }, "pm"), "custom:x");
});

test("filterUnhandled drops issues already marked pm:done", () => {
  const issues = [
    { number: 1, labels: [{ name: "pm:paperclip" }] },
    { number: 2, labels: [{ name: "pm:paperclip" }, { name: "pm:done" }] },
    { number: 3, labels: [] },
  ];
  assert.deepEqual(filterUnhandled(issues, "pm:done").map((i) => i.number), [1, 3]);
});

test("opencodeBusySql targets the project dir and treats running tools / unfinished turns as busy", () => {
  const sql = opencodeBusySql("D:\\Projects\\my-army", 15);
  assert.match(sql, /lower\('D:\/Projects\/my-army'\)/);
  assert.match(sql, /900000/); // 15 minutes in ms
  assert.match(sql, /\$.state\.status.*running/);
  assert.match(sql, /\$.time\.completed.*IS NULL/);
});

test("buildCarrierIssue carries from/to project, repo and the GitHub reference", () => {
  const { title, description } = buildCarrierIssue(
    { project: "my-army", repo: "derekhu0002/my-army" },
    { number: 42, title: "Fix the thing", url: "https://github.com/derekhu0002/my-army/issues/42" },
  );
  assert.match(title, /from:my-army -> to:my-army/);
  assert.match(title, /#42/);
  assert.match(description, /to_project=my-army/);
  assert.match(description, /repo=derekhu0002\/my-army/);
  assert.match(description, /github_issue=#42/);
});
