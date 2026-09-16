import assert from "node:assert/strict";
import { Blob, File } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule(name, globals = {}) {
  const source = readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, URL, AbortController, Blob, File, DOMException, Error, Date,
    setTimeout, clearTimeout,
    ...globals,
  }, { filename: name });
  return exports;
}

const payload = {
  title: "A real visit",
  body: "Notes from the visit.",
  tags: ["local", "experience"],
  assets: ["https://images.example.test/store.jpg"],
};

function publisherHarness({ navigator = {}, fetch, document, decodeImage, Image, imageUrl } = {}) {
  const navigations = [], scheduled = [], cleared = [];
  let href = "https://taotian.example.test/campaign/";
  const location = {
    get href() { return href; },
    set href(value) { href = value; navigations.push(value); },
  };
  const module = loadModule("publishers.ts", {
    window: { location },
    navigator: { userAgent: "Mozilla/5.0 (iPhone)", ...navigator },
    document,
    createImageBitmap: decodeImage === null ? undefined : decodeImage || (async blob => {
      assert.ok(blob.size > 0);
      return { width: 1, height: 1, close() {} };
    }),
    Image,
    ...(imageUrl ? { URL: imageUrl } : {}),
    fetch: fetch || (() => { throw new Error("Unexpected fetch in a publish action"); }),
    setTimeout: (callback, delay) => {
      const id = scheduled.length + 1;
      scheduled.push({ id, callback, delay });
      return id;
    },
    clearTimeout: (id) => cleared.push(id),
  });
  return { module, navigations, scheduled, cleared };
}

function imageResponse({ type = "image/jpeg", size = 4, contentLength, status = 200 } = {}) {
  let remaining = size;
  return {
    ok: status >= 200 && status < 300,
    headers: { get: (name) => name === "content-length" ? contentLength ?? null : name === "content-type" ? type : null },
    body: new ReadableStream({
      pull(controller) {
        if (remaining === 0) { controller.close(); return; }
        const count = Math.min(remaining, 64 * 1024);
        controller.enqueue(new Uint8Array(count));
        remaining -= count;
      },
    }),
  };
}

function clipboardDocument({ copyResult = true, copyError } = {}) {
  const state = { added: [], removed: [], commands: [], selected: 0, focused: 0 };
  const document = {
    activeElement: { focus: () => { state.focused += 1; } },
    body: { appendChild: (element) => { state.added.push(element); } },
    createElement: (tag) => {
      assert.equal(tag, "textarea");
      const element = {
        style: {},
        value: "",
        select: () => { state.selected += 1; },
        remove: () => { state.removed.push(element); },
      };
      return element;
    },
    execCommand: (command) => {
      state.commands.push(command);
      if (copyError) throw copyError;
      return copyResult;
    },
  };
  return { document, state };
}

test("cancelling native share preserves cancellation without navigation or a relaunch timer", async () => {
  let shares = 0;
  const files = [new File(["image"], "photo.jpg", { type: "image/jpeg" })];
  const { module, navigations, scheduled } = publisherHarness({
    navigator: {
      canShare: () => true,
      share: async () => { shares += 1; throw new DOMException("Cancelled", "AbortError"); },
    },
  });
  const result = await new module.NativeSharePublisher(files).publish(payload);
  assert.equal(result.success, false);
  assert.equal(result.outcome, "cancelled");
  assert.equal(result.mode, "native-share");
  assert.equal(shares, 1);
  assert.deepEqual(navigations, []);
  assert.deepEqual(scheduled, []);
});

test("native share consumes prepared files and never fetches after publish begins", async () => {
  let fetches = 0, shareData;
  const { module, scheduled, cleared } = publisherHarness({
    fetch: async () => { fetches += 1; return imageResponse(); },
    navigator: {
      canShare: () => true,
      share: (data) => { shareData = data; return Promise.resolve(); },
    },
  });
  const files = await module.prepareShareFiles(payload.assets);
  assert.equal(fetches, 1);
  assert.equal(files[0].name, "taotian-1.jpeg");
  assert.equal(files[0].type, "image/jpeg");
  const pending = new module.NativeSharePublisher(files).publish(payload);
  assert.ok(shareData, "share() must be invoked synchronously before the first await");
  assert.equal(shareData.files, files);
  assert.equal(fetches, 1);
  assert.equal(shareData.text, "A real visit\n\nNotes from the visit.\n\n#local #experience");
  const result = await pending;
  assert.equal(result.outcome, "handed-off");
  assert.equal(scheduled.length, 1);
  assert.deepEqual(cleared, [scheduled[0].id]);
});

