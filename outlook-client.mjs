import { PublicClientApplication, InteractionRequiredAuthError } from './vendor/msal-browser.js';
import { senderList } from './email-leads.mjs';

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
      '$select': 'id,subject,from,receivedDateTime,webLink,bodyPreview',
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
