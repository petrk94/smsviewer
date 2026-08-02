"use strict";

const Core = window.SMSViewerCore;
const StreamParser = window.SMSBackupStreamParser;
const DB = window.SMSViewerDB;

if (!Core || !StreamParser || !DB) {
    throw new Error("SMS Viewer could not load its local application modules.");
}

const ACTIVE_IMPORT_ID = "active";
const PAGE_SIZE = 200;
const CONTACT_RENDER_LIMIT = 500;
const DATABASE_BATCH_SIZE = 500;
const EXPORT_BATCH_SIZE = 1000;
const FALLBACK_EXPORT_MESSAGE_LIMIT = 100000;
const PDF_MESSAGE_LIMIT = 5000;

const state = {
    defaultCountry: null,
    activeImport: null,
    contacts: [],
    contactMap: new Map(),
    selectedContact: null,
    pageIndex: 0,
    importing: false,
    cancelRequested: false,
    pendingFile: null,
    searchToken: 0,
};

const elements = {
    uploadArea: document.getElementById("upload-area"),
    fileInput: document.getElementById("file-input"),
    captureMediaCheckbox: document.getElementById("capture-media"),
    importModeDescription: document.getElementById("import-mode-description"),
    status: document.getElementById("status-message"),
    progressPanel: document.getElementById("import-progress-panel"),
    progressTitle: document.getElementById("import-progress-title"),
    progressDetails: document.getElementById("import-progress-details"),
    progressBar: document.getElementById("import-progress-bar"),
    cancelImport: document.getElementById("cancel-import"),
    contactSearch: document.getElementById("contact-search"),
    contactFilter: document.getElementById("contact-filter"),
    contactList: document.getElementById("contact-list"),
    contactCount: document.getElementById("contact-count"),
    contactLimitNote: document.getElementById("contact-limit-note"),
    conversationTitle: document.getElementById("conversation-title"),
    conversationSummary: document.getElementById("conversation-summary"),
    conversationSearch: document.getElementById("conversation-search"),
    clearConversationSearch: document.getElementById("clear-conversation-search"),
    searchResultSummary: document.getElementById("search-result-summary"),
    chatWindow: document.getElementById("chat-window"),
    pagination: document.getElementById("conversation-pagination"),
    pageFirst: document.getElementById("page-first"),
    pagePrevious: document.getElementById("page-previous"),
    pageNext: document.getElementById("page-next"),
    pageLast: document.getElementById("page-last"),
    pageLabel: document.getElementById("page-label"),
    settingsButton: document.getElementById("settings-button"),
    themeToggle: document.getElementById("theme-toggle"),
    countryModal: document.getElementById("country-modal"),
    countrySelect: document.getElementById("country-select"),
    saveCountry: document.getElementById("save-country"),
    clearLocalData: document.getElementById("clear-local-data"),
    exportMenuButton: document.getElementById("export-menu-button"),
    exportCSV: document.getElementById("export-csv"),
    exportJSON: document.getElementById("export-json"),
    exportPDF: document.getElementById("export-pdf"),
    printWindow: document.getElementById("print-window"),
};

let countryModal = null;
let conversationSearchTimer = null;

class ImportCancelledError extends Error {
    constructor() {
        super("Import cancelled.");
        this.name = "ImportCancelledError";
    }
}

function readLocalPreference(key) {
    try {
        return localStorage.getItem(key);
    } catch (_error) {
        return null;
    }
}

function writeLocalPreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (_error) {
        // Preferences remain available for the current tab.
    }
}

function showStatus(message, type = "info") {
    elements.status.textContent = message;
    elements.status.className = `alert alert-${type} py-2 status-line no-print`;
    elements.status.hidden = false;
}

function clearStatus() {
    elements.status.textContent = "";
    elements.status.hidden = true;
}

function setEmptyConversation(message = "Select a contact to view messages.") {
    elements.chatWindow.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    elements.chatWindow.appendChild(empty);
}

function setImportingUI(importing) {
    state.importing = importing;
    elements.uploadArea.setAttribute("aria-disabled", String(importing));
    elements.fileInput.disabled = importing;
    elements.captureMediaCheckbox.disabled = importing;
    elements.cancelImport.disabled = !importing;
    elements.progressPanel.hidden = !importing;
    elements.settingsButton.disabled = importing;
    updateControlStates();
}

function updateControlStates() {
    const hasImport = Boolean(state.activeImport?.status === "complete");
    const hasSelection = Boolean(state.selectedContact);
    const disabledByImport = state.importing;

    elements.contactSearch.disabled = !hasImport || disabledByImport;
    elements.contactFilter.disabled = !hasImport || disabledByImport;
    elements.conversationSearch.disabled = !hasSelection || disabledByImport;
    elements.clearConversationSearch.disabled = !hasSelection || disabledByImport;
    elements.exportMenuButton.disabled = !hasImport || disabledByImport;
    elements.exportPDF.disabled = !hasSelection || disabledByImport;
    elements.printWindow.disabled = !hasSelection || disabledByImport;
    elements.clearLocalData.disabled = !hasImport || disabledByImport;
}

function updateProgress(bytesRead, totalBytes, details) {
    const percentage = totalBytes > 0 ? Math.min(100, Math.floor((bytesRead / totalBytes) * 100)) : 0;
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressBar.textContent = `${percentage}%`;
    elements.progressBar.parentElement?.setAttribute("aria-valuenow", String(percentage));
    elements.progressDetails.textContent = details;
}