test("native share refuses missing media instead of attempting a text-only or deeplink fallback", async () => {
  let shares = 0;
  const { module, navigations, scheduled } = publisherHarness({
    navigator: { share: async () => { shares += 1; } },
  });
  const result = await new module.NativeSharePublisher().publish(payload);
  assert.equal(result.outcome, "failed");
  assert.equal(shares, 0);
  assert.deepEqual(navigations, []);
  assert.deepEqual(scheduled, []);
});

test("native capability failures and share errors do not automatically navigate", async () => {
  const scenarios = [
    {},
    { share: async () => { throw new Error("Network unavailable"); } },
    { share: async () => assert.fail("share should not run"), canShare: () => false },
  ];
  for (const navigator of scenarios) {
    const { module, navigations, scheduled } = publisherHarness({ navigator });
    const result = await new module.NativeSharePublisher().publish({ ...payload, assets: [] });
    assert.equal(result.outcome, "failed");
    assert.deepEqual(navigations, []);
    assert.deepEqual(scheduled, []);
  }
});

test("clipboard rejection falls back to selection copy and removes its temporary textarea", async () => {
  const { document, state } = clipboardDocument();
  const { module } = publisherHarness({
    document,
    navigator: { clipboard: { writeText: async () => { throw new Error("Permission denied"); } } },
  });
  const result = await new module.CopyPublisher().publish(payload);
  assert.equal(result.outcome, "copied");
  assert.equal(result.success, true);
  assert.deepEqual(state.commands, ["copy"]);
  assert.equal(state.selected, 1);
  assert.equal(state.added.length, 1);
  assert.equal(state.added[0].value, module.getFullShareText(payload));
  assert.equal(state.removed[0], state.added[0]);
  assert.equal(state.focused, 1);
});

test("clipboard fallback failure still cleans up and reports failure", async () => {
  for (const options of [{ copyResult: false }, { copyError: new Error("Copy blocked") }]) {
    const { document, state } = clipboardDocument(options);
    const { module } = publisherHarness({ document });
    const result = await new module.CopyPublisher().publish(payload);
    assert.equal(result.success, false);
    assert.equal(result.outcome, "failed");
    assert.equal(state.removed[0], state.added[0]);
    assert.equal(state.focused, 1);
  }
});

test("successful modern clipboard copy does not create fallback DOM", async () => {
  const { document, state } = clipboardDocument();
  let copied;
  const { module } = publisherHarness({
    document,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
  });
  const result = await new module.CopyPublisher().publish(payload);
  assert.equal(result.outcome, "copied");
  assert.equal(copied, module.getFullShareText(payload));
  assert.equal(state.added.length, 0);
});

test("media preparation rejects HTTP failures, network errors, invalid MIME, empty and oversized images", async (t) => {
  const scenarios = [
    ["HTTP error", () => imageResponse({ status: 404 })],
    ["network error", () => { throw new Error("Offline"); }],
    ["HTML response", () => imageResponse({ type: "text/html" })],
    ["GIF response", () => imageResponse({ type: "image/gif" })],
    ["empty image", () => imageResponse({ size: 0 })],
    ["large content length", () => imageResponse({ contentLength: String(20 * 1024 * 1024 + 1) })],
    ["large actual body", () => imageResponse({ size: 20 * 1024 * 1024 + 1 })],
  ];
  for (const [name, response] of scenarios) {
    await t.test(name, async () => {
      let requestSignal;
      const { module, scheduled, cleared } = publisherHarness({
        fetch: async (_url, options) => { requestSignal = options.signal; return response(); },
      });
      await assert.rejects(module.prepareShareFiles(payload.assets));
      assert.equal(requestSignal.aborted, true);
      assert.deepEqual(cleared, [scheduled[0].id]);
    });
  }
});

test("media preparation validates decoded dimensions and releases successful bitmaps", async () => {
  let decoded = 0, closed = 0;
  const { module } = publisherHarness({
    fetch: async () => imageResponse(),
    decodeImage: async blob => {
      decoded += 1;
      assert.equal(blob.type, "image/jpeg");
      assert.equal(blob.size, 4);
      return { width: 24, height: 16, close() { closed += 1; } };
    },
  });
  const files = await module.prepareShareFiles(payload.assets);
  assert.equal(files.length, 1);
  assert.equal(decoded, 1);
  assert.equal(closed, 1);
});

