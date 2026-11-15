import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceFiles = [
  "uni-app-xhs/src/activityConfig.ts",
  "uni-app-xhs/src/pages/index/index.vue",
  "uni-app-xhs/src/static/mock-assets/activity-poster.svg",
  "uni-app-xhs/src/utils/localState.ts",
  "uni-app-xhs/src/utils/publishers.ts",
  "uni-app-xhs/src/utils/qwen.ts",
];

const source = sourceFiles
  .map((file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8"))
  .join("\n");

test("Xiaohongshu miniapp removes incentivized publishing and client-side model secrets", () => {
  for (const riskyText of ["发布后领奖", "领取奖励", "分享奖励", "现场核销", "VITE_DASHSCOPE_API_KEY", "dashscope.aliyuncs.com"]) {
    assert.doesNotMatch(source, new RegExp(riskyText), riskyText);
  }
});

test("Xiaohongshu miniapp labels AI-assisted content and gates the official publisher", () => {
  assert.match(source, /AI 辅助整理/);
  assert.match(source, /确认内容基于本人真实经历/);
  assert.match(source, /v-if="canPublish"[\s\S]*post-note-button|post-note-button[\s\S]*v-if="canPublish"/);
  assert.match(source, /hasDraftPlaceholder/);
});
