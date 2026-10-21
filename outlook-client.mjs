import { PublicClientApplication, InteractionRequiredAuthError } from './vendor/msal-browser.js';
import { senderList } from './email-leads.mjs?v=proposal-pdf-20261021';
import { isPdfAttachment } from './software-orders.mjs?v=proposal-pdf-20261021';

const scopes = ['Mail.Read'];
let instance;
let account;
let configKey;
export const redirectUri = new URL('./outlook-redirect.html', import.meta.url).href;

export async function initialize(config) {
  if (!/^[0-9a-f-]{36}$/i.test(config.clientId) || !/^[0-9a-f-]{36}$/i.test(config.tenantId)) {
    throw new Error('Microsoft app setup is needed. Enter the Application ID and Directory ID under Connection settings.');
  }
  const key = config.clientId + ':' + config.tenantId;
  if (instance && key === configKey) return instance;
  if (instance) await instance.clearCache();
  account = undefined;
  instance = new PublicClientApplication({
    auth: { clientId: config.clientId, authority: 'https://login.microsoftonline.com/' + config.tenantId, redirectUri },
    cache: { cacheLocation: 'memoryStorage' },
  });
  await instance.initialize();
  configKey = key;
  return instance;
}
export async function connect() {
  if (!instance) throw new Error('Connection settings are not ready.');
  const result = await instance.loginPopup({ scopes, prompt: 'select_account' });
  account = result.account;
  return account.username;
}
export async function disconnect() {
  account = undefined;
  if (instance) await instance.clearCache();
}
async function token() {
  if (!instance || !account) throw new Error('Connect Outlook first.');
  try {
    return (await instance.acquireTokenSilent({ scopes, account })).accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      throw new Error('Microsoft needs you to sign in again. Click Connect Outlook, then repeat the search.');
    }
    throw error;
  }
}
export async function searchMail({ senders, since, signal, onProgress }) {
  const list = senderList(senders);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since))) throw new Error('Choose a valid search start date.');
  const accessToken = await token();
  const messages = [];
  let truncated = false;
  for (const sender of list) {
    const params = new URLSearchParams({
      '$select': 'id,subject,from,receivedDateTime,webLink,bodyPreview,hasAttachments',
      '$filter': "receivedDateTime ge " + since + "T00:00:00Z and from/emailAddress/address eq '" + sender + "'",
      '$orderby': 'receivedDateTime desc', '$top': '100',
    });
    let url = 'https://graph.microsoft.com/v1.0/me/messages?' + params;
    for (let page = 0; url && page < 10; page++) {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/me/messages')) throw new Error('Unexpected mailbox paging address.');
      const response = await fetch(url, { signal, headers: { Authorization: 'Bearer ' + accessToken } });
      if (!response.ok) {
        if (response.status === 429) throw new Error('Microsoft is limiting requests. Wait a minute and search again.');
        if (response.status === 401 || response.status === 403) throw new Error('Mailbox access was not granted or has expired. Connect Outlook again; your Microsoft administrator may need to approve Mail.Read.');
        throw new Error('Outlook search failed (' + response.status + '). Existing suggestions were kept.');
      }
      const data = await response.json();
      if (!Array.isArray(data.value)) throw new Error('Outlook returned an unexpected response.');
      // Exact sender check guards against broad or unexpected provider matches.
      messages.push(...data.value.filter(m => String(m.from?.emailAddress?.address || '').toLowerCase() === sender));
      onProgress?.(messages.length);
      url = data['@odata.nextLink'] || '';
    }
    if (url) truncated = true;
  }
  return { messages, truncated, senders: list };
}

export async function scanOrderAttachments(messages, { signal, onProgress, readPdf } = {}) {
  const accessToken = await token();
  const matches = [], errors = [];
  let checkedMessages = 0, checkedPdfs = 0, limited = false;
  async function request(url) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/me/messages/')) throw new Error('Unexpected attachment address.');
    const response = await fetch(url, { signal, headers: { Authorization: 'Bearer ' + accessToken } });
    if (!response.ok) throw new Error(response.status === 429 ? 'Microsoft is limiting requests. Retry the scan later.' : 'Attachment access failed (' + response.status + ').');
    return response;
  }
  for (const message of messages) {
    signal?.throwIfAborted();
    if (!message.hasAttachments) continue;
    if (checkedMessages >= 100 || checkedPdfs >= 50) { limited = true; break; }
    checkedMessages++;
    const base = 'https://graph.microsoft.com/v1.0/me/messages/' + encodeURIComponent(message.id) + '/attachments';
    const attachments = [];
    try {
      let url = base + '?$select=id,name,contentType,size,isInline';
      for (let page = 0; url && page < 5; page++) {
        const parsed = new URL(url);
        if (parsed.origin !== 'https://graph.microsoft.com' || parsed.pathname !== new URL(base).pathname) throw new Error('Unexpected attachment paging address.');
        const data = await (await request(url)).json();
        if (!Array.isArray(data.value)) throw new Error('Unexpected attachment list.');
        attachments.push(...data.value.filter(a => a['@odata.type'] === '#microsoft.graph.fileAttachment' && isPdfAttachment(a)));
        url = data['@odata.nextLink'] || '';
      }
      if (url || attachments.length > 10) limited = true;
      const orders = [];
      for (const attachment of attachments.slice(0, 10)) {
        signal?.throwIfAborted();
        if (checkedPdfs >= 50) { limited = true; break; }
        checkedPdfs++;
        try {
          if (attachment.size > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MB limit.');
          onProgress?.('Downloading ' + attachment.name);
          const response = await request(base + '/' + encodeURIComponent(attachment.id) + '/$value');
          const declared = Number(response.headers.get('Content-Length'));
          if (declared > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MB limit.');
          const reader = response.body.getReader(), chunks = [];
          let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.length;
              if (size > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MB limit.');
              chunks.push(value); signal?.throwIfAborted();
            }
          } finally { await reader.cancel(); }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          orders.push(await readPdf(bytes, { name: attachment.name, signal, onProgress }));
        } catch (e) {
          signal?.throwIfAborted();
          errors.push(attachment.name + ': ' + e.message);
          orders.push({ kind: 'needs_review', attachment_name: attachment.name, issues: [e.message], extraction: 'text' });
        }
      }
      if (orders.length) matches.push({ message, orders });
    } catch (e) { signal?.throwIfAborted(); errors.push(message.subject + ': ' + e.message); }
  }
  return { matches, checkedMessages, checkedPdfs, errors, limited };
}
