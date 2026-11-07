# Changelog

All notable changes to this project are documented here.

## 2.1.0

### Added

- Startup notice explaining browser storage and how to delete imported data. Users can hide future notices and reopen them from the main page.
- Persistent storage reminder and a main-page button to delete stored messages, contacts, and media.
- MMS image, video, and audio previews for formats supported by the browser, with attachment downloads and an option to skip media payloads at import.
- Optional Docker deployment with nginx.

### Fixed

- Pending conversation page and search results are invalidated when stored data is deleted.

## 2.0.0 - 2026-07-26

### Added

- First-run default-country selection with an English explanation
- Worldwide phone normalization through libphonenumber-js
- Fully local Bootstrap, jsPDF, and libphonenumber-js assets
- Third-party version and license documentation
- Streaming XML tokenizer for SMS Backup & Restore backups
- IndexedDB-backed message and contact index
- Import progress, cancellation, and incomplete-import cleanup
- Windowed conversation rendering with 200 messages per page
- Full-conversation search without loading the entire conversation into the DOM
- SMS and text-focused MMS support
- MMS attachment metadata while skipping base64 payload storage
- Streaming CSV and JSON export where supported
- Reload restoration of the last completed local index
- Content Security Policy preventing application network connections
- Automated core, parser, static, performance, and browser tests

### Changed

- Replaced German-only phone normalization with explicit country-aware parsing
- Replaced DOMParser-based full-file parsing with incremental parsing
- Replaced in-memory backup storage with batched IndexedDB storage
- Removed Font Awesome and all CDN requests
- Limited PDF export to 5,000 messages and print output to the visible window

### Fixed

- International number deletion and contact merging
- Broken selected-contact PDF export
- Unknown-contact filtering
- malformed XML handling
- MIME-type-only file rejection
- duplicate handlers and functions
- CSV quoting and spreadsheet-formula injection
- repeated dark-mode stylesheet insertion
- stale state after a second import
- PDF line corruption caused by emoji and other characters outside jsPDF's built-in font encoding
- PDF wrapping for long words, URLs, paragraph breaks, page boundaries, and right margins
- inconsistent count separators when the English interface is opened in a non-English browser locale
