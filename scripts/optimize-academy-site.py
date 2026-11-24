from hashlib import sha256
import json
from pathlib import Path
import re
import sys


site = Path(sys.argv[1])
font = '<link rel="preload" href="/Academy-Exam/assets/Pinar-VF.woff" as="font" type="font/woff" crossorigin>'
video_api = '<link rel="preconnect" href="https://siwmzffadbbhcyyppwzn.supabase.co" crossorigin>'
stylesheet = re.compile(r'<link rel="stylesheet" href="((?:/|\./)[^"?]+\.css)(?:\?[^"]*)?">')
relative_url = re.compile(r'url\(\s*["\']?(?!/|data:|https:|#)[^"\'/)][^)]*\)', re.I)
entry_mobile_styles = """
@media (hover:none),(pointer:coarse){
  .mofid-gradient-pointer{display:none}
  .mofid-gradient-blobs{filter:blur(20px)}
  .mofid-gradient-blob{animation:none}
  .mofid-metal{animation:none!important}
  .academy-module,.academy-navigation,.academy-top-light{backdrop-filter:none;-webkit-backdrop-filter:none}
}
html[data-academy-app] :is(button,input,select,textarea){font-family:"Pinar VF",Tahoma,sans-serif}
"""
exam_loading_style = """
@font-face{font-family:"Pinar VF";src:url("/Academy-Exam/assets/Pinar-VF.woff") format("woff");font-weight:300 900;font-display:swap}
#examEntry{font:400 1rem/1.9 "Pinar VF",Tahoma,sans-serif;max-width:34rem;margin:10vh auto;padding:1.5rem;
  background:#fafffc;border:1px solid #c4ddce;border-radius:1.25rem;box-sizing:border-box}
#examEntry header{display:flex;align-items:center;gap:.6rem}#examEntry h1{font-size:1.5rem}
#examEntry input{display:block;box-sizing:border-box;width:100%;padding:.7rem;border:1px solid #b5d9c8;
  border-radius:.65rem;color:#164d3b;background:white;font:inherit}
#examEntry button{font:inherit;padding:.45rem 1rem;margin-top:.75rem;border:1px solid #a8d1bd;border-radius:.6rem}
#examEntry button:not([disabled]){color:white;background:#0b766b;cursor:pointer}
"""
exam_loading_markup = """
<main id="examEntry">
  <header><img src="/Academy-Exam/assets/mofid-academy-logo.webp" alt="" width="48" height="48">
    <strong>آکادمی مفید | سامانه آزمون</strong></header>
  <h1>سلام، خوش آمدید</h1>
  <label for="examEntryName">نام سازمانی</label>
  <input type="text" id="examEntryName" placeholder="m.mirsheri" autocomplete="name">
  <p id="examEntryStatus" role="status">در حال دریافت سؤال‌ها و زمان‌بندی آزمون…</p>
  <button type="button" disabled>شروع آزمون</button>
  <button id="examEntryRetry" type="button" hidden>تلاش دوباره</button>
</main>
"""


def checked_replace(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"Check the updated exam entry around {before[:65]}")
    return text.replace(before, after, 1)


