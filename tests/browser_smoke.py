"""End-to-end browser test for SMS Viewer and Exporter Version 2.

The execution environment blocks local HTTP and file navigation, so the production
HTML and local assets are injected into an about:blank page. fake-indexeddb supplies
the same IndexedDB API used by the application.
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT_DIR = Path(__file__).resolve().parents[1]


def build_backup() -> str:
    records: list[str] = []
    for index in range(252):
        address = "+49 176 1234567" if index % 2 else "0176 1234567"
        if index == 5:
            body = "Needle in complete conversation"
        elif index == 6:
            body = "PDF emoji regression 😜"
        else:
            body = f"Message {index}"
        records.append(
            f'<sms address="{address}" date="{1000 + index}" readable_date="Date {index}" '
            f'body="{body}" type="{1 if index % 2 else 2}" contact_name="Alice" />'
        )

    records.append(
        '<mms date="5000" msg_box="1" address="+1 212 555 0123" readable_date="MMS date" '
        'contact_name="Bob"><parts>'
        '<part seq="0" ct="text/plain" text="MMS hello" />'
        '<part seq="1" ct="image/jpeg" name="photo.jpg" data="QUJDREVGRw==" />'
        '</parts><addrs><addr address="+1 212 555 0123" type="137" /></addrs></mms>'
    )
    return f'<?xml version="1.0" encoding="UTF-8"?><smses count="253">{"".join(records)}</smses>'


def production_markup_without_assets() -> str:
    html = (PROJECT_DIR / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'<meta\s+http-equiv="Content-Security-Policy".*?>', "", html, flags=re.S | re.I)
    html = re.sub(r'<link\s+[^>]*rel="stylesheet"[^>]*>', "", html, flags=re.I)
    html = re.sub(r'<script\s+src="[^"]+"\s*></script>', "", html, flags=re.I)
    return html


def add_local_assets(page) -> None:
    page.add_style_tag(content=(PROJECT_DIR / "vendor/bootstrap/bootstrap.min.css").read_text(encoding="utf-8"))
    page.add_style_tag(content=(PROJECT_DIR / "app.css").read_text(encoding="utf-8"))
    for relative_path in [
        "tests/fake-indexeddb.iife.js",
        "vendor/libphonenumber/libphonenumber-min.js",
        "vendor/bootstrap/bootstrap.bundle.min.js",
        "vendor/jspdf/jspdf.umd.min.js",
        "core.js",
        "stream-parser.js",
        "db.js",
        "app.js",
    ]:
        page.add_script_tag(content=(PROJECT_DIR / relative_path).read_text(encoding="utf-8"))


def main() -> None:
    console_errors: list[str] = []
    external_requests: list[str] = []

    with tempfile.TemporaryDirectory() as temp_dir:
        backup_path = Path(temp_dir) / "test-backup.xml"
        backup_path.write_text(build_backup(), encoding="utf-8")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path="/usr/bin/chromium",
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(accept_downloads=True)
            page.on(
                "console",
                lambda message: console_errors.append(f"{message.type}: {message.text}")
                if message.type == "error"
                else None,
            )
            page.on("pageerror", lambda error: console_errors.append(f"pageerror: {error}"))
            page.on(
                "request",
                lambda request: external_requests.append(request.url)
                if request.url.startswith(("http://", "https://"))
                else None,
            )

            page.set_content(production_markup_without_assets(), wait_until="load")
            add_local_assets(page)

            page.locator("#privacy-modal").wait_for(state="visible")
            assert not page.locator("#country-modal").is_visible()
            assert "closing the tab or window" in page.locator("#privacy-modal").text_content()
            page.check("#hide-privacy-notice")
            page.click("#privacy-continue")
            page.locator("#privacy-modal").wait_for(state="hidden")

            page.locator("#country-modal").wait_for(state="visible")
            page.select_option("#country-select", "DE")
            page.click("#save-country")
            page.locator("#country-modal").wait_for(state="hidden")

            page.set_input_files("#file-input", str(backup_path))
            page.wait_for_function(
                "document.querySelector('#status-message').textContent.includes('Imported 253 records')",
                timeout=30000,
            )

            assert page.locator("#contact-count").text_content() == "2"
            assert page.locator("#contact-list [data-contact-key]").count() == 2

            page.locator("#contact-list [data-contact-key]", has_text="Alice").click()
            page.wait_for_function("document.querySelector('#page-label').textContent.includes('201–252 of 252')")
            assert page.locator("#chat-window .message-row").count() == 52

            page.click("#page-first")
            page.wait_for_function("document.querySelector('#page-label').textContent.includes('1–200 of 252')")
            assert page.locator("#chat-window .message-row").count() == 200

            page.fill("#conversation-search", "Needle")
            page.wait_for_function("document.querySelector('#search-result-summary').textContent.includes('1 matching message')")
            assert page.locator("#chat-window .message-row").count() == 1
            assert "Needle" in page.locator("#chat-window").text_content()

            page.fill("#conversation-search", "")
            page.wait_for_function("document.querySelector('#page-label').textContent.includes('1–200 of 252')")
            with page.expect_download() as download_info:
                page.locator("#export-pdf").evaluate("button => button.click()")
            pdf_path = Path(temp_dir) / "conversation.pdf"
            download_info.value.save_as(pdf_path)
            assert pdf_path.stat().st_size > 1000
            assert "replaced only in the PDF" in page.locator("#status-message").text_content()

            page.locator("#contact-list [data-contact-key]", has_text="Bob").click()
            page.wait_for_function("document.querySelector('#chat-window').textContent.includes('MMS hello')")
            chat_text = page.locator("#chat-window").text_content()
            assert "photo.jpg" in chat_text
            assert "image/jpeg" in chat_text

            # Verify that only the selected country's local format was merged.
            contact_keys = page.locator("#contact-list [data-contact-key]").evaluate_all(
                "nodes => nodes.map(node => node.dataset.contactKey)"
            )
            assert "+491761234567" in contact_keys
            assert "+12125550123" in contact_keys

            # Deletion is available on the main page, including without an active import.
            page.click("#clear-local-data")
            page.wait_for_function("document.querySelector('#status-message').textContent.includes('were deleted')")
            assert page.locator("#chat-window .message-row").count() == 0
            assert page.evaluate("SMSViewerDB.getActiveImport()") is None
            assert page.evaluate("SMSViewerDB.getMessageBatch('active')") == []
            assert page.evaluate("SMSViewerDB.getContacts('active')") == []
            assert page.evaluate("SMSViewerDB.getSetting('defaultCountry')") == "DE"
            assert page.locator("#clear-local-data").is_enabled()

            page.click("#privacy-info")
            page.locator("#privacy-modal").wait_for(state="visible")
            assert page.locator("#hide-privacy-notice").is_checked()
            page.uncheck("#hide-privacy-notice")
            page.click("#privacy-continue")
            page.locator("#privacy-modal").wait_for(state="hidden")

            browser.close()

    if external_requests:
        raise SystemExit("External requests detected:\n- " + "\n- ".join(external_requests))
    if console_errors:
        raise SystemExit("Browser errors detected:\n- " + "\n- ".join(console_errors))

    print("Browser smoke test passed.")


if __name__ == "__main__":
    main()
