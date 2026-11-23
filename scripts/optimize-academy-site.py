from hashlib import sha256
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
        # Download the form and appearance while the timing client starts.
        network_path = "../public-network.js" if name.startswith("Admin/") else "public-network.js"
        network_loader = (
            "await new Promise((resolve,reject)=>{const script=document.createElement('script');"
            f"script.src=assetURL('{network_path}')"
        )
        if text.count(network_loader) != 1 or text.count("    readLiveTiming(),") != 1:
            raise ValueError(f"Check the updated exam startup in {name}")
        text = text.replace(network_loader, network_loader.replace("await ", "const networkReady="), 1)
        text = text.replace("    readLiveTiming(),", "    networkReady.then(()=>readLiveTiming()),", 1)
        test_mode = "if(new URL(location.href).searchParams.get('academy-test')==='1'){"
        text = text.replace(test_mode, test_mode + "\n await networkReady;", 1)
        text = text.replace(
            "const options={cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(8000)};",
            "const options={cache:'force-cache',credentials:'omit',signal:AbortSignal.timeout(8000)};",
            1,
        )

        # The admin's base is static loader code. Participant banks and timing remain live.
        if name.startswith("Admin/"):
            text = text.replace(
                "fetch('base.html?v='+Date.now(),{cache:'no-store'})",
                "fetch(assetURL('base.html'),{cache:'force-cache'})",
                1,
            )
        if 'rel="preload" href="../assets/Pinar-VF.woff"' not in text:
            text = text.replace("<head>", "<head>" + font, 1)
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
