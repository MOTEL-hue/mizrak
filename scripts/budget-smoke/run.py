"""בדיקת עשן לתקציב: טוען את מסך התקציב כמו בתוכנה, עובר על כל הלשוניות, ונכשל אם יש שגיאה בדף.
שומר צילומי מסך (רחב וצר) בתיקייה shots, כדי להשוות עיצוב אחרי כל העתקה מהאתר.
הרצה: python3 scripts/budget-smoke/run.py   (נדרש playwright ו-chromium)"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright

root = os.path.dirname(os.path.abspath(__file__))
public = os.path.join(root, '..', '..', 'packages', 'renderer', 'public')
shots = os.path.join(root, 'shots'); os.makedirs(shots, exist_ok=True)
os.makedirs(os.path.join(root, 'budget'), exist_ok=True)
link = os.path.join(root, 'budget')
if os.path.islink(link): os.unlink(link)
elif os.path.isdir(link): os.rmdir(link)
os.symlink(os.path.join(public, 'budget'), link)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', root], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM', '/opt/pw-browsers/chromium'))
        for width in (1500, 420):
            page = browser.new_page(viewport={'width': width, 'height': 800})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://localhost:8765/host.html'); page.wait_for_timeout(2000)
            frame = page.frames[1]
            tabs = frame.evaluate("[...document.querySelectorAll('.bud-nav button[data-tab]')].map(b => b.dataset.tab)")
            for tab in tabs:
                frame.click(f'button[data-tab={tab}]'); page.wait_for_timeout(250)
                page.screenshot(path=os.path.join(shots, f'{width}-{tab}.png'))
            page.close()
        browser.close()
finally:
    srv.terminate()
    if os.path.islink(link): os.unlink(link)
print('שגיאות:', errors or 'אין')
sys.exit(1 if errors else 0)
