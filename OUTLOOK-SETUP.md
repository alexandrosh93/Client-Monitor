# Outlook client suggestions

AI Suggestions includes a separate, read-only Outlook review panel. Sign in to Client Monitor, open AI Suggestions, and choose Connect Outlook. Select the senders and date range before searching.

Live matching uses keyword rules on email subjects and previews, not an AI service. Findings are unconfirmed candidates; the reviewer must verify the source email and company name before saving a new client. Existing exact-name clients open for review instead. AI-reviewed JSON findings may also be imported privately in the panel; never commit email review files to this public repository.

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
pnpm test
```

The generated `vendor/` modules and license files are committed so GitHub Pages can serve the app without a build service. `outlook-redirect.html` must stay minimal and use the dedicated MSAL redirect bridge. Keep its registered URL in sync if the hosting address changes.