def enable_exam_entry(text):
    text = checked_replace(text, "</style></head><body><p", exam_loading_style + "</style></head><body><p")
    text, matched = re.subn(r"<body><p[^>]*>در حال آماده‌سازی آزمون…</p>", "<body>" + exam_loading_markup, text, count=1)
    if matched != 1:
        raise ValueError("Check the updated exam opening panel")
    text = checked_replace(
        text, '(async()=>{\n// Re-read', 'async function loadExam(){\n// Re-read'
    )
    text = checked_replace(
        text,
        """  const [baseR,tR,visual]=await Promise.all([
    fetch('base.html?v='+Date.now(),{cache:'no-store'}),
    readLiveTiming(),
    visualAssets()
  ]);
  if(!baseR.ok) throw new Error('base '+baseR.status);
  let base=await baseR.text();""",
        """  async function readHTML(url, cache, timeout){
    const response=await fetch(url,{cache,credentials:'omit',signal:AbortSignal.timeout(timeout)});
    if(!response.ok)throw Error('Exam HTTP '+response.status);
    return response.text();
  }
  async function readBank(){
    let snapshot;
    const readSnapshot=()=>snapshot??=readHTML(assetURL('base.html'),'force-cache',8000).catch(()=>null);
    // Begin the bundled copy while a slow live download is still in progress.
    const timer=setTimeout(readSnapshot,900);
    try{
      return await readHTML('https://mofid-academy.github.io/Academy-Exam/base.html?v='+Date.now(),'no-store',5000);
    }catch{
      const html=await readSnapshot();
      if(!html)throw Error('سؤال‌های آزمون دریافت نشدند.');
      return html;
    }finally{clearTimeout(timer);}
  }
  let [base,tR,visual]=await Promise.all([readBank(),readLiveTiming(),visualAssets()]);"""
    )
    text = checked_replace(text, "  const cfg=tR;", """  const cfg=tR;
  const draftName=document.getElementById('examEntryName').value.trim();""")
    text = checked_replace(text, ";(()=>{\nconst cfg=", r""";(()=>{
if(!name)name=${JSON.stringify(draftName).replace(/</g,'\\u003c')};
const cfg=""")
    text = checked_replace(text, "setTimeout(()=>refreshTiming(),0);\n", "")
    text, matched = re.subn(
        r"\}\)\(\)\.catch\(e=>\{document\.body\.innerHTML=.*?console\.error\(e\);\}\);",
        """}
const retry=document.getElementById('examEntryRetry'), status=document.getElementById('examEntryStatus');
async function beginExam(){
  retry.hidden=true;
  status.textContent='در حال دریافت سؤال‌ها و زمان‌بندی آزمون…';
  try{await loadExam();}
  catch(e){status.textContent='بارگیری آزمون کامل نشد. دوباره تلاش کنید.';retry.hidden=false;console.error(e);}
}
retry.addEventListener('click',beginExam);
void beginExam();""",
        text, count=1
    )
    if matched != 1:
        raise ValueError("Check the updated exam loading error handler")
    return text


def optimize_entry(path):
    page = site / path
    if not page.is_file():
        return
    markup = page.read_text(encoding="utf-8")
    matches = list(stylesheet.finditer(markup))
    if not matches:
        return
    paths = [link.group(1) for link in matches]
    styles = [
        ((site if href.startswith("/") else page.parent) / href.lstrip("./"))
        .read_text(encoding="utf-8")
        for href in paths
    ]
    if any("@import" in style or relative_url.search(style) for style in styles):
        raise ValueError(f"Check stylesheet paths before bundling {path}")

    css = "\n".join(styles) + entry_mobile_styles
    revision = sha256(css.encode()).hexdigest()[:12]
    bundle = f"/academy-assets/entry-{revision}.css"
    (site / bundle.lstrip("/")).write_text(css, encoding="utf-8")
    position = 0

    def use_bundle(link):
        nonlocal position
        position += 1
        return f'<link rel="stylesheet" href="{bundle}">' if position == 1 else ""

    markup = stylesheet.sub(use_bundle, markup)
    theme = (site / "academy-assets/theme.js").read_text(encoding="utf-8")
    if "</script" in theme.lower():
        raise ValueError("Theme startup code must be safe in the head")
    # Run the theme before first paint without a render-blocking network script.
    markup = re.sub(
        r'<script src="/academy-assets/theme\.js\?[^"]+"></script>',
        lambda _: f"<script>{theme}</script>",
        markup,
        count=1,
    )
    preload = "" if path.startswith("learning-studio/") else font
    if path.startswith("videoo/"):
        preload += video_api
    page.write_text(markup.replace("<head>", "<head>\n" + preload, 1), encoding="utf-8")


