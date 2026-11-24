import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const [source, output, client] = process.argv.slice(2);
const origin = 'https://emofidacademy.ir';
const portableFonts = "/Academy-Exam/assets/Pinar-VF";
const pages = ['index.html', 'admin.html'];
const studioAssets = [
  'academy-skin.css', 'portal.css', 'presentation-preview.html',
  'studio-routing.js', 'teaching-presentation.js', 'pdf',
];
const runtimeFiles = new Map();
const [routing, loader] = await Promise.all(
  ['studio-routing.js', 'studio-loader.js'].map(file => readFile(join(source, file), 'utf8')),
);
const portal = JSON.parse(await readFile(join(source, 'portal-config.json'), 'utf8'));
if (portal.enabled !== true) throw Error('The Studio portal must be enabled');
portal.apiUrl = 'https://azmoon21.app.n8n.cloud/webhook/mofid-learning-portal';
const portalOrigin = new URL(portal.apiUrl).origin;

function replaceOnce(text, before, after, name) {
  if (text.split(before).length !== 2) throw Error('Check the updated Studio ' + name);
  return text.replace(before, after);
}

function storeAsset(name, content, extension = 'js') {
  const revision = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const file = name + '-' + revision + '.' + extension;
  runtimeFiles.set(file, content);
  return file;
}

function extractRuntime(text, pattern, name) {
  const matched = text.match(pattern);
  if (!matched) throw Error('Check the updated Studio ' + name);
  return {html: text.replace(matched[0], ''), file: storeAsset(name, matched[1])};
}

const clientFile = storeAsset('studio-domain-client', await readFile(client, 'utf8'));
const entryFile = storeAsset('studio-entry', await readFile(join(dirname(client), 'studio-entry.js'), 'utf8'));

function loginMarkup(admin) {
  return `<section id="studioEntry" class="panel mofid-entry-card" style="max-width:460px;margin:8vh auto;padding:28px">
    <div class="mofid-entry-heading">
      <div class="mofid-entry-logo"><img src="/Academy-Exam/assets/mofid-academy-logo-small.webp" alt="مفید آکادمی" width="64" height="64"></div>
      <div class="mofid-entry-wordmark" lang="en" dir="ltr">ACADEMY MOFID</div>
      <h1>${admin ? 'ورود سوپرادمین' : 'ورود شرکت‌کننده'}</h1>
      <p class="small-text muted">مفید آکادمی · استودیوی یادگیری</p>
    </div>
    <form id="studioLogin" method="post">
      <div class="field"><label for="portal-username">نام کاربری</label>
        <input id="portal-username" name="username" autocomplete="username" required maxlength="80" dir="ltr" autocapitalize="none" spellcheck="false">
      </div>
      <div class="field mofid-entry-password"><label for="portal-password">رمز عبور</label>
        <input id="portal-password" name="password" type="password" autocomplete="current-password" required maxlength="200">
        <button id="studioReveal" class="mofid-entry-reveal" type="button" aria-label="نمایش رمز عبور" aria-pressed="false">نمایش</button>
      </div>
      <button class="btn primary mofid-entry-submit" type="submit" disabled>ورود</button>
    </form>
    <p id="studioEntryMessage" class="small-text" role="status"></p>
    <a id="studioEntryRetry" class="btn" href="" hidden>تلاش دوباره</a>
    <p class="small-text muted">حساب جدید را فقط مدیر آکادمی ایجاد می‌کند.</p>
    <a class="small-text" href="${admin ? './' : './admin.html'}">${admin ? 'ورود شرکت‌کننده' : 'ورود مدیریت استودیو'}</a>
    <noscript>برای ورود، جاوااسکریپت مرورگر را فعال کنید.</noscript>
  </section>`;
}

