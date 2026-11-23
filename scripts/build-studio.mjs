import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const [source, output, client] = process.argv.slice(2);
const origin = 'https://emofidacademy.ir';
const portableFont = '/Academy-Exam/assets/Pinar-VF.woff';
const pages = ['index.html', 'admin.html'];
const studioAssets = [
  'academy-skin.css', 'portal.css', 'portal-config.json', 'presentation-preview.html',
  'studio-routing.js', 'teaching-presentation.js', 'pdf',
];
const runtimeFiles = new Map();
const [routing, loader] = await Promise.all(
  ['studio-routing.js', 'studio-loader.js'].map(file => readFile(join(source, file), 'utf8')),
);
const portal = JSON.parse(await readFile(join(source, 'portal-config.json'), 'utf8'));
if (portal.enabled !== true || portal.apiUrl !== 'https://stodiomof.app.n8n.cloud/webhook/mofid-learning-portal') {
  throw Error('Check the Studio portal configuration before publishing a different API.');
}

function replaceOnce(text, before, after, name) {
  if (text.split(before).length !== 2) throw Error('Check the updated Studio ' + name);
  return text.replace(before, after);
}

function deferRuntime(text, pattern, name) {
  const matched = text.match(pattern);
  if (!matched) throw Error('Check the updated Studio ' + name);
  const file = name + '-' + createHash('sha256').update(matched[1]).digest('hex').slice(0, 12) + '.js';
  runtimeFiles.set(file, matched[1]);
  return text.replace(matched[0], '<script defer src="./' + file + '"></script>');
}

async function buildPage(page) {
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
  const pdfFile = 'pdf-assets-' + createHash('sha256').update(pdf[1]).digest('hex').slice(0, 12) + '.js';
  runtimeFiles.set(pdfFile, pdf[1]);
  let html = outputHtml.replace(pdf[0], '');
  html = replaceOnce(html, 'o=globalThis.__MOFID_PDF_BINARIES;class',
    'o=await window.MofidStudioDomain.loadPdfAssets();class', 'PDF loader');
  html = replaceOnce(html,
    "fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload,token:mofidPortalToken}),cache:'no-store'})",
    'window.MofidStudioDomain.request({action,...payload,token:mofidPortalToken})', 'portal transport');

  const inlineFonts = /(@font-face\{font-family:(?:Pinar|'Pinar VF');src:)url\((?:"|')?data:font\/[^)]+\)(?:\s*format\((?:"|')truetype(?:"|')\))?/gi;
  const fontCount = [...html.matchAll(inlineFonts)].length;
  if (fontCount !== 2) throw Error('Check the updated Studio variable fonts');
  html = html.replace(inlineFonts, "$1url('" + portableFont + "') format('woff')");
  html = deferRuntime(html, /<script>(\s*\(function\(\)\{var e=\{9306\(e,t,n\)[\s\S]*?)<\/script>/,
    'studio-vendor');
  html = deferRuntime(html, /<script>(\s*\(function\(\)\{var e=Object\.create,t=Object\.defineProperty,[\s\S]*?)<\/script>/,
    page === 'index.html' ? 'studio-student' : 'studio-admin');
  html = html.replace(/<script src="(\/academy-assets\/entry-ui\.js|\.\/teaching-presentation\.js)\?/g,
    '<script defer src="$1?');

  const routingHead = page === 'index.html'
    ? "<script>if(new URLSearchParams(location.search).get('portal')==='admin'){location.replace(new URL('./admin.html',location.href));}</script>"
    : '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">';
  const head = routingHead
    + '<link rel="preload" as="font" type="font/woff" crossorigin href="' + portableFont + '">'
    + '<script defer src="./studio-domain-client.js" data-pdf="./' + pdfFile + '"></script>'
    + '<style>'
    + 'html[data-academy-app="studio"] :is(body,button,input,select,textarea,[role="dialog"],[data-mobile="true"])'
    + '{font-family:"Pinar VF",Pinar,Tahoma,sans-serif}'
    + '@media(max-width:767px){html[data-academy-app="studio"] body{background-attachment:scroll}'
    + 'html[data-academy-app="studio"] :is(.topbar,.panel,.studio-sidebar [data-slot="sidebar-inner"]){'
    + 'backdrop-filter:none;-webkit-backdrop-filter:none}'
    + 'html[data-academy-app="studio"] #root>section.panel{box-sizing:border-box;max-width:calc(100% - 32px)!important}}'
    + '</style>';
  if (!html.startsWith('<!doctype html>') || !html.includes('<head>')) throw Error('Studio document has no head');
  html = html.replace('<head>', '<head>' + head);
  await writeFile(join(output, page), html);
}

await mkdir(dirname(join(output, 'index.html')), { recursive: true });
await Promise.all(studioAssets.map(path => cp(join(source, path), join(output, path), { recursive: true })));
await cp(client, join(output, 'studio-domain-client.js'));
for (const page of pages) await buildPage(page);
await Promise.all([...runtimeFiles].map(([file, content]) => writeFile(join(output, file), content)));
