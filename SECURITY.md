# Security Policy

## Reporting a vulnerability

Please do not include real SMS backups, message contents, phone numbers, or other private data in a public issue. Open an issue containing only a minimal synthetic reproduction, or contact the repository owner privately through their GitHub profile when private details are unavoidable.

## Data handling

The production application processes backups locally in the browser and does not upload or sync imported data to the internet. It has no upload endpoint. Maintainers cannot remotely inspect or remove users’ local data.

Imported SMS/MMS text, contact details, original filename/import metadata, and loaded photos, audio, video, and other attachments are stored in IndexedDB database `sms-viewer-v2` (`imports`, `contacts`, and `messages`). Media loading is enabled by default; disabling it before importing skips media payloads but still indexes message text and attachment metadata. Country settings are stored separately in the database’s `settings` store. Theme and startup-notice preferences are stored in `localStorage`.

**Reloading, closing a tab/window, or restarting the browser does not delete the stored import.** The app restores the last completed import. A startup notice describes this behavior and can be hidden with **Do not show this notice again in this browser**. The notice remains accessible through **About local storage**, and a storage reminder remains on the main page. There is no warning when closing the window.

Users are responsible for manually deleting sensitive data before leaving a shared computer or closing the app. Use **Delete stored messages and media** on the main page and wait for confirmed success. This clears import metadata, contacts, messages, and loaded media, while retaining country and display/notice preferences. Close other app tabs first; they can retain displayed data or run an import. If deletion fails, do not assume the data is gone: retry or remove the app’s IndexedDB/site storage using the browser’s controls. Removing all site storage also removes preferences. Storage behavior for `file://` pages differs between browsers; cookies alone and hard reloads do not reliably clear the index.

The app does not delete original XML files, downloaded media, exports, printouts, or external backups. Users must manage those separately. Clearing browser records does not guarantee secure erasure of disk remnants, operating-system caches, or backups. Anyone with access to the same browser profile may be able to access stored data.

## Supported version

Security fixes are applied to the latest Version 2 release. The archived Version 1 code is retained for historical reference and is not supported.