def optimize_exam():
    path = site / "Academy-Exam"
    public_network = path / "public-network.js"
    if not public_network.is_file():
        return
    network = checked_replace(
        public_network.read_text(encoding="utf-8"),
        'new URL(".", document.currentScript.src)',
        'new URL(".", new URL("/Academy-Exam/public-network.js", location.href))',
    )
    if "</script" in network.lower():
        raise ValueError("The timing client must be safe inside a script")
    visual = json.dumps({
        "css": (path / "exam-skin.css").read_text(encoding="utf-8"),
        "script": (path / "exam-visual.js").read_text(encoding="utf-8"),
    }, ensure_ascii=False).replace("<", "\\u003c")
    build_stamp = sha256()
    build_stamp.update(Path(__file__).read_bytes())
    for asset in sorted(path.rglob("*")):
        if asset.is_file() and asset.name != "timing.json":
            build_stamp.update(asset.relative_to(path).as_posix().encode())
            build_stamp.update(asset.read_bytes())
    revision = build_stamp.hexdigest()[:12]

    for name, flag in [
        ("index.html", "__ACADEMY_PUBLIC_ENTRY_REFRESHED__"),
        ("Admin/secure.html", "__ACADEMY_ADMIN_ENTRY_REFRESHED__"),
    ]:
        page = path / name
        text = page.read_text(encoding="utf-8")
        refresh = r"if\(!window\." + flag + r"\)\{\s*try\{[\s\S]*?\n window\." + flag + r"=true;\n\}\n"
        text, removed = re.subn(refresh, "", text, count=1)
        if removed != 1:
            raise ValueError(f"Check the updated exam entry in {name}")
        text, changed = re.subn(r"const loadStamp=[^\n]+;", "const loadStamp='" + revision + "';", text, count=1)
        if changed != 1:
            raise ValueError(f"Check the updated exam asset versions in {name}")
        # The timing client and appearance are build assets. Keep their reads
        # out of the request chain for the live bank and timing configuration.
        network_path = "../public-network.js" if name.startswith("Admin/") else "public-network.js"
        network_loader = re.compile(
            r"^await new Promise\(\(resolve,reject\)=>\{const script=document\.createElement\('script'\);"
            + r"script\.src=assetURL\('" + re.escape(network_path) + r"'\);[^\n]*\}\);$",
            re.M,
        )
        text, networks = network_loader.subn(lambda _: network, text, count=1)
        text, visuals = re.subn(
            r"async function visualAssets\(\)\{\n try\{[\s\S]*?\n\}",
            lambda _: "function visualAssets(){return " + visual + ";}",
            text, count=1,
        )
        if networks != 1 or visuals != 1:
            raise ValueError(f"Check the updated exam startup in {name}")

        # The admin's base is static loader code. Participant banks and timing remain live.
        if name.startswith("Admin/"):
            text = text.replace(
                "fetch('base.html?v='+Date.now(),{cache:'no-store'})",
                "fetch(assetURL('base.html'),{cache:'force-cache'})",
                1,
            )
        else:
            text = enable_exam_entry(text)
        if 'rel="preload" href="../assets/Pinar-VF.woff"' not in text:
            connections = (
                '<link rel="preconnect" href="https://mofid-academy.github.io" crossorigin>'
                '<link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin>'
            )
            text = text.replace("<head>", "<head>" + font + connections, 1)
        page.write_text(text, encoding="utf-8")

    admin_entry = path / "Admin" / "index.html"
    markup = admin_entry.read_text(encoding="utf-8")
    timestamp = "<script>document.getElementById('studio').src='secure.html?v=m20261010&ts='+Date.now();</script>"
    if markup.count(timestamp) != 1:
        raise ValueError("Check the updated exam admin frame")
    markup = markup.replace(timestamp + "\n", "")
    markup = markup.replace('<iframe id="studio"', f'<iframe src="secure.html?v={revision}" id="studio"', 1)
    admin_entry.write_text(markup, encoding="utf-8")

    admin_base = path / "Admin" / "base.html"
    markup = admin_base.read_text(encoding="utf-8")
    markup = markup.replace(
        'href="https://mofid-academy.github.io/Academy-Exam/"',
        'href="/Academy-Exam/"',
        1,
    )
    admin_base.write_text(markup, encoding="utf-8")

for entry in (
    "index.html",
    "videoo/index.html",
    "videoo/admin.html",
    "learning-studio/index.html",
    "learning-studio/admin.html",
):
    optimize_entry(entry)
optimize_exam()
