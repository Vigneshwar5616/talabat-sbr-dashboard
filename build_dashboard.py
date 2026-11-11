"""Rebuild dashboard.html from dashboard_template.html, styles.css and the five JavaScript files."""
import pathlib

root = pathlib.Path(__file__).parent
html = (root / "dashboard_template.html").read_text(encoding="utf-8")
css = (root / "styles.css").read_text(encoding="utf-8")
js = "\n".join((root / f).read_text(encoding="utf-8") for f in ["generator.js", "ml.js", "features.js", "charts.js", "app.js"])
assert "</script>" not in js
(root / "dashboard.html").write_text(html.replace("/*CSS*/", css).replace("/*JS*/", js), encoding="utf-8")
print("dashboard.html rebuilt")
