from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BrowserObservation:
    url: str
    title: str
    visible_text: str
    interactive_controls: str

    def to_text(self, max_chars: int = 12000) -> str:
        snapshot = f"URL: {self.url}\nTitle: {self.title}\n\n{self.visible_text}"
        if self.interactive_controls:
            snapshot += f"\n\nInteractive controls:\n{self.interactive_controls}"
        return snapshot[:max_chars]


class BrowserObserver:
    def __init__(self, page: Any):
        self._page = page

    async def observe(self) -> BrowserObservation:
        visible_text = await self._page.locator("body").inner_text()
        controls = await self._page.locator(
            "a, button, input, textarea, select, "
            "[role='button'], [role='checkbox'], [role='radio'], [role='switch'], "
            "[role='link'], [role='tab'], [role='menuitem'], [role='option'], "
            "[role='slider'], [role='combobox'], [role='listbox'], [role='textbox'], "
            "[tabindex='0']"
        ).evaluate_all(
            """elements => {
                let count = 0;
                const result = [];
                for (const element of elements) {
                    if (count >= 100) break;
                    const rect = element.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) continue;
                    const style = window.getComputedStyle(element);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

                    element.setAttribute('data-helix-control', String(count));
                    const labelledBy = (element.getAttribute('aria-labelledby') || '')
                        .split(/\\s+/)
                        .filter(Boolean)
                        .map(id => document.getElementById(id)?.textContent?.trim() || '')
                        .filter(Boolean)
                        .join(' ');
                    const associatedLabels = Array.from(element.labels || [])
                        .map(label => (label.innerText || label.textContent || '').trim())
                        .filter(Boolean)
                        .join(' ');
                    const label = (labelledBy
                        || element.getAttribute('aria-label')
                        || associatedLabels
                        || element.innerText
                        || element.getAttribute('placeholder')
                        || element.getAttribute('title')
                        || element.getAttribute('value')
                        || '').replace(/\\s+/g, ' ').trim().slice(0, 60);

                    const cx = Math.round(rect.left + rect.width / 2);
                    const cy = Math.round(rect.top + rect.height / 2);
                    const tag = element.tagName.toLowerCase();
                    const typeAttr = element.getAttribute('type') ? `[type=${element.getAttribute('type')}]` : '';
                    const role = element.getAttribute('role')
                        || (tag === 'a' && element.hasAttribute('href') ? 'link'
                            : tag === 'button' ? 'button'
                            : tag === 'textarea' ? 'textbox'
                            : tag === 'select' ? (element.multiple ? 'listbox' : 'combobox')
                            : tag === 'input'
                                ? (['button', 'submit', 'reset', 'image'].includes(element.type)
                                    ? 'button'
                                    : element.type === 'range' ? 'slider'
                                    : element.type === 'number' ? 'spinbutton'
                                    : element.type === 'search' ? 'searchbox'
                                    : ['checkbox', 'radio'].includes(element.type)
                                        ? element.type
                                        : 'textbox')
                                : 'generic');
                    const states = [];
                    if (element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') states.push('disabled');
                    const nativeCheckable = tag === 'input'
                        && ['checkbox', 'radio'].includes(element.type);
                    if (nativeCheckable) states.push(`checked=${element.checked}`);
                    else if (element.getAttribute('aria-checked') !== null) states.push(`checked=${element.getAttribute('aria-checked')}`);
                    if (element.getAttribute('aria-expanded') !== null) states.push(`expanded=${element.getAttribute('aria-expanded')}`);
                    if (element.getAttribute('aria-pressed') !== null) states.push(`pressed=${element.getAttribute('aria-pressed')}`);
                    if (element.getAttribute('aria-selected') !== null) states.push(`selected=${element.getAttribute('aria-selected')}`);
                    if (element.required || element.getAttribute('aria-required') === 'true') states.push('required');
                    if (element.getAttribute('aria-invalid') === 'true') states.push('invalid');

                    result.push(`[${count}] selector=[data-helix-control="${count}"] role=${role} ${tag}${typeAttr} "${label}"${states.length ? ` [${states.join(', ')}]` : ''} at (${cx}, ${cy})`);
                    count++;
                }
                return result.join('\\n');
            }"""
        )
        return BrowserObservation(
            url=self._page.url,
            title=await self._page.title(),
            visible_text=visible_text,
            interactive_controls=controls,
        )

    async def screenshot(self) -> bytes:
        await self._page.wait_for_timeout(150)
        return await self._page.screenshot(type="jpeg", quality=75, full_page=False)
