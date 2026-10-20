# Outlook client suggestions

AI Suggestions includes a separate, read-only Outlook review panel. Sign in to Client Monitor, open AI Suggestions, and choose Connect Outlook. Select the senders and date range before searching.

Live matching uses keyword rules on email subjects and previews and reads non-inline PDF attachments when the Software Order option is selected. PDF.js extracts text; Tesseract handles scanned pages in English and Greek, including an upside-down retry. All PDF processing happens in the browser using bundled libraries and language models. Findings are unconfirmed candidates; the reviewer must verify the source email, company and client signature before saving. Existing exact-name clients open for review instead. AI-reviewed JSON findings may also be imported privately in the panel; never commit email review files to this public repository.

Order cards show the licensee, order number/date, client number, contact, product descriptions, license quantities, discounted license cost, VAT-inclusive order total, separate service/maintenance fees, payment terms and page evidence. Additional licenses are identified as existing-client work. A document must contain a Software Order Form heading to count as an order; filenames or email acceptance do not establish a signed order. The app does not validate handwritten signatures.

The scan reads at most 100 attachment-bearing messages, 50 PDFs per search, 10 PDFs per message, 20 MB per PDF and 20 pages per PDF; OCR is limited to the first 5 scanned pages. Limits and unreadable files appear in the results. Narrow the date range for remaining messages. Cancel stops the scan and preserves earlier reviews. A PDF saved from a source email can also be selected on its card when Microsoft sign-in is unavailable.

## Microsoft registration

The public identifiers in `outlook-config.js` select the single-tenant Client Monitor Outlook registration. Its Single-page application redirect URI is exactly:

`https://alexandrosh93.github.io/Client-Monitor/outlook-redirect.html`

Authentication uses MSAL with authorization code / PKCE and delegated `Mail.Read`. No client secret is needed or permitted in this static app. Microsoft grants mailbox-wide read permission, while application queries and post-filtering restrict results to the configured senders. It cannot send, edit, or delete mail. Organization policies may require administrator approval.

Tokens stay in memory. Reloading requires connecting again. Reviews are isolated by Client Monitor user in sessionStorage; disconnect and sign-out clear them from the current tab. Connection identifiers and sender settings persist in localStorage. Export findings before leaving if you need a copy. Client records are saved only through the existing review-and-save form.

## Build and verify

Use Node.js and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm run build:auth
pnpm run build:pdf
pnpm test
```

The generated `vendor/` modules, OCR language models and license files are committed so GitHub Pages can serve the app without a build service. `build:pdf` pins English and Greek tessdata_fast models to a recorded Git revision. `outlook-redirect.html` must stay minimal and use the dedicated MSAL redirect bridge. Keep its registered URL in sync if the hosting address changes.

## Purchases from existing clients

AI Suggestions groups Software Orders by exact company name or Client ID. Conflicting matches and orders containing multiple companies require correction before they can be applied. In **Existing clients — new purchase**, review the source and select the suggested modules, then choose **Save purchase to client**. Only the selected new modules are added. Products, licenses, amounts, fees, order dates/numbers, contact details from the order, and source links are appended to the client's existing comment history. Contact fields, status, progress and project/training data are not overwritten. A purchase may also be recorded without adding modules.

Saving reads the current client and conditionally updates modules and comment history together. It reports success only after the database confirms the write. Concurrent changes or access errors leave the local record unchanged. Reviewed order identifiers are stored in the comment entry to prevent duplicate application on later imports; deleting that history entry also removes its duplicate marker. Orders without an extracted number use company, attachment name and date as a fallback; verify these manually. No new database table or migration is required. Live database access is still subject to the existing authenticated client policies.