function populateCountryOptions() {
    const options = Core.getCountryOptions("en");
    const fragment = document.createDocumentFragment();
    options.forEach((country) => {
        const option = document.createElement("option");
        option.value = country.code;
        option.textContent = `${country.name} (+${country.callingCode})`;
        fragment.appendChild(option);
    });
    elements.countrySelect.replaceChildren(fragment);

    const inferred = Core.inferCountryFromLocale(navigator.language) || "US";
    elements.countrySelect.value = inferred;
}

function showCountrySettings() {
    if (state.defaultCountry) elements.countrySelect.value = state.defaultCountry;
    countryModal.show();
}

async function saveCountrySetting() {
    const nextCountry = Core.normalizeCountry(elements.countrySelect.value);
    if (!nextCountry) {
        showStatus("Please choose a valid default country.", "danger");
        return;
    }

    const changed = Boolean(state.defaultCountry && state.defaultCountry !== nextCountry);
    state.defaultCountry = nextCountry;
    await DB.setSetting("defaultCountry", nextCountry);
    countryModal.hide();

    if (changed && state.activeImport) {
        showStatus(
            "The default country was changed. Re-import the backup to re-normalize local phone numbers in the existing index.",
            "warning"
        );
    }

    if (state.pendingFile) {
        const file = state.pendingFile;
        state.pendingFile = null;
        await importBackup(file);
    }
}

function initializeTheme() {
    const stored = readLocalPreference("theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const theme = stored || (prefersDark ? "dark" : "light");
    applyTheme(theme);
}

function applyTheme(theme) {
    const normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-bs-theme", normalized);
    elements.themeToggle.textContent = normalized === "dark" ? "Light mode" : "Dark mode";
    elements.themeToggle.setAttribute("aria-pressed", String(normalized === "dark"));
    writeLocalPreference("theme", normalized);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute("data-bs-theme");
    applyTheme(current === "dark" ? "light" : "dark");
}

function isLikelyBackupFile(file) {
    if (!file) return false;
    const extensionMatches = file.name?.toLowerCase().endsWith(".xml");
    const mimeMatches = ["", "text/xml", "application/xml", "text/plain"].includes(file.type);
    return Boolean(extensionMatches || mimeMatches);
}

async function chooseFile(file) {
    clearStatus();
    if (!isLikelyBackupFile(file)) {
        showStatus("Please select an XML backup created by SMS Backup & Restore.", "danger");
        return;
    }
    if (!state.defaultCountry) {
        state.pendingFile = file;
        showCountrySettings();
        return;
    }
    await importBackup(file);
}

async function detectEncoding(file) {
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (header[0] === 0xff && header[1] === 0xfe) return "utf-16le";
    if (header[0] === 0xfe && header[1] === 0xff) return "utf-16be";
    return "utf-8";
}

function prepareRecord(rawRecord, sequence, importId, country) {
    let contactKey = Core.normalizePhoneNumber(rawRecord.addressRaw, country);

    if (!contactKey && rawRecord.kind === "mms") {
        const participants = [...new Set(
            (rawRecord.participantAddresses || [])
                .map((address) => Core.normalizePhoneNumber(address, country))
                .filter(Boolean)
        )].sort();
        if (participants.length === 1) contactKey = participants[0];
        if (participants.length > 1) contactKey = `group:${participants.join("|")}`;
    }

    if (!contactKey) return null;

    const parsedTimestamp = Number.parseInt(rawRecord.timestampRaw || "", 10);
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : null;
    const timestampSort = timestamp ?? sequence;
    const attachments = (rawRecord.attachments || []).map((attachment) => ({
        contentType: attachment.contentType || "application/octet-stream",
        name: attachment.name || "Attachment",
        contentLocation: attachment.contentLocation || null,
        data: attachment.data || null,
        encodedBytes: Number(attachment.encodedBytes) || 0,
    }));

    return {
        contactKey,
        contactName: Core.normalizeContactName(rawRecord.contactNameRaw),
        message: {
            importId,
            sequence,
            contactKey,
            timestamp,
            timestampSort,
            readableDate: rawRecord.readableDate || "",
            body: rawRecord.body || "",
            type: rawRecord.type || "",
            direction: Core.classifyMessageType(rawRecord.type, rawRecord.kind),
            kind: rawRecord.kind,
            attachmentCount: attachments.length,
            attachments,
        },
    };
}

function updateContactSummary(contactMap, prepared, importId) {
    const existing = contactMap.get(prepared.contactKey);
    const message = prepared.message;
    if (!existing) {
        const name = prepared.contactName;
        contactMap.set(prepared.contactKey, {
            importId,
            contactKey: prepared.contactKey,
            displayAddress: prepared.contactKey.startsWith("group:")
                ? prepared.contactKey.slice(6).split("|").join(", ")
                : prepared.contactKey,
            name,
            sortName: (name || prepared.contactKey).toLocaleLowerCase(),
            messageCount: 1,
            mmsCount: message.kind === "mms" ? 1 : 0,
            firstTimestamp: message.timestamp,
            lastTimestamp: message.timestamp,
        });
        return;
    }

    if (!existing.name && prepared.contactName) {
        existing.name = prepared.contactName;
        existing.sortName = prepared.contactName.toLocaleLowerCase();
    }
    existing.messageCount += 1;
    if (message.kind === "mms") existing.mmsCount += 1;
    if (message.timestamp !== null) {
        existing.firstTimestamp = existing.firstTimestamp === null
            ? message.timestamp
            : Math.min(existing.firstTimestamp, message.timestamp);
        existing.lastTimestamp = existing.lastTimestamp === null
            ? message.timestamp
            : Math.max(existing.lastTimestamp, message.timestamp);
    }
}

async function maybeRequestPersistentStorage(fileSize) {
    if (!navigator.storage) return;
    try {
        if (fileSize >= 100 * 1024 * 1024 && navigator.storage.persist) {
            await navigator.storage.persist();
        }
        const estimate = await navigator.storage.estimate?.();
        if (estimate?.quota && estimate?.usage) {
            const available = estimate.quota - estimate.usage;
            if (available < 50 * 1024 * 1024) {
                showStatus("Browser storage is nearly full. The import may fail until local site data is cleared.", "warning");
            }
        }
    } catch (_error) {
        // Storage estimates are advisory and not available in every context.
    }
}

async function importBackup(file) {
    if (state.importing) return;

    state.cancelRequested = false;
    setImportingUI(true);
    clearStatus();
    elements.progressTitle.textContent = `Processing ${file.name}`;
    updateProgress(0, file.size, `Preparing ${Core.formatBytes(file.size)} backup…`);

    const metadata = {
        id: ACTIVE_IMPORT_ID,
        fileName: file.name,
        fileSize: file.size,
        defaultCountry: state.defaultCountry,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: "importing",
        expectedRecords: null,
        recordCount: 0,
        smsCount: 0,
        mmsCount: 0,
        skippedCount: 0,
        contactCount: 0,
        messageCount: 0,
    };

    let reader = null;
    try {
        await maybeRequestPersistentStorage(file.size);
        await DB.beginImport(metadata);

        const encoding = await detectEncoding(file);
        const decoder = new TextDecoder(encoding, { fatal: false });
        const contactMap = new Map();
        let messageBatch = [];
        let sequence = 0;
        let bytesRead = 0;
        let lastYieldAt = performance.now();

        const parser = StreamParser.createParser({
            captureMediaData: elements.captureMediaCheckbox.checked,
            onRoot(root) {
                metadata.expectedRecords = root.count;
            },
            onRecord(rawRecord) {
                const prepared = prepareRecord(rawRecord, sequence, ACTIVE_IMPORT_ID, state.defaultCountry);
                sequence += 1;
                metadata.recordCount += 1;
                if (rawRecord.kind === "mms") metadata.mmsCount += 1;
                else metadata.smsCount += 1;

                if (!prepared) {
                    metadata.skippedCount += 1;
                    return;
                }

                updateContactSummary(contactMap, prepared, ACTIVE_IMPORT_ID);
                messageBatch.push(prepared.message);
            },
        });

        reader = file.stream().getReader();
        while (true) {
            if (state.cancelRequested) {
                await reader.cancel();
                throw new ImportCancelledError();
            }

            const { value, done } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            parser.write(decoder.decode(value, { stream: true }));

            if (messageBatch.length >= DATABASE_BATCH_SIZE) {
                await DB.putMessages(messageBatch);
                messageBatch = [];
            }

            updateProgress(
                bytesRead,
                file.size,
                `${Core.formatNumber(metadata.recordCount)} records · ${Core.formatNumber(contactMap.size)} contacts · ${Core.formatBytes(bytesRead)} read`
            );

            if (performance.now() - lastYieldAt > 50) {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                lastYieldAt = performance.now();
            }
        }

        parser.write(decoder.decode());
        parser.finish();
        if (messageBatch.length) await DB.putMessages(messageBatch);

        const contacts = [...contactMap.values()];
        for (let offset = 0; offset < contacts.length; offset += DATABASE_BATCH_SIZE) {
            await DB.putContacts(contacts.slice(offset, offset + DATABASE_BATCH_SIZE));
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        metadata.messageCount = metadata.recordCount - metadata.skippedCount;
        metadata.status = "complete";
        metadata.completedAt = new Date().toISOString();
        metadata.contactCount = contacts.length;
        await DB.updateImport(metadata);

        state.activeImport = metadata;
        state.selectedContact = null;
        await loadContacts();
        setEmptyConversation();
        elements.conversationTitle.textContent = "Conversation";
        elements.conversationSummary.textContent = "";
        elements.pagination.hidden = true;
        elements.searchResultSummary.hidden = true;

        const expectedWarning = metadata.expectedRecords && metadata.expectedRecords !== metadata.recordCount
            ? ` The file declared ${Core.formatNumber(metadata.expectedRecords)} records.`
            : "";
        const skippedWarning = metadata.skippedCount
            ? ` ${Core.formatNumber(metadata.skippedCount)} record(s) without a usable address were skipped.`
            : "";
        showStatus(
            `Imported ${Core.formatNumber(metadata.recordCount)} records from ${Core.formatNumber(metadata.contactCount)} contacts.${skippedWarning}${expectedWarning}`,
            "success"
        );
        updateProgress(file.size, file.size, "Import complete.");
    } catch (error) {
        console.error(error);
        await DB.clearImportData().catch(() => {});
        state.activeImport = null;
        state.contacts = [];
        state.contactMap.clear();
        state.selectedContact = null;
        renderContacts();
        setEmptyConversation();

        if (error instanceof ImportCancelledError) {
            showStatus("Import cancelled. Partial local data was removed.", "warning");
        } else {
            showStatus(error instanceof Error ? error.message : "The backup could not be imported.", "danger");
        }
    } finally {
        reader?.releaseLock?.();
        setImportingUI(false);
        elements.fileInput.value = "";
    }
}

async function loadContacts() {
    state.contacts = state.activeImport ? await DB.getContacts(state.activeImport.id) : [];
    state.contactMap = new Map(state.contacts.map((contact) => [contact.contactKey, contact]));
    renderContacts();
    updateControlStates();
}

function getFilteredContacts() {
    const searchTerm = elements.contactSearch.value.trim().toLocaleLowerCase();
    const filter = elements.contactFilter.value;

    return state.contacts.filter((contact) => {
        if (filter === "named" && !contact.name) return false;
        if (filter === "unknown" && contact.name) return false;
        if (filter === "mms" && !contact.mmsCount) return false;
        if (!searchTerm) return true;
        return `${Core.getDisplayName(contact)} ${contact.displayAddress}`.toLocaleLowerCase().includes(searchTerm);
    });
}

function renderContacts() {
    const filtered = getFilteredContacts();
    const visible = filtered.slice(0, CONTACT_RENDER_LIMIT);
    elements.contactList.replaceChildren();
    elements.contactCount.textContent = String(filtered.length);

    if (!state.activeImport) {
        const empty = document.createElement("div");
        empty.className = "empty-state p-3";
        empty.textContent = "Import a backup to view contacts.";
        elements.contactList.appendChild(empty);
    } else if (!visible.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state p-3";
        empty.textContent = "No contacts match the current search and filter.";
        elements.contactList.appendChild(empty);
    } else {
        const fragment = document.createDocumentFragment();
        visible.forEach((contact) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "list-group-item list-group-item-action text-start";
            button.dataset.contactKey = contact.contactKey;
            button.classList.toggle("active", state.selectedContact?.contactKey === contact.contactKey);
            button.setAttribute("aria-current", state.selectedContact?.contactKey === contact.contactKey ? "true" : "false");

            const top = document.createElement("div");
            top.className = "d-flex justify-content-between align-items-start gap-2";
            const name = document.createElement("strong");
            name.className = "text-truncate";
            name.textContent = Core.getDisplayName(contact);
            const count = document.createElement("span");
            count.className = "badge text-bg-secondary rounded-pill";
            count.textContent = Core.formatNumber(contact.messageCount);
            top.append(name, count);

            const address = document.createElement("div");
            address.className = "small text-body-secondary text-truncate";
            address.textContent = contact.displayAddress;

            const meta = document.createElement("div");
            meta.className = "contact-meta mt-1";
            meta.textContent = contact.mmsCount
                ? `${Core.formatNumber(contact.mmsCount)} MMS · ${Core.formatNumber(contact.messageCount)} total`
                : `${Core.formatNumber(contact.messageCount)} SMS`;

            button.append(top, address, meta);
            fragment.appendChild(button);
        });
        elements.contactList.appendChild(fragment);
    }

    elements.contactLimitNote.hidden = filtered.length <= CONTACT_RENDER_LIMIT;
    if (filtered.length > CONTACT_RENDER_LIMIT) {
        elements.contactLimitNote.textContent = `Showing the first ${Core.formatNumber(CONTACT_RENDER_LIMIT)} contacts. Use search to narrow the list.`;
    }
}

async function selectContact(contactKey) {
    const contact = state.contactMap.get(contactKey);
    if (!contact) return;

    state.selectedContact = contact;
    state.pageIndex = Math.max(0, Math.ceil(contact.messageCount / PAGE_SIZE) - 1);
    state.searchToken += 1;
    elements.conversationSearch.value = "";
    elements.searchResultSummary.hidden = true;
    renderContacts();
    updateControlStates();
    await loadConversationPage(state.pageIndex, true);
}

function formatMessageDate(message) {
    if (message.readableDate) return message.readableDate;
    if (message.timestamp) return new Date(message.timestamp).toLocaleString("en");
    return "Date unavailable";
}

function renderMessages(messages, { scrollToBottom = false } = {}) {
    elements.chatWindow.replaceChildren();
    if (!messages.length) {
        setEmptyConversation("No messages found in this view.");
        return;
    }

    const fragment = document.createDocumentFragment();
    messages.forEach((message) => {
        const row = document.createElement("div");
        row.className = `message-row d-flex mb-2 ${message.direction}`;
        row.classList.add(
            message.direction === "received"
                ? "justify-content-start"
                : message.direction === "sent"
                  ? "justify-content-end"
                  : "justify-content-center"
        );

        const card = document.createElement("article");
        card.className = "card";

        const body = document.createElement("div");
        body.className = "card-body py-2 px-3";

        const badges = document.createElement("div");
        badges.className = "d-flex gap-1 mb-1";
        const kindBadge = document.createElement("span");
        kindBadge.className = `badge message-kind ${message.kind === "mms" ? "text-bg-warning" : "text-bg-secondary"}`;
        kindBadge.textContent = message.kind.toUpperCase();
        badges.appendChild(kindBadge);

        if (message.attachmentCount) {
            const attachmentBadge = document.createElement("span");
            attachmentBadge.className = "badge message-kind text-bg-info";
            attachmentBadge.textContent = `${message.attachmentCount} attachment${message.attachmentCount === 1 ? "" : "s"}`;
            badges.appendChild(attachmentBadge);
        }

        const text = document.createElement("div");
        text.textContent = message.body || (message.attachmentCount ? "MMS with attachments" : "Empty message");
        body.append(badges, text);

        if (message.attachments?.length) {
            const list = document.createElement("div");
            list.className = "attachment-list text-body-secondary";
            message.attachments.forEach((attachment) => {
                const mediaType = String(attachment.contentType || "");
                const isImage = mediaType.startsWith("image/");
                const isVideo = mediaType.startsWith("video/");
                const isAudio = mediaType.startsWith("audio/");

                if ((isImage || isVideo || isAudio) && attachment.data) {
                    const wrapper = document.createElement("div");
                    wrapper.className = "media-attachment mb-1";
                    const dataUri = `data:${attachment.contentType};base64,${attachment.data}`;

                    if (isImage) {
                        const container = document.createElement("div");
                        container.className = "position-relative d-inline-block";

                        const img = document.createElement("img");
                        img.src = dataUri;
                        img.alt = attachment.name || "Image attachment";
                        img.className = "img-fluid rounded";
                        img.style.maxHeight = "400px";
                        img.loading = "lazy";
                        container.appendChild(img);

                        // HEIC and other unsupported formats fail silently in most browsers.
                        // Replace the broken image with a download link so the user can open
                        // it in a native viewer (e.g. iOS/macOS Photos for HEIC).
                        img.onerror = () => {
                            const placeholder = document.createElement("div");
                            placeholder.className = "bg-light border rounded p-3 text-center";

                            const icon = document.createElement("div");
                            icon.className = "mb-2";
                            icon.textContent = `🖼 ${attachment.name || attachment.contentType}`;
                            placeholder.appendChild(icon);

                            const msg = document.createElement("small");
                            msg.className = "text-muted";
                            const dl = document.createElement("a");
                            dl.href = dataUri;
                            dl.download = attachment.name || "attachment";
                            dl.textContent = "Download";
                            msg.append(
                                `Your browser cannot display ${attachment.contentType} images. `,
                                dl
                            );
                            placeholder.appendChild(msg);

                            container.replaceChild(placeholder, img);
                        };

                        wrapper.appendChild(container);
                    } else if (isVideo) {
                        const video = document.createElement("video");
                        video.src = dataUri;
                        video.className = "img-fluid rounded";
                        video.style.maxHeight = "400px";
                        video.controls = true;
                        video.preload = "metadata";
                        wrapper.appendChild(video);
                    } else if (isAudio) {
                        const audio = document.createElement("audio");
                        audio.src = dataUri;
                        audio.controls = true;
                        audio.preload = "metadata";
                        audio.style.width = "100%";
                        audio.style.maxWidth = "320px";
                        audio.onerror = () => {
                            const placeholder = document.createElement("div");
                            placeholder.className = "bg-light border rounded p-3 text-center";
                            const icon = document.createElement("div");
                            icon.className = "mb-2";
                            icon.textContent = `🎵 ${attachment.name || attachment.contentType}`;
                            placeholder.appendChild(icon);
                            const msg = document.createElement("small");
                            msg.className = "text-muted";
                            const dl = document.createElement("a");
                            dl.href = dataUri;
                            dl.download = attachment.name || "attachment";
                            dl.textContent = "Download";
                            msg.append(
                                `Your browser cannot play ${attachment.contentType}. `,
                                dl
                            );
                            placeholder.appendChild(msg);
                            wrapper.replaceChild(placeholder, audio);
                        };
                        wrapper.appendChild(audio);
                    }

                    // Always show a download link + the attachment name below the media.
                    const label = document.createElement("div");
                    label.className = "small text-body-secondary mt-1";
                    const dl = document.createElement("a");
                    dl.href = dataUri;
                    dl.download = attachment.name || "attachment";
                    dl.textContent = "Download";
                    label.append(`${attachment.name || attachment.contentType} · `, dl);
                    wrapper.appendChild(label);
                    list.appendChild(wrapper);
                } else {
                    const item = document.createElement("div");
                    const approximateBytes = Math.floor((attachment.encodedBytes || 0) * 0.75);
                    const label = `${attachment.name} · ${attachment.contentType}${approximateBytes ? ` · about ${Core.formatBytes(approximateBytes)}` : ""}`;
                    item.textContent = label;

                    if (attachment.data) {
                        const dataUri = `data:${attachment.contentType};base64,${attachment.data}`;
                        const dl = document.createElement("a");
                        dl.href = dataUri;
                        dl.download = attachment.name || "attachment";
                        dl.textContent = "Download";
                        dl.className = "ms-2";
                        item.append(" · ", dl);
                    }
                    list.appendChild(item);
                }
            });
            body.appendChild(list);
        }

        const footer = document.createElement("footer");
        footer.className = "card-footer message-meta text-body-secondary py-1 px-3";
        footer.textContent = `${Core.getMessageStatus(message.type, message.kind)} · ${formatMessageDate(message)}`;

        card.append(body, footer);
        row.appendChild(card);
        fragment.appendChild(row);
    });
    elements.chatWindow.appendChild(fragment);

    if (scrollToBottom) elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
    else elements.chatWindow.scrollTop = 0;
}

async function loadConversationPage(pageIndex, scrollToBottom = false) {
    if (!state.selectedContact || !state.activeImport) return;
    const total = state.selectedContact.messageCount;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.pageIndex = Math.max(0, Math.min(pageIndex, pageCount - 1));
    const offset = state.pageIndex * PAGE_SIZE;

    elements.conversationTitle.textContent = `${Core.getDisplayName(state.selectedContact)} · ${state.selectedContact.displayAddress}`;
    elements.conversationSummary.textContent = `${Core.formatNumber(total)} messages${state.selectedContact.mmsCount ? ` · ${Core.formatNumber(state.selectedContact.mmsCount)} MMS` : ""}`;
    setEmptyConversation("Loading messages…");

    const messages = await DB.getMessagePage(state.activeImport.id, state.selectedContact.contactKey, offset, PAGE_SIZE);
    renderMessages(messages, { scrollToBottom });

    const start = total ? offset + 1 : 0;
    const end = Math.min(total, offset + messages.length);
    elements.pageLabel.textContent = `Messages ${Core.formatNumber(start)}–${Core.formatNumber(end)} of ${Core.formatNumber(total)}`;
    elements.pagination.hidden = total <= PAGE_SIZE;
    elements.pageFirst.disabled = state.pageIndex === 0;
    elements.pagePrevious.disabled = state.pageIndex === 0;
    elements.pageNext.disabled = state.pageIndex >= pageCount - 1;
    elements.pageLast.disabled = state.pageIndex >= pageCount - 1;
}

async function searchConversation() {
    const term = elements.conversationSearch.value.trim();
    const token = ++state.searchToken;

    if (!state.selectedContact || !state.activeImport) return;
    if (!term) {
        elements.searchResultSummary.hidden = true;
        await loadConversationPage(state.pageIndex);
        return;
    }
    if (term.length < 2) {
        elements.searchResultSummary.hidden = false;
        elements.searchResultSummary.textContent = "Enter at least two characters to search the complete conversation.";
        return;
    }

    elements.pagination.hidden = true;
    elements.searchResultSummary.hidden = false;
    elements.searchResultSummary.textContent = "Searching the complete conversation…";
    setEmptyConversation("Searching messages…");

    const results = await DB.searchMessages(
        state.activeImport.id,
        state.selectedContact.contactKey,
        term,
        500,
        (scanned) => {
            if (token === state.searchToken) {
                elements.searchResultSummary.textContent = `Searching… ${Core.formatNumber(scanned)} messages checked`;
            }
        }
    );

    if (token !== state.searchToken) return;
    renderMessages(results);
    elements.searchResultSummary.textContent = results.length >= 500
        ? "Showing the first 500 matching messages. Refine the search for more specific results."
        : `${Core.formatNumber(results.length)} matching message${results.length === 1 ? "" : "s"}.`;
}

function scheduleConversationSearch() {
    clearTimeout(conversationSearchTimer);
    conversationSearchTimer = setTimeout(() => {
        searchConversation().catch((error) => showStatus(error.message, "danger"));
    }, 350);
}

async function clearConversationSearch() {
    elements.conversationSearch.value = "";
    state.searchToken += 1;
    elements.searchResultSummary.hidden = true;
    await loadConversationPage(state.pageIndex);
}

function createBlobDownload(chunks, mimeType, filename) {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function openExportWriter(filename, mimeType, messageCount) {
    if (window.showSaveFilePicker && window.isSecureContext) {
        const extension = filename.slice(filename.lastIndexOf("."));
        const baseMimeType = mimeType.split(";", 1)[0];
        const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: baseMimeType, accept: { [baseMimeType]: [extension] } }],
        });
        const writable = await handle.createWritable();
        return {
            async write(chunk) { await writable.write(chunk); },
            async close() { await writable.close(); },
            async abort() { await writable.abort(); },
            streaming: true,
        };
    }

    if (messageCount > FALLBACK_EXPORT_MESSAGE_LIMIT) {
        throw new Error(
            "This browser cannot stream the export directly to a file. Open the viewer through HTTPS in a Chromium-based browser, or export a smaller backup."
        );
    }

    const chunks = [];
    return {
        async write(chunk) { chunks.push(chunk); },
        async close() { createBlobDownload(chunks, mimeType, filename); },
        async abort() { chunks.length = 0; },
        streaming: false,
    };
}