test("a JPEG content type does not make corrupt bytes a valid share image", async () => {
  let decodeCalls = 0;
  const { module } = publisherHarness({
    fetch: async () => new Response("this is not an image", { headers: { "content-type": "image/jpeg" } }),
    decodeImage: async blob => {
      decodeCalls += 1;
      assert.equal(await blob.text(), "this is not an image");
      throw new DOMException("The source image could not be decoded", "InvalidStateError");
    },
  });
  await assert.rejects(module.prepareShareFiles(payload.assets), /无法解码/);
  assert.equal(decodeCalls, 1);
});

test("zero-sized decoded images are rejected and their bitmap is closed", async () => {
  let closed = 0;
  const { module } = publisherHarness({
    fetch: async () => imageResponse(),
    decodeImage: async () => ({ width: 0, height: 1, close() { closed += 1; } }),
  });
  await assert.rejects(module.prepareShareFiles(payload.assets), /无法解码/);
  assert.equal(closed, 1);
});

test("chunked streams stop immediately above 20 MB without content-length", async () => {
  let delivered = 0, cancelled = false, decoded = false;
  const { module } = publisherHarness({
    fetch: async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: new ReadableStream({
        pull(controller) {
          delivered += 1;
          controller.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }),
      blob() { assert.fail("must never buffer the entire response"); },
    }),
    decodeImage: async () => { decoded = true; throw new Error("Unexpected decode"); },
  });
  await assert.rejects(module.prepareShareFiles(payload.assets), /20 MB/);
  assert.equal(delivered, 21);
  assert.equal(cancelled, true);
  assert.equal(decoded, false);
});

test("caller cancellation interrupts a pending stream reader and cancels the body", async () => {
  const controller = new AbortController();
  let streamStarted;
  const started = new Promise(resolve => { streamStarted = resolve; });
  let cancelled = false;
  const { module } = publisherHarness({
    fetch: async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: new ReadableStream({
        pull() { streamStarted(); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 }),
    }),
  });
  const pending = module.prepareShareFiles(payload.assets, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("cancelling or timing out image decode rejects promptly and closes any late bitmap", async () => {
  for (const mode of ["cancel", "timeout"]) {
    const controller = new AbortController();
    let resolveBitmap, decoderStarted;
    const started = new Promise(resolve => { decoderStarted = resolve; });
    let closed = 0;
    const { module, scheduled, cleared } = publisherHarness({
      fetch: async () => imageResponse(),
      decodeImage: () => {
        decoderStarted();
        return new Promise(resolve => { resolveBitmap = resolve; });
      },
    });
    const pending = module.prepareShareFiles(payload.assets, controller.signal);
    await started;
    if (mode === "cancel") controller.abort(); else scheduled[0].callback();
    await assert.rejects(pending, { name: "AbortError" });
    resolveBitmap({ width: 1, height: 1, close() { closed += 1; } });
    await Promise.resolve();
    assert.equal(closed, 1);
    assert.deepEqual(cleared, [scheduled[0].id]);
  }
});

test("image element fallback revokes its object URL on success, decode failure and cancellation", async () => {
  for (const outcome of ["success", "failure", "cancel"]) {
    const controller = new AbortController();
    let started, image;
    const ready = new Promise(resolve => { started = resolve; });
    const created = [], revoked = [], removed = [];
    class FakeImage {
      naturalWidth = 1;
      naturalHeight = 1;
      constructor() { image = this; }
      set src(value) { this.value = value; started(); }
      removeAttribute(name) { removed.push(name); }
    }
    class ImageURL extends URL {
      static createObjectURL(blob) { created.push(blob); return "blob:test-image"; }
      static revokeObjectURL(url) { revoked.push(url); }
    }
    const { module } = publisherHarness({
      fetch: async () => imageResponse(),
      decodeImage: null,
      Image: FakeImage,
      imageUrl: ImageURL,
    });
    const pending = module.prepareShareFiles(payload.assets, controller.signal);
    await ready;
    if (outcome === "success") {
      image.onload();
      assert.equal((await pending).length, 1);
    } else if (outcome === "failure") {
      image.onerror();
      await assert.rejects(pending, /无法解码/);
    } else {
      controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
    }
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, ["blob:test-image"]);
    assert.deepEqual(removed, ["src"]);
    assert.equal(image.onload, null);
    assert.equal(image.onerror, null);
  }
});

test("media preparation rejects unsafe URL schemes and more than eighteen assets without fetching", async () => {
  let fetched = 0;
  const { module } = publisherHarness({
    fetch: async () => { fetched += 1; return imageResponse(); },
  });
  for (const url of ["javascript:alert(1)", "file:///private.jpg", "data:image/png;base64,AAAA"]) {
    await assert.rejects(module.prepareShareFiles([url]));
  }
  await assert.rejects(module.prepareShareFiles(Array(19).fill(payload.assets[0])));
  assert.equal(fetched, 0);
});

test("media preparation honors pending and already-aborted caller signals", async () => {
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController();
    if (alreadyAborted) controller.abort();
    const { module, scheduled, cleared } = publisherHarness({
      fetch: (_url, options) => new Promise((_resolve, reject) => {
        const cancel = () => reject(new DOMException("Aborted", "AbortError"));
        if (options.signal.aborted) cancel();
        else options.signal.addEventListener("abort", cancel, { once: true });
      }),
    });
    const pending = module.prepareShareFiles(payload.assets, controller.signal);
    if (!alreadyAborted) controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.deepEqual(cleared, [scheduled[0].id]);
  }
});

