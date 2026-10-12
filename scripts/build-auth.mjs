import { build } from 'esbuild';
await build({
  stdin: { contents: 'export { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, outfile: 'vendor/msal-browser.js',
  legalComments: 'linked', target: ['es2022'],
});
await build({
  stdin: { contents: 'import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge"; broadcastResponseToMainFrame();', resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, outfile: 'vendor/msal-redirect.js',
  legalComments: 'linked', target: ['es2022'],
});
