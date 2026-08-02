"use strict";

(function exposeStreamParser(globalScope, factory) {
    const core = globalScope.SMSViewerCore || (typeof require === "function" ? require("./core.js") : null);
    const api = factory(core);
    globalScope.SMSBackupStreamParser = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof window !== "undefined" ? window : globalThis, function createStreamParser(Core) {
    if (!Core) {
        throw new Error("SMSViewerCore is required before stream-parser.js.");
    }

    const RELEVANT_TAGS = new Set(["smses", "sms", "mms", "part", "addr"]);

    class BackupXMLTokenizer {
        constructor({ onRecord = () => {}, onRoot = () => {}, captureMediaData = true } = {}) {
            this.onRecord = onRecord;
            this.onRoot = onRoot;
            this.captureMediaData = captureMediaData;
            this.state = "TEXT";
            this.tagName = "";
            this.endTagName = "";
            this.attrs = Object.create(null);
            this.attrName = "";
            this.attrValue = "";
            this.quote = "";
            this.skipAttributeValue = false;
            this.skippedAttributeLength = 0;
            this.currentMMS = null;
            this.rootSeen = false;
            this.rootClosed = false;
            this.recordCount = 0;
            this.position = 0;
        }

        write(chunk) {
            const text = String(chunk || "");
            let index = 0;

            while (index < text.length) {
                switch (this.state) {
                    case "TEXT": {
                        const nextTag = text.indexOf("<", index);
                        if (nextTag === -1) {
                            this.position += text.length - index;
                            return;
                        }
                        this.position += nextTag - index + 1;
                        index = nextTag + 1;
                        this.state = "TAG_OPEN";
                        break;
                    }

                    case "TAG_OPEN": {
                        const char = text[index];
                        index += 1;
                        this.position += 1;
                        if (char === "/") {
                            this.endTagName = "";
                            this.state = "END_TAG_NAME";
                        } else if (char === "?" || char === "!") {
                            this.state = "SKIP_MARKUP";
                        } else if (/\s/.test(char)) {
                            // Ignore stray whitespace after '<'.
                        } else {
                            this.tagName = char;
                            this.attrs = Object.create(null);
                            this.state = "TAG_NAME";
                        }
                        break;
                    }

                    case "SKIP_MARKUP": {
                        const close = text.indexOf(">", index);
                        if (close === -1) {
                            this.position += text.length - index;
                            return;
                        }
                        this.position += close - index + 1;
                        index = close + 1;
                        this.state = "TEXT";
                        break;
                    }

                    case "TAG_NAME": {
                        const char = text[index];
                        if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                            this.state = "BETWEEN_ATTRS";
                        } else if (char === ">") {
                            index += 1;
                            this.position += 1;
                            this.emitStartTag(false);
                            this.state = "TEXT";
                        } else if (char === "/") {
                            index += 1;
                            this.position += 1;
                            this.state = "SELF_CLOSE";
                        } else {
                            this.tagName += char;
                            index += 1;
                            this.position += 1;
                        }
                        break;
                    }

                    case "BETWEEN_ATTRS": {
                        const char = text[index];
                        if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                        } else if (char === ">") {
                            index += 1;
                            this.position += 1;
                            this.emitStartTag(false);
                            this.state = "TEXT";
                        } else if (char === "/") {
                            index += 1;
                            this.position += 1;
                            this.state = "SELF_CLOSE";
                        } else {
                            this.attrName = char;
                            this.attrValue = "";
                            this.skipAttributeValue = false;
                            this.skippedAttributeLength = 0;
                            index += 1;
                            this.position += 1;
                            this.state = "ATTR_NAME";
                        }
                        break;
                    }

                    case "ATTR_NAME": {
                        const char = text[index];
                        if (char === "=") {
                            index += 1;
                            this.position += 1;
                            this.state = "BEFORE_ATTR_VALUE";
                        } else if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                            this.state = "AFTER_ATTR_NAME";
                        } else if (char === "/" || char === ">") {
                            this.commitAttribute();
                            this.state = "BETWEEN_ATTRS";
                        } else {
                            this.attrName += char;
                            index += 1;
                            this.position += 1;
                        }
                        break;
                    }

                    case "AFTER_ATTR_NAME": {
                        const char = text[index];
                        if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                        } else if (char === "=") {
                            index += 1;
                            this.position += 1;
                            this.state = "BEFORE_ATTR_VALUE";
                        } else {
                            this.commitAttribute();
                            this.state = "BETWEEN_ATTRS";
                        }
                        break;
                    }

                    case "BEFORE_ATTR_VALUE": {
                        const char = text[index];
                        if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                        } else if (char === '"' || char === "'") {
                            this.quote = char;
                            // Skip base64 data when media capture is disabled (fast import mode).
                            // When enabled, the payload is needed to render inline images and video.
                            this.skipAttributeValue = this.tagName.toLowerCase() === "part"
                                && this.attrName.toLowerCase() === "data"
                                && !this.captureMediaData;
                            index += 1;
                            this.position += 1;
                            this.state = "ATTR_VALUE";
                        } else {
                            // The upstream format uses quoted XML attributes. Keep a defensive unquoted mode.
                            this.quote = "";
                            this.attrValue = char;
                            index += 1;
                            this.position += 1;
                            this.state = "ATTR_VALUE_UNQUOTED";
                        }
                        break;
                    }

                    case "ATTR_VALUE": {
                        const close = text.indexOf(this.quote, index);
                        if (close === -1) {
                            const length = text.length - index;
                            if (this.skipAttributeValue) {
                                this.skippedAttributeLength += length;
                            } else {
                                this.attrValue += text.slice(index);
                            }
                            this.position += length;
                            return;
                        }

                        if (this.skipAttributeValue) {
                            this.skippedAttributeLength += close - index;
                        } else {
                            this.attrValue += text.slice(index, close);
                        }
                        this.position += close - index + 1;
                        index = close + 1;
                        this.commitAttribute();
                        this.state = "BETWEEN_ATTRS";
                        break;
                    }

                    case "ATTR_VALUE_UNQUOTED": {
                        const char = text[index];
                        if (/\s/.test(char) || char === "/" || char === ">") {
                            this.commitAttribute();
                            this.state = "BETWEEN_ATTRS";
                        } else {
                            this.attrValue += char;
                            index += 1;
                            this.position += 1;
                        }
                        break;
                    }

                    case "SELF_CLOSE": {
                        const char = text[index];
                        if (/\s/.test(char)) {
                            index += 1;
                            this.position += 1;
                        } else if (char === ">") {
                            index += 1;
                            this.position += 1;
                            this.emitStartTag(true);
                            this.state = "TEXT";
                        } else {
                            throw new Error(`Malformed XML near byte ${this.position}.`);
                        }
                        break;
                    }

                    case "END_TAG_NAME": {
                        const char = text[index];
                        if (char === ">") {
                            index += 1;
                            this.position += 1;
                            this.emitEndTag(this.endTagName.trim().toLowerCase());
                            this.endTagName = "";
                            this.state = "TEXT";
                        } else {
                            this.endTagName += char;
                            index += 1;
                            this.position += 1;
                        }
                        break;
                    }

                    default:
                        throw new Error(`Unknown parser state: ${this.state}`);
                }
            }
        }

        finish() {
            if (this.state !== "TEXT") {
                throw new Error("The XML file ended in the middle of a tag, declaration, or attribute.");
            }
            if (this.currentMMS) {
                throw new Error("The XML file ended before an MMS record was closed.");
            }
            if (!this.rootSeen) {
                throw new Error("This is not a supported SMS Backup & Restore message backup.");
            }
            if (!this.rootClosed) {
                throw new Error("The XML file ended before the <smses> root element was closed.");
            }
            if (this.recordCount === 0) {
                throw new Error("No SMS or MMS records were found in this backup.");
            }
            return { recordCount: this.recordCount };
        }

        commitAttribute() {
            const name = this.attrName.trim();
            if (name && RELEVANT_TAGS.has(this.tagName.toLowerCase())) {
                if (this.skipAttributeValue) {
                    this.attrs[name] = null;
                    this.attrs.__dataLength = this.skippedAttributeLength;
                } else {
                    this.attrs[name] = Core.decodeXMLEntities(this.attrValue);
                }
            }
            this.attrName = "";
            this.attrValue = "";
            this.quote = "";
            this.skipAttributeValue = false;
            this.skippedAttributeLength = 0;
        }

        emitStartTag(selfClosing) {
            const name = this.tagName.trim().toLowerCase();
            const attrs = this.attrs;
            this.tagName = "";
            this.attrs = Object.create(null);

            if (name === "smses") {
                this.rootSeen = true;
                this.onRoot({ count: Number.parseInt(attrs.count || "", 10) || null });
                return;
            }

            if (!this.rootSeen && (name === "sms" || name === "mms")) {
                throw new Error("The XML file is missing the expected <smses> root element.");
            }

            if (name === "sms") {
                this.recordCount += 1;
                this.onRecord(this.buildSMSRecord(attrs));
                return;
            }

            if (name === "mms") {
                this.currentMMS = {
                    attrs,
                    textParts: [],
                    attachments: [],
                    addresses: [],
                };
                if (selfClosing) {
                    this.finishMMS();
                }
                return;
            }

            if (name === "part" && this.currentMMS) {
                const contentType = String(attrs.ct || "").toLowerCase();
                const text = attrs.text && attrs.text !== "null" ? attrs.text : "";
                if (contentType === "text/plain" && text) {
                    this.currentMMS.textParts.push({ sequence: Number.parseInt(attrs.seq || "0", 10) || 0, text });
                } else if (contentType && contentType !== "application/smil") {
                    const fallbackName = this.partNameFallback(attrs, contentType);
                    this.currentMMS.attachments.push({
                        contentType,
                        name: fallbackName,
                        contentLocation: this.firstUsable(attrs.cl, null) || fallbackName,
                        data: attrs.data || null,
                        encodedBytes: (attrs.data && attrs.data.length) || attrs.__dataLength || 0,
                    });
                }
                return;
            }

            if (name === "addr" && this.currentMMS) {
                this.currentMMS.addresses.push({
                    address: attrs.address || null,
                    type: attrs.type || null,
                });
            }
        }

        emitEndTag(name) {
            if (name === "mms") {
                this.finishMMS();
            }
            if (name === "smses") {
                this.rootClosed = true;
            }
        }

        finishMMS() {
            if (!this.currentMMS) return;
            const mms = this.currentMMS;
            this.currentMMS = null;
            mms.textParts.sort((left, right) => left.sequence - right.sequence);
            this.recordCount += 1;
            this.onRecord(this.buildMMSRecord(mms));
        }

        buildSMSRecord(attrs) {
            return {
                kind: "sms",
                addressRaw: attrs.address || null,
                contactNameRaw: attrs.contact_name || null,
                timestampRaw: attrs.date || null,
                readableDate: attrs.readable_date || "",
                body: attrs.body || "",
                type: attrs.type || "",
                attachments: [],
            };
        }

        buildMMSRecord(mms) {
            const attrs = mms.attrs;
            return {
                kind: "mms",
                addressRaw: this.resolveMMSAddress(attrs, mms.addresses),
                participantAddresses: mms.addresses.map((entry) => entry.address).filter(Boolean),
                contactNameRaw: attrs.contact_name || null,
                timestampRaw: attrs.date || null,
                readableDate: attrs.readable_date || "",
                body: mms.textParts.map((part) => part.text).join("\n").trim(),
                type: attrs.msg_box || attrs.box || "",
                attachments: mms.attachments,
            };
        }

        resolveMMSAddress(attrs, addresses) {
            const direct = this.firstUsable(attrs.address, attrs.from_address, null);
            if (direct) return direct;

            const box = String(attrs.msg_box || attrs.box || "");
            const preferredType = box === "1" ? "137" : box === "2" ? "151" : null;
            const preferred = preferredType
                ? addresses.find((entry) => String(entry.type) === preferredType && this.isUsable(entry.address))
                : null;
            if (preferred) return preferred.address;

            const fallback = addresses.find((entry) => this.isUsable(entry.address));
            return fallback?.address || null;
        }

        firstUsable(...values) {
            return values.find((value) => this.isUsable(value)) || null;
        }

        isUsable(value) {
            const text = String(value || "").trim();
            return Boolean(text && !["null", "undefined", "insert-address-token"].includes(text.toLowerCase()));
        }

        partNameFallback(attrs, contentType) {
            const usable = this.firstUsable(attrs.name, attrs.fn, attrs.cl);
            if (usable) return usable;

            // Build a descriptive fallback from content type and sequence number.
            const suffixMap = {
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/gif": ".gif",
                "image/webp": ".webp",
                "image/heic": ".heic",
                "image/heif": ".heif",
                "image/bmp": ".bmp",
                "video/mp4": ".mp4",
                "video/3gpp": ".3gp",
                "video/mpeg": ".mpeg",
                "video/quicktime": ".mov",
                "audio/amr": ".amr",
                "audio/aac": ".aac",
                "audio/mpeg": ".mp3",
                "audio/mp4": ".m4a",
                "audio/vnd.qcelp": ".qcp",
                "audio/3gpp": ".3ga",
                "audio/ogg": ".ogg",
            };
            const suffix = suffixMap[contentType] || "";
            const seq = Number.parseInt(attrs.seq || "0", 10) || 0;
            const base = contentType ? contentType.replace("/", "_") : "attachment";
            return `${base}${seq ? `_${seq}` : ""}${suffix}`;
        }
    }

    function createParser(options) {
        return new BackupXMLTokenizer(options);
    }

    return { BackupXMLTokenizer, createParser };
});