async function buildPage(page) {
  const admin = page === 'admin.html';
  const role = admin ? 'admin' : 'participant';
  const previousSessionKey = 'mofid-studio-' + role + '-session';
  const sessionKey = previousSessionKey + ':' + portal.apiUrl;
  let outputHtml;
  const runtime = {
    location: { href: origin + '/learning-studio/' + page },
    URL,
    window: {},
    document: {
      body: {},
      open() {},
      write(text) { outputHtml = text; },
      close() {},
    },
    async fetch(path) {
      const file = path.split('?')[0];
      if (!/^chunks\/v2-\d+\.txt$/.test(file)) throw Error('Unexpected Studio bundle input');
      return { ok: true, text: () => readFile(join(source, file), 'utf8') };
    },
  };
  const context = vm.createContext(runtime);
  vm.runInContext(routing, context, { filename: 'studio-routing.js' });
  await vm.runInContext(loader, context, { filename: 'studio-loader.js' });
  if (!outputHtml || !outputHtml.includes('data-academy-app="studio"')) {
    throw Error(runtime.document.body.innerHTML || 'Could not assemble Studio ' + page);
  }

  const pdf = outputHtml.match(/<script>(\s*globalThis\.__MOFID_PDF_BINARIES=[\s\S]*?)<\/script>/);
  if (!pdf) throw Error('Check the updated Studio PDF resources');
  const pdfFile = storeAsset('pdf-assets', pdf[1]);
  let html = outputHtml.replace(pdf[0], '');
  html = replaceOnce(html, 'o=globalThis.__MOFID_PDF_BINARIES;class',
    'o=await window.MofidStudioDomain.loadPdfAssets();class', 'PDF loader');
  html = replaceOnce(html,
    "fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload,token:mofidPortalToken}),cache:'no-store'})",
    'window.MofidStudioDomain.request({action,...payload,token:mofidPortalToken})', 'portal transport');
  html = replaceOnce(html,
    "const r=await fetch('portal-config.json?v=20261004',{cache:'no-store'});if(!r.ok)throw Error('تنظیمات پنل دریافت نشد.');const config=await r.json();",
    'const config=' + JSON.stringify(portal).replaceAll('<', '\\u003c') + ';',
    'portal config');
  // Sessions from the previous n8n account must never be sent to the new one.
  const legacySessionName = "'" + previousSessionKey + "'";
  if (html.split(legacySessionName).length !== 4) throw Error('Check the Studio session storage calls');
  html = html.replaceAll(legacySessionName, JSON.stringify(sessionKey));
  html = replaceOnce(html,
    "const mfStyle=document.createElement('link');mfStyle.rel='stylesheet';mfStyle.href='portal.css?v=20261004';document.head.appendChild(mfStyle);",
    '', 'portal stylesheet');
  const sidebarLogo = html.match(/var EE=`data:image\/png;base64,\/9j\/[A-Za-z0-9+/=]+`(?=,DE=)/);
  if (!sidebarLogo) throw Error('Check the embedded Studio sidebar logo');
  html = html.replace(sidebarLogo[0], 'var EE="/Academy-Exam/assets/mofid-academy-logo-small.webp"');

  const inlineFonts = /(@font-face\{font-family:(?:Pinar|'Pinar VF');src:)url\((?:"|')?data:font\/[^)]+\)(?:\s*format\((?:"|')truetype(?:"|')\))?/gi;
  const fontCount = [...html.matchAll(inlineFonts)].length;
  if (fontCount !== 2) throw Error('Check the updated Studio variable fonts');
  html = html.replace(inlineFonts, "$1url('" + portableFonts + ".woff2') format('woff2'),"
    + "url('" + portableFonts + ".woff') format('woff')");
  const vendor = extractRuntime(html, /<script>(\s*\(function\(\)\{var e=\{9306\(e,t,n\)[\s\S]*?)<\/script>/,
    'studio-vendor');
  const app = extractRuntime(vendor.html, /<script>(\s*\(function\(\)\{var e=Object\.create,t=Object\.defineProperty,[\s\S]*?)<\/script>/,
    page === 'index.html' ? 'studio-student' : 'studio-admin');
  const presentation = app.html.match(/<script src="(\.\/teaching-presentation\.js\?[^"]+)"><\/script>/);
  if (!presentation) throw Error('Check the updated Studio presentation script');
  html = app.html.replace(presentation[0], '');
  html = html.replace(/<script src="(\/academy-assets\/entry-ui\.js)\?/g,
    '<script defer src="$1?');
  const layout = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!layout || layout[1].length < 100000) throw Error('Check the updated Studio workspace styles');
  const layoutFile = storeAsset('studio-layout', layout[1], 'css');
  html = html.replace(layout[0], '<link rel="stylesheet" href="./' + layoutFile + '">');

  const routingHead = page === 'index.html'
    ? "<script>if(new URLSearchParams(location.search).get('portal')==='admin'){location.replace(new URL('./admin.html',location.href));}</script>"
    : '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">';
  const head = routingHead
    + '<link rel="preconnect" href="' + portalOrigin + '" crossorigin>'
    + '<script defer src="./' + clientFile + '" data-portal="' + portal.apiUrl
    + '" data-pdf="./' + pdfFile + '"></script>'
    + '<style>'
    + 'html[data-academy-app="studio"] :is(body,button,input,select,textarea,[role="dialog"],[data-mobile="true"])'
    + '{font-family:"Pinar VF",Pinar,Tahoma,sans-serif}'
    + '#studioEntry [hidden]{display:none!important}#studioEntryMessage:empty{display:none}'
    + '@media(max-width:767px){html[data-academy-app="studio"] body{background-attachment:scroll}'
    + 'html[data-academy-app="studio"] :is(.topbar,.panel,.studio-sidebar [data-slot="sidebar-inner"]){'
    + 'backdrop-filter:none;-webkit-backdrop-filter:none}'
    + 'html[data-academy-app="studio"] #root>section.panel{box-sizing:border-box;max-width:calc(100% - 32px)!important}}'
    + '</style>';
  if (!html.startsWith('<!doctype html>') || !html.includes('<head>')) throw Error('Studio document has no head');
  html = html.replace('<head>', '<head>' + head);
  html = html.replace('</head>', '<link rel="stylesheet" href="./portal.css?v=20261004"></head>');
  const entry = '<script defer src="./' + entryFile + '" data-role="' + role
    + '" data-session-key="' + sessionKey
    + '" data-vendor="./' + vendor.file + '" data-runtime="./' + app.file
    + '" data-presentation="' + presentation[1] + '"></script>';
  html = replaceOnce(html, '<div id="root"></div>', '<div id="root">' + loginMarkup(admin) + '</div>' + entry, 'root');
  await writeFile(join(output, page), html);
}

await mkdir(dirname(join(output, 'index.html')), { recursive: true });
await Promise.all(studioAssets.map(path => cp(join(source, path), join(output, path), { recursive: true })));
await writeFile(join(output, 'portal-config.json'), JSON.stringify(portal, null, 2) + '\n');
for (const page of pages) await buildPage(page);
await Promise.all([...runtimeFiles].map(([file, content]) => writeFile(join(output, file), content)));