test("media preparation times out stalled fetches and clears the timer", async () => {
  const { module, scheduled, cleared } = publisherHarness({
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const pending = module.prepareShareFiles(payload.assets);
  assert.equal(scheduled[0].delay, 15000);
  scheduled[0].callback();
  await assert.rejects(pending, { name: "AbortError" });
  assert.deepEqual(cleared, [scheduled[0].id]);
});

test("one failed media fetch aborts its pending siblings", async () => {
  let secondSignal;
  const { module } = publisherHarness({
    fetch: (url, options) => {
      if (url.endsWith("/failed.jpg")) return Promise.resolve(imageResponse({ status: 500 }));
      secondSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    },
  });
  await assert.rejects(module.prepareShareFiles(["https://images.example.test/failed.jpg", "https://images.example.test/pending.jpg"]));
  assert.equal(secondSignal.aborted, true);
});

test("mobile deeplinks report only a navigation request, not a confirmed publication", async () => {
  const { module, navigations, scheduled } = publisherHarness();
  const result = await new module.DeeplinkPublisher("note").publish(payload);
  assert.equal(result.outcome, "requested");
  assert.equal(result.mode, "deeplink");
  assert.deepEqual(navigations, ["xhsdiscover://post_note/"]);
  assert.deepEqual(scheduled, []);
  const desktop = publisherHarness({ navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0)" } });
  assert.equal((await new desktop.module.DeeplinkPublisher().publish(payload)).outcome, "failed");
  assert.deepEqual(desktop.navigations, []);
});

test("review links reject missing and hostile destinations without routing to another store", async () => {
  const scenarios = [
    ["meituan", undefined],
    ["dianping", "  "],
    ["meituan", "https://evilmeituan.com/shop/1"],
    ["meituan", "https://meituan.com.evil.test/shop/1"],
    ["meituan", "https://meituan.com@evil.test/shop/1"],
    ["meituan", "https://user:secret@meituan.com/shop/1"],
    ["meituan", "https://www.dianping.com/shop/1"],
    ["dianping", "https://www.meituan.com/shop/1"],
    ["dianping", "javascript:alert(1)"],
    ["dianping", "//www.dianping.com/shop/1"],
  ];
  for (const [platform, url] of scenarios) {
    const { module, navigations, scheduled } = publisherHarness();
    assert.throws(() => module.getReviewWebUrl(platform, url));
    await assert.rejects(module.openReviewAppFirst(platform, url));
    assert.deepEqual(navigations, []);
    assert.deepEqual(scheduled, []);
  }
});

test("review handoff uses exactly the configured approved store link", async () => {
  for (const [platform, url] of [
    ["meituan", "https://i.meituan.com/shop/123?campaign=taotian"],
    ["dianping", "https://m.dianping.com/shop/456"],
    ["dianping", "https://dpurl.cn/abc"],
  ]) {
    const { module, navigations, scheduled } = publisherHarness();
    const result = await module.openReviewAppFirst(platform, url);
    assert.equal(result.openedApp, false);
    assert.equal(result.fallback, url);
    assert.deepEqual(navigations, [url]);
    assert.deepEqual(scheduled, []);
  }
});

function stateHarness() {
  const values = new Map();
  let now = new Date("2026-09-16T02:00:00Z").getTime();
  class Clock extends Date { static now() { return now; } }
  const window = { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } };
  const module = loadModule("localState.ts", { window, Date: Clock });
  return { module, window, values, getNow: () => now, advance: (milliseconds) => { now += milliseconds; } };
}

function savedState(label = "A") {
  return {
    draft: {
      title: `Store ${label}`, body: `Visit to ${label}`, tags: ["local"],
      materialType: "image", style: "real_experience", cta: "Visit",
    },
    asset: {
      id: `asset-${label}`, type: "image", title: label, keywords: [],
      url: `https://images.example.test/${label}.jpg`, tone: "natural",
    },
    platform: "redbook",
  };
}

function assertEmpty(value) {
  assert.equal(value.draft, null);
  assert.equal(value.asset, null);
}

test("blocked localStorage reports failed saves and does not throw on load or clear", () => {
  const { module, window } = stateHarness();
  window.localStorage = {
    getItem() { throw new Error("Storage blocked"); },
    setItem() { throw new Error("Storage blocked"); },
    removeItem() { throw new Error("Storage blocked"); },
  };
  assert.equal(module.saveShareState(savedState(), "merchant-A"), false);
  assertEmpty(module.loadSavedShareState("merchant-A"));
  assert.doesNotThrow(() => module.clearShareState("merchant-A"));
});

test("saved drafts are isolated by merchant scope, including encoded scope names", () => {
  const { module } = stateHarness();
  assert.equal(module.saveShareState(savedState("A"), "merchant/A"), true);
  assert.equal(module.saveShareState(savedState("B"), "merchant%2FA"), true);
  assert.equal(module.loadSavedShareState("merchant/A").draft.title, "Store A");
  assert.equal(module.loadSavedShareState("merchant%2FA").draft.title, "Store B");
  assertEmpty(module.loadSavedShareState("unrelated"));
  assertEmpty(module.loadSavedShareState());
  module.clearShareState("merchant/A");
  assertEmpty(module.loadSavedShareState("merchant/A"));
  assert.equal(module.loadSavedShareState("merchant%2FA").draft.title, "Store B");
});

test("partial state updates retain only the same merchant's current draft", () => {
  const { module } = stateHarness();
  module.saveShareState(savedState("A"), "merchant-A");
  module.saveShareState(savedState("B"), "merchant-B");
  module.saveShareState({ platform: "meituan" }, "merchant-A");
  assert.equal(module.loadSavedShareState("merchant-A").draft.title, "Store A");
  assert.equal(module.loadSavedShareState("merchant-A").platform, "meituan");
  assert.equal(module.loadSavedShareState("merchant-B").platform, "redbook");
});

test("saved drafts expire after twenty-four hours", () => {
  const { module, advance } = stateHarness();
  module.saveShareState(savedState(), "merchant");
  advance(24 * 60 * 60 * 1000 - 1);
  assert.equal(module.loadSavedShareState("merchant").draft.title, "Store A");
  advance(2);
  assertEmpty(module.loadSavedShareState("merchant"));
});

test("malformed JSON and malformed draft fields are not restored", () => {
  const { module, values, getNow } = stateHarness();
  const key = "taotian-share-state:merchant";
  for (const raw of ["{bad", "null", "[]", "42"]) {
    values.set(key, raw);
    assertEmpty(module.loadSavedShareState("merchant"));
  }
  for (const patch of [
    { savedAt: undefined },
    { draft: null },
    { draft: { title: 42, body: "body", tags: [] } },
    { draft: { title: "title", body: "body", tags: ["valid", 3] } },
    { asset: { url: 42 } },
    { platform: "unknown-platform" },
  ]) {
    values.set(key, JSON.stringify({ ...savedState(), savedAt: getNow(), ...patch }));
    assertEmpty(module.loadSavedShareState("merchant"));
  }
});

test("malformed or future savedAt values cannot bypass draft expiry", () => {
  const { module, values, getNow } = stateHarness();
  for (const savedAt of ["not-a-number", String(getNow()), {}, getNow() + 24 * 60 * 60 * 1000]) {
    values.set("taotian-share-state:merchant", JSON.stringify({ ...savedState(), savedAt }));
    assertEmpty(module.loadSavedShareState("merchant"));
  }
});
