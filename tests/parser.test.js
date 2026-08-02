"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
require("../core.js");
const Parser = require("../stream-parser.js");

function parseInChunks(xml, chunkSize) {
    const records = [];
    let root = null;
    const parser = Parser.createParser({
        onRoot(value) { root = value; },
        onRecord(value) { records.push(value); },
    });
    for (let offset = 0; offset < xml.length; offset += chunkSize) {
        parser.write(xml.slice(offset, offset + chunkSize));
    }
    const summary = parser.finish();
    return { records, root, summary };
}

test("parses SMS records split across arbitrary chunks", () => {
    const xml = `<?xml version="1.0"?><smses count="2">
        <sms address="+49 176 1234567" date="2" readable_date="Later" body="A &amp; B" type="2" contact_name="Alice" />
        <sms address="0176 1234567" date="1" body="Earlier" type="1" contact_name="(Unknown)" />
    </smses>`;
    const result = parseInChunks(xml, 7);
    assert.equal(result.root.count, 2);
    assert.equal(result.summary.recordCount, 2);
    assert.equal(result.records[0].body, "A & B");
    assert.equal(result.records[1].kind, "sms");
});

test("parses MMS text and retains base64 media attachment data", () => {
    const data = "A".repeat(1024 * 1024);
    const xml = `<smses count="1"><mms date="1000" msg_box="1" address="+121****0123" contact_name="Bob">
        <parts>
            <part seq="0" ct="text/plain" text="Hello from MMS" />
            <part seq="1" ct="image/jpeg" name="photo.jpg" data="${data}" />
        </parts>
        <addrs><addr address="+121****0123" type="137" /></addrs>
    </mms></smses>`;
    const result = parseInChunks(xml, 4093);
    const record = result.records[0];
    assert.equal(record.kind, "mms");
    assert.equal(record.body, "Hello from MMS");
    assert.equal(record.attachments.length, 1);
    assert.equal(record.attachments[0].name, "photo.jpg");
    assert.equal(record.attachments[0].data, data);
    assert.equal(record.attachments[0].encodedBytes, data.length);
});

test("derives an MMS address from addr elements when the top-level address is absent", () => {
    const xml = `<smses count="1"><mms date="1000" msg_box="1"><parts><part ct="text/plain" text="Hi" /></parts><addrs><addr address="insert-address-token" type="151"/><addr address="+442079460018" type="137"/></addrs></mms></smses>`;
    const result = parseInChunks(xml, 5);
    assert.equal(result.records[0].addressRaw, "+442079460018");
});

test("rejects unsupported or truncated XML", () => {
    assert.throws(() => parseInChunks("<calls><call /></calls>", 4), /supported SMS Backup/);
    assert.throws(() => parseInChunks("<smses><sms address=\"1\"", 3), /middle of a tag/);
    assert.throws(() => parseInChunks("<smses><sms address=\"1\" type=\"1\" />", 8), /root element was closed/);
});
