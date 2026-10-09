import time
import win32gui
import win32con
import win32clipboard
import win32com.client

hwnds = []
def enum_windows_callback(hwnd, results):
    if win32gui.IsWindowVisible(hwnd):
        title = win32gui.GetWindowText(hwnd)
        if 'QUIZ ABOUT HOW TO IMPROVE YOUR ENGLISH' in title:
            results.append(hwnd)

win32gui.EnumWindows(enum_windows_callback, hwnds)
if hwnds:
    hwnd = hwnds[0]
    print('Found hwnd:', hwnd)
    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
    win32gui.SetForegroundWindow(hwnd)
    time.sleep(0.5)
    
    shell = win32com.client.Dispatch('WScript.Shell')
    shell.SendKeys('^a')
    time.sleep(0.5)
    shell.SendKeys('^c')
    time.sleep(1)
    
    win32clipboard.OpenClipboard()
    try:
        data = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
        print('Clipboard length:', len(data))
        with open('form_text.txt', 'w', encoding='utf-8') as f:
            f.write(data)
        print('Saved successfully!')
    except Exception as e:
        print('Clipboard error:', e)
    finally:
        win32clipboard.CloseClipboard()
else:
    print('Window not found')