# Version 2 Technical Audit

## Release objective

Turn the repaired Version 1 prototype into an offline, country-independent, large-backup-capable release suitable for updating the existing public GitHub repository.

## Implemented release decisions

1. **English-only interface and documentation**
2. **No CDN or runtime network dependencies**
3. **Exact dependency versions and redistributed licenses included**
4. **Explicit default-country onboarding instead of a hidden German assumption**
5. **Streaming XML parsing instead of `DOMParser`**
6. **IndexedDB storage instead of complete in-memory data storage**
7. **A maximum of 200 rendered messages at once**
8. **Progress and cancellation for long imports**
9. **Optional MMS media capture (enabled by default), with a text/metadata-only import option**
10. **Release checklist, integrity manifest, and automated tests**

## Dependency and license status

Bundled production dependencies:

- Bootstrap 5.3.8 — MIT
- jsPDF 4.2.1 — MIT
- libphonenumber-js 1.13.9 — MIT, with Apache-2.0-licensed metadata derived from Google's libphonenumber project

Font Awesome was removed. Production files, complete license texts, exact versions, sizes, and SHA-256 hashes are documented in `THIRD_PARTY_NOTICES.md`, `vendor/licenses/`, and `vendor/manifest.json`.

## Verification completed for this package

Verified on 26 July 2026:

- `npm test`: **19 passed, 0 failed**
- Streaming parser performance test: **100,000 records passed**
- Browser smoke test: **passed**
- JavaScript syntax checks: **passed**
- `npm audit`: **0 known vulnerabilities reported**
- Duplicate HTML IDs: **none**
- Missing JavaScript DOM references: **none**
- Duplicate function declarations: **none**
- Missing local production assets: **none**
- Remote production URLs: **none**
- Vendor manifest hash mismatches: **none**
- `eval()` usage: **none**
- Dynamic `innerHTML` assignments: **none**

The browser smoke test covers first-run country selection, streamed import, German local/international number merging, contact rendering, a conversation longer than 200 records, pagination/windowed rendering, full-conversation search, MMS text and attachment metadata, PDF generation with an emoji regression case, import completion, and the absence of external requests.

The project owner additionally verified a real 8 MB SMS Backup & Restore file containing 16,153 records from 413 contacts. Import, contact indexing, conversation viewing, and PDF creation completed successfully. The first real PDF test exposed a jsPDF standard-font surrogate-pair defect: an emoji could appear as text such as `Ø=P` and spread the surrounding line across the page. The PDF path now normalizes control characters, replaces emoji with `[emoji]`, replaces other unsupported glyphs with `?`, resets character spacing explicitly, wraps long tokens safely, and adds consistent margins and page footers. A rendered regression fixture confirms that the affected message text no longer fragments or clips.

## Large-backup architecture

Version 2 removes the original full-file `FileReader`/`DOMParser` path. The XML stream is tokenized incrementally and records are written to IndexedDB in batches. The complete backup is therefore not duplicated as one JavaScript string and one XML DOM tree.

The UI also avoids rendering entire long conversations. It loads at most 200 messages into the conversation window at a time. Contact rendering is limited to 500 results, with search available for narrowing large contact sets.

MMS `data` attributes can contain very large base64 values. With media capture disabled, Version 2 counts and skips those values while retaining MMS text and attachment metadata. With capture enabled (the default), media payloads are retained in memory during parsing and stored in IndexedDB.

## Important limits that remain explicit

- Available IndexedDB quota is controlled by the browser, browser profile, device, and free disk space. No browser-only application can guarantee that an arbitrarily large multi-gigabyte text index will fit on every system.
- Direct `file://` use is less reliable than localhost or HTTPS for persistent storage and streaming file export.
- PDF export is intentionally limited to 5,000 messages.
- The direct jsPDF export deliberately substitutes emoji and unsupported scripts to keep its compact selectable-text PDF stable. Exact emoji and non-Latin glyphs remain available through browser printing of the current 200-message page.
- Loaded MMS media can be previewed when the browser supports its format and downloaded separately. Media capture increases memory and storage requirements.
- Full-backup search across every contact is not included. Conversation search scans the selected contact's indexed messages.

## Remaining release gates

Before publishing the GitHub release, test copies of real SMS Backup & Restore files, especially:

1. the oldest available backup,
2. a current SMS-only backup,
3. a backup containing MMS,
4. the largest available backup,
5. local and international number variants from the same contact,
6. Chrome/Chromium, Firefox, and Edge.

Update screenshots and repository URLs, complete the remaining browser and MMS checks where possible, then create the `v2.0.0` tag. The final release source is prepared for the public repository at `https://github.com/petrk94/smsviewer`.

## Recommended release classification

Version 2.0.0 is suitable as a major release candidate after the real-file verification above. The storage model, import pipeline, number normalization, interface, and bundled dependency strategy are sufficiently different from Version 1 to justify a major version.

## Local storage notice and deletion

A startup notice appears before import restoration and country onboarding unless the browser’s `smsviewer.privacyNotice.v1.dismissed` localStorage preference is `true`. Users can reopen it from the main page and change that choice. A permanent reminder and deletion button explain retention after reload/window close. There is no unload warning or unload-based deletion.

Deletion clears `imports`, `contacts`, and `messages` in one completed IndexedDB transaction, preserving settings and localStorage preferences. The UI invalidates pending search/page results and clears the pending file. Cross-tab coordination is not implemented: users must close other app tabs before deleting. Original files and exports remain outside the deletion scope. See README and SECURITY for the storage inventory and limitations.
