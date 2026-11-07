"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Exercise application startup and event handlers without a real browser.
function createApp({ hidden = false, unavailableStorage = false } = {}) {
    const preferences = new Map(hidden ? [["smsviewer.privacyNotice.v1.dismissed", "true"]] : []);
    const nodes = new Map();
    function node() {
        const handlers = new Map();
        return {
            value: "", checked: false, textContent: "", hidden: false,
            addEventListener(type, callback, options) {
                const list = handlers.get(type) || [];
                list.push({ callback, once: options?.once }); handlers.set(type, list);
            },
            emit(type) {
                const list = handlers.get(type) || [];
                handlers.set(type, list.filter((entry) => !entry.once));
                list.forEach((entry) => entry.callback({}));
            },
            setAttribute() {}, appendChild() {}, replaceChildren() {},
        };
    }
    const document = {
        getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
        createElement: node, createDocumentFragment: node, documentElement: node(),
    };
    const modalShows = [];
    let opens = 0;
    const DB = {
        async openDatabase() { opens++; },
        async getSetting() { return "US"; },
        async getActiveImport() { return null; },
        async clearImportData() {},
    };
    const context = {
        window: { SMSViewerCore: { getCountryOptions: () => [], inferCountryFromLocale: () => "US", formatNumber: String }, SMSBackupStreamParser: {}, SMSViewerDB: DB },
        document, navigator: { language: "en-US" },
        localStorage: {
            getItem(key) { if (unavailableStorage) throw Error("Blocked"); return preferences.get(key) ?? null; },
            setItem(key, value) { if (unavailableStorage) throw Error("Blocked"); preferences.set(key, value); },
        },
        bootstrap: { Modal: class {
            constructor(element) { this.element = element; }
            show() { modalShows.push(this.element); }
            hide() { this.element.emit("hidden.bs.modal"); }
        } },
        console, setTimeout, clearTimeout,
    };
    vm.createContext(context);
    const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
    vm.runInContext(source.slice(0, source.lastIndexOf("\ninitialize().catch")), context);
    return { context, nodes, preferences, modalShows, get opens() { return opens; } };
}

test("startup notice blocks restoration until acknowledged and repeats without opt-out", async () => {
    const app = createApp();
    const ready = app.context.initialize();
    assert.equal(app.opens, 0);
    assert.equal(app.modalShows[0], app.nodes.get("privacy-modal"));
    app.nodes.get("privacy-continue").emit("click");
    await ready;
    assert.equal(app.opens, 1);
    assert.equal(app.preferences.get("smsviewer.privacyNotice.v1.dismissed"), "false");
});

test("opt-out is saved explicitly and an existing opt-out skips the startup modal", async () => {
    const app = createApp();
    const ready = app.context.initialize();
    app.nodes.get("hide-privacy-notice").checked = true;
    app.nodes.get("privacy-continue").emit("click");
    await ready;
    assert.equal(app.preferences.get("smsviewer.privacyNotice.v1.dismissed"), "true");
    const next = createApp({ hidden: true });
    await next.context.initialize();
    assert.equal(next.modalShows.length, 0);
    assert.equal(next.opens, 1);
});

test("main-page notice can be reopened and opt-out revoked", async () => {
    const app = createApp({ hidden: true });
    await app.context.initialize();
    app.nodes.get("privacy-info").emit("click");
    assert.equal(app.nodes.get("hide-privacy-notice").checked, true);
    app.nodes.get("hide-privacy-notice").checked = false;
    app.nodes.get("privacy-continue").emit("click");
    assert.equal(app.preferences.get("smsviewer.privacyNotice.v1.dismissed"), "false");
    assert.equal(app.nodes.get("clear-local-data").disabled, false);
});

test("unavailable preference storage does not prevent acknowledging the notice", async () => {
    const app = createApp({ unavailableStorage: true });
    const ready = app.context.initialize();
    app.nodes.get("privacy-continue").emit("click");
    await ready;
    assert.equal(app.opens, 1);
});

test("deletion invalidates pending page results so deleted messages cannot reappear", async () => {
    const app = createApp({ hidden: true });
    await app.context.initialize();
    let resolvePage;
    app.context.window.SMSViewerDB.getMessagePage = () => new Promise((resolve) => { resolvePage = resolve; });
    vm.runInContext('state.activeImport = { id: "active" }; state.selectedContact = { messageCount: 1, contactKey: "Alice" }; Core.getDisplayName = () => "Alice";', app.context);
    const loading = app.context.loadConversationPage(0);
    await app.context.clearLocalMessageIndex();
    // Any call here would mean stale content was rendered after deletion.
    app.context.renderMessages = () => { throw Error("Deleted messages rendered again"); };
    resolvePage([{ body: "Sensitive message" }]);
    await loading;
});
