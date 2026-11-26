# Client Monitor security rollout

The application uses a shared staff workspace. Staff and admins can work across clients and tasks. Admins manage user accounts and reference lists, delete clients and workspaces, and view the audit trail.

1. In Supabase Auth, disable public sign-up and set the minimum password length to 12. Keep at least one approved administrator. Check the existing accounts and set the server-managed `app_metadata.role` to `admin` or `user` for approved staff. Review any existing admin assignments before rollout. The migration denies workspace access to accounts without one of these roles.
2. Apply [14_security_hardening.sql](14_security_hardening.sql) in the Supabase SQL Editor after the existing schema scripts. Apply it before publishing the updated frontend and GitHub Actions workflow. The migration removes the old admin and username-lookup RPCs, adds database audit triggers, and introduces the keep-alive RPC that returns only a health result.
3. Deploy `admin-users` from `supabase/functions/admin-users/index.ts`. Use the existing GitHub Pages origin configured in the function. The Edge Function validates the caller through Supabase Auth before creating a service-role client.
4. Publish the frontend. Employees with `@avps.local` accounts can use their internal username. Everyone else signs in with the full account email. The admin audit trail lists new database changes by verified Auth user ID and records the fields that changed. Earlier audit records retain their original contents. Use Supabase Auth logs for sign-ins and account or credential events.
5. Verify with a staff account and an admin account. Check client and task edits, admin-only deletion and reference controls, creation of audit entries, and the keep-alive workflow. Check password recovery and Outlook sign-in against the actual hosted origin.

## Reminder deployment

Apply the SQL migration before deploying `send-reminders`. Disable the old scheduled job as part of the cutover. Deploy the function with `supabase functions deploy send-reminders --no-verify-jwt`. The scheduler authenticates using its own secret, and the function checks it before reading business data.

Set the following Edge Function secrets.

| Variable | Purpose |
|---|---|
| `REMINDER_CRON_SECRET` | Cryptographically random secret of at least 32 bytes. Store the same value in Supabase Vault as `client_monitor_reminder_cron_secret`. Use Vault and the Edge Function secret store for the value. |
| `REMINDER_ALLOWED_DOMAIN` | Exact company email domain allowed to receive reminders. |
| `SMTP_HOST`, `SMTP_PORT` | SMTP endpoint. Port 587 uses authenticated STARTTLS and port 465 uses implicit TLS. |
| `SMTP_USER`, `SMTP_PASS` | SMTP credentials. |
| `FROM_EMAIL` | Optional sender address. Defaults to the SMTP username. |

Configure Supabase Cron to run the following SQL with the deployed function URL.

```sql
SELECT net.http_post(
  url := 'https://YOUR_PROJECT.supabase.co/functions/v1/send-reminders',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Reminder-Cron-Secret', (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'client_monitor_reminder_cron_secret'
    )
  ),
  body := '{}'::jsonb
);
```

The function uses the Cyprus calendar for reminder dates and permits one send per recipient per calendar day. A claim with a null `sent_at` marks a send in progress or a delivery whose outcome needs review. Check the SMTP logs before clearing a stale claim and retrying.

## Frontend Content Security Policy

When editing the main inline script in `index.html`, update its `sha256-` entry in the CSP meta tag. The Node test suite checks that the hash matches the script. Chrome also enforces SRI on the pinned Supabase CDN bundle. Existing inline event attributes are permitted while markup values are escaped and dynamic arguments are taken from data attributes.