async function exportFullBackup(format) {
    if (!state.activeImport) return;
    const isCSV = format === "csv";
    const filename = isCSV ? "sms-backup.csv" : "sms-backup.json";
    const mimeType = isCSV ? "text/csv;charset=utf-8" : "application/json";
    let writer = null;

    try {
        const exportCount = state.activeImport.messageCount ?? (state.activeImport.recordCount - (state.activeImport.skippedCount || 0));
        writer = await openExportWriter(filename, mimeType, exportCount);
        showStatus(`Exporting ${Core.formatNumber(exportCount)} indexed messages…`, "info");
        if (isCSV) await writer.write(`\uFEFF${Core.getCSVHeader()}\r\n`);
        else await writer.write("[\n");

        let afterSequence = -1;
        let exported = 0;
        let firstJSONRecord = true;
        while (true) {
            const batch = await DB.getMessageBatch(state.activeImport.id, afterSequence, EXPORT_BATCH_SIZE);
            if (!batch.length) break;

            if (isCSV) {
                const rows = batch.map((message) => {
                    const contact = state.contactMap.get(message.contactKey) || {
                        contactKey: message.contactKey,
                        displayAddress: message.contactKey,
                        name: null,
                    };
                    return Core.messageToCSVRow(message, contact);
                });
                await writer.write(`${rows.join("\r\n")}\r\n`);
            } else {
                const records = batch.map((message) => {
                    const contact = state.contactMap.get(message.contactKey);
                    return JSON.stringify({
                        contact: Core.getDisplayName(contact),
                        address: contact?.displayAddress || message.contactKey,
                        ...message,
                    });
                });
                await writer.write(`${firstJSONRecord ? "" : ",\n"}${records.join(",\n")}`);
                firstJSONRecord = false;
            }

            afterSequence = batch.at(-1).sequence;
            exported += batch.length;
            showStatus(`Exporting… ${Core.formatNumber(exported)} of ${Core.formatNumber(exportCount)} indexed messages`, "info");
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        if (!isCSV) await writer.write("\n]\n");
        await writer.close();
        showStatus(`${filename} was created successfully.`, "success");
    } catch (error) {
        await writer?.abort?.().catch(() => {});
        if (error?.name !== "AbortError") {
            showStatus(error instanceof Error ? error.message : "The export failed.", "danger");
        }
    }
}

function splitPDFText(doc, text, maxWidth) {
    const output = [];
    const paragraphs = String(text || "").split("\n");

    const splitLongToken = (token) => {
        const chunks = [];
        let chunk = "";
        for (const character of token) {
            const candidate = `${chunk}${character}`;
            if (chunk && doc.getTextWidth(candidate) > maxWidth) {
                chunks.push(chunk);
                chunk = character;
            } else {
                chunk = candidate;
            }
        }
        if (chunk) chunks.push(chunk);
        return chunks;
    };

    paragraphs.forEach((paragraph) => {
        const normalized = paragraph.trim();
        if (!normalized) {
            output.push("");
            return;
        }

        const words = normalized.split(/\s+/);
        let line = "";

        words.forEach((word) => {
            if (doc.getTextWidth(word) > maxWidth) {
                if (line) {
                    output.push(line);
                    line = "";
                }
                const chunks = splitLongToken(word);
                output.push(...chunks.slice(0, -1));
                line = chunks.at(-1) || "";
                return;
            }

            const candidate = line ? `${line} ${word}` : word;
            if (line && doc.getTextWidth(candidate) > maxWidth) {
                output.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });

        if (line) output.push(line);
    });

    return output.length ? output : [""];
}

async function exportSelectedPDF() {
    if (!state.selectedContact || !state.activeImport) return;
    if (!window.jspdf?.jsPDF) {
        showStatus("The local jsPDF library could not be loaded.", "danger");
        return;
    }
    if (state.selectedContact.messageCount > PDF_MESSAGE_LIMIT) {
        showStatus(
            `PDF export is limited to ${Core.formatNumber(PDF_MESSAGE_LIMIT)} messages to avoid exhausting browser memory. Use CSV or JSON for this conversation.`,
            "warning"
        );
        return;
    }

    showStatus("Preparing the PDF…", "info");
    const messages = await DB.getContactMessageBatch(
        state.activeImport.id,
        state.selectedContact.contactKey,
        0,
        state.selectedContact.messageCount
    );

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
        compress: true,
        putOnlyUsedFonts: true,
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = { top: 16, right: 18, bottom: 17, left: 18 };
    const contentWidth = pageWidth - margin.left - margin.right;
    const contentBottom = pageHeight - margin.bottom - 6;
    const bodyLineHeight = 5.1;
    const headerLineHeight = 4.7;
    let y = margin.top;
    let replacedEmoji = 0;
    let replacedUnsupported = 0;

    const addPage = () => {
        doc.addPage();
        y = margin.top;
    };

    const ensureSpace = (height) => {
        if (y + height > contentBottom) addPage();
    };

    const safeContact = Core.preparePDFText(Core.getDisplayName(state.selectedContact));
    const safeAddress = Core.preparePDFText(state.selectedContact.displayAddress);
    replacedEmoji += safeContact.emojiReplacements + safeAddress.emojiReplacements;
    replacedUnsupported += safeContact.unsupportedReplacements + safeAddress.unsupportedReplacements;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(35);
    doc.setCharSpace(0);
    doc.text("Message Conversation", margin.left, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(55);
    doc.text(`Contact: ${safeContact.text || "Unknown"}`, margin.left, y);
    y += 5.5;
    doc.text(`Address: ${safeAddress.text || "Unavailable"}`, margin.left, y);
    y += 7;

    doc.setDrawColor(205);
    doc.line(margin.left, y, pageWidth - margin.right, y);
    y += 6;

    messages.forEach((message, index) => {
        const safeHeader = Core.preparePDFText(
            `${index + 1}. ${Core.getMessageStatus(message.type, message.kind)} · ${formatMessageDate(message)}`
        );
        const sourceBody = message.body || (message.attachmentCount ? "[MMS attachment]" : "[Empty message]");
        const safeBody = Core.preparePDFText(sourceBody);
        replacedEmoji += safeHeader.emojiReplacements + safeBody.emojiReplacements;
        replacedUnsupported += safeHeader.unsupportedReplacements + safeBody.unsupportedReplacements;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        const lines = splitPDFText(doc, safeBody.text || "[Empty message]", contentWidth);
        ensureSpace(headerLineHeight + Math.min(lines.length, 2) * bodyLineHeight + 4);

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.2);
        doc.setTextColor(95);
        doc.setCharSpace(0);
        doc.text(safeHeader.text, margin.left, y);
        y += headerLineHeight;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        doc.setTextColor(30);
        lines.forEach((line) => {
            ensureSpace(bodyLineHeight);
            doc.setCharSpace(0);
            doc.text(line || " ", margin.left, y);
            y += bodyLineHeight;
        });

        if (message.attachmentCount) {
            const attachmentText = Core.preparePDFText(
                `[${message.attachmentCount} MMS attachment(s) not embedded]`
            );
            replacedEmoji += attachmentText.emojiReplacements;
            replacedUnsupported += attachmentText.unsupportedReplacements;
            ensureSpace(bodyLineHeight);
            doc.setFontSize(9);
            doc.setTextColor(95);
            doc.text(attachmentText.text, margin.left, y);
            y += bodyLineHeight;
        }

        y += 2.5;
    });

    const totalPages = doc.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setDrawColor(220);
        doc.line(margin.left, pageHeight - 12, pageWidth - margin.right, pageHeight - 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.setCharSpace(0);
        doc.text("SMS Viewer and Exporter 2.0.0", margin.left, pageHeight - 7.5);
        doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin.right, pageHeight - 7.5, { align: "right" });
    }

    const safeName = Core.sanitizeFilename(
        state.selectedContact.name || state.selectedContact.displayAddress,
        "conversation"
    );
    doc.save(`Messages_${safeName}.pdf`);

    const replacementCount = replacedEmoji + replacedUnsupported;
    if (replacementCount) {
        const details = [
            replacedEmoji ? `${Core.formatNumber(replacedEmoji)} emoji` : "",
            replacedUnsupported ? `${Core.formatNumber(replacedUnsupported)} other unsupported character(s)` : "",
        ].filter(Boolean).join(" and ");
        showStatus(
            `The PDF was created cleanly. ${details} were replaced only in the PDF to prevent broken spacing. The original text remains unchanged in the viewer, CSV, and JSON exports.`,
            "warning"
        );
    } else {
        showStatus("The PDF was created successfully.", "success");
    }
}

async function clearLocalMessageIndex() {
    if (state.importing) return;
    await DB.clearImportData();
    state.activeImport = null;
    state.contacts = [];
    state.contactMap.clear();
    state.selectedContact = null;
    state.pageIndex = 0;
    elements.contactSearch.value = "";
    elements.contactFilter.value = "all";
    elements.conversationSearch.value = "";
    elements.conversationTitle.textContent = "Conversation";
    elements.conversationSummary.textContent = "";
    elements.pagination.hidden = true;
    elements.searchResultSummary.hidden = true;
    renderContacts();
    setEmptyConversation();
    updateControlStates();
    showStatus("The local message index was cleared. The selected country setting was kept.", "success");
}

async function restoreExistingImport() {
    try {
        const activeImport = await DB.getActiveImport();
        if (!activeImport) return;
        if (activeImport.status !== "complete") {
            await DB.clearImportData();
            showStatus("An incomplete previous import was removed. Please select the backup again.", "warning");
            return;
        }
        state.activeImport = activeImport;
        await loadContacts();
        showStatus(
            `Restored the local index for ${activeImport.fileName}: ${Core.formatNumber(activeImport.recordCount)} records and ${Core.formatNumber(activeImport.contactCount)} contacts.`,
            "info"
        );
    } catch (error) {
        console.error(error);
        showStatus("The local message index could not be opened. Try clearing this site's storage.", "danger");
    }
}

function bindEvents() {
    elements.uploadArea.addEventListener("click", () => {
        if (!state.importing) elements.fileInput.click();
    });
    elements.uploadArea.addEventListener("keydown", (event) => {
        if (!state.importing && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            elements.fileInput.click();
        }
    });
    elements.uploadArea.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (!state.importing) elements.uploadArea.classList.add("drag-active");
    });
    elements.uploadArea.addEventListener("dragleave", () => elements.uploadArea.classList.remove("drag-active"));
    elements.uploadArea.addEventListener("drop", (event) => {
        event.preventDefault();
        elements.uploadArea.classList.remove("drag-active");
        if (!state.importing) chooseFile(event.dataTransfer?.files?.[0]).catch(console.error);
    });
    elements.fileInput.addEventListener("change", (event) => chooseFile(event.target.files?.[0]).catch(console.error));
    elements.cancelImport.addEventListener("click", () => {
        state.cancelRequested = true;
        elements.cancelImport.disabled = true;
        elements.progressDetails.textContent = "Cancelling and removing partial data…";
    });

    elements.contactSearch.addEventListener("input", renderContacts);
    elements.contactFilter.addEventListener("change", renderContacts);
    elements.contactList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-contact-key]");
        if (button) selectContact(button.dataset.contactKey).catch((error) => showStatus(error.message, "danger"));
    });

    elements.conversationSearch.addEventListener("input", scheduleConversationSearch);
    elements.clearConversationSearch.addEventListener("click", () => clearConversationSearch().catch(console.error));
    elements.pageFirst.addEventListener("click", () => loadConversationPage(0).catch(console.error));
    elements.pagePrevious.addEventListener("click", () => loadConversationPage(state.pageIndex - 1).catch(console.error));
    elements.pageNext.addEventListener("click", () => loadConversationPage(state.pageIndex + 1).catch(console.error));
    elements.pageLast.addEventListener("click", () => {
        const last = Math.max(0, Math.ceil(state.selectedContact.messageCount / PAGE_SIZE) - 1);
        loadConversationPage(last, true).catch(console.error);
    });

    elements.settingsButton.addEventListener("click", showCountrySettings);
    elements.saveCountry.addEventListener("click", () => saveCountrySetting().catch((error) => showStatus(error.message, "danger")));
    elements.clearLocalData.addEventListener("click", () => clearLocalMessageIndex().catch((error) => showStatus(error.message, "danger")));
    elements.themeToggle.addEventListener("click", toggleTheme);
    elements.exportCSV.addEventListener("click", () => exportFullBackup("csv"));
    elements.exportJSON.addEventListener("click", () => exportFullBackup("json"));
    elements.exportPDF.addEventListener("click", () => exportSelectedPDF().catch((error) => showStatus(error.message, "danger")));
    elements.printWindow.addEventListener("click", () => window.print());

    elements.captureMediaCheckbox.addEventListener("change", () => {
        const checked = elements.captureMediaCheckbox.checked;
        if (checked) {
            elements.importModeDescription.textContent =
                "Media data will be stored in your browser. Disable for smaller, faster imports.";
        } else {
            elements.importModeDescription.textContent =
                "Fast import: MMS media data is skipped. Text and attachment metadata are indexed. Re-import to load media.";
        }
    });
}

async function initialize() {
    initializeTheme();
    populateCountryOptions();
    countryModal = new bootstrap.Modal(elements.countryModal);
    bindEvents();
    setEmptyConversation();
    updateControlStates();

    try {
        await DB.openDatabase();
        state.defaultCountry = await DB.getSetting("defaultCountry");
        await restoreExistingImport();
    } catch (error) {
        console.error(error);
        showStatus("This browser does not provide the local database required for Version 2.", "danger");
        return;
    }

    if (!state.defaultCountry) showCountrySettings();
}

initialize().catch((error) => {
    console.error(error);
    showStatus(error instanceof Error ? error.message : "The application could not start.", "danger");
});
