import logging
from typing import Any


logger = logging.getLogger(__name__)


class BrowserInputController:
    def __init__(self, page: Any):
        self._page = page

    def uses_page(self, page: Any) -> bool:
        return self._page is page

    def _require_page(self):
        if not self._page:
            raise RuntimeError("Browser not started")
        return self._page

    def locator_for_selector(self, selector: str, *, prefer_css: bool = False):
        page = self._require_page()
        if selector.startswith("text="):
            text = selector.split("=", 1)[1].strip()
            if not text:
                raise ValueError("A visible text label is required after 'text='.")
            return page.get_by_text(text, exact=True).first
        if selector.startswith("label="):
            label = selector.split("=", 1)[1].strip()
            if not label:
                raise ValueError("A form label is required after 'label='.")
            return page.get_by_label(label).first
        if selector.isdecimal():
            selector = f'[data-helix-control="{selector}"]'
        if selector.startswith((
            "css=", "#", ".", "[", "//", "button", "a[href", "input",
            "select", "textarea", "form", "label",
        )):
            if selector.startswith("css="):
                selector = selector[4:]
            return page.locator(selector).first
        if prefer_css:
            return page.locator(selector).first
        return page.get_by_text(selector, exact=True).first

    async def _show_virtual_cursor_for_locator(self, locator: Any) -> None:
        await locator.wait_for(state="visible")
        box = await locator.bounding_box()
        if box is None:
            raise RuntimeError("The browser target has no visible position for the virtual cursor.")
        cx = int(box["x"] + box["width"] / 2)
        cy = int(box["y"] + box["height"] / 2)
        await self._show_virtual_cursor(cx, cy, clicked=True)

    async def click(self, selector: str):
        page = self._require_page()
        logger.info("Clicking browser target: %s", selector)
        locator = self.locator_for_selector(selector)
        await self._show_virtual_cursor_for_locator(locator)
        await locator.click()

    async def validate_mouse_coordinates(self, x: int, y: int) -> None:
        page = self._require_page()
        viewport = page.viewport_size
        if viewport is None:
            viewport = await page.evaluate(
                "() => ({ width: window.innerWidth, height: window.innerHeight })"
            )
        if not (0 <= x < viewport["width"] and 0 <= y < viewport["height"]):
            raise ValueError(
                f"Coordinates ({x}, {y}) are outside the page viewport "
                f"({viewport['width']} x {viewport['height']})."
            )

    async def _show_virtual_cursor(self, x: int, y: int, *, clicked: bool = False) -> None:
        page = self._require_page()
        await page.evaluate(
            """({ x, y, clicked }) => {
                if (typeof window.__helixMoveCursor !== 'function') {
                    throw new Error('The browser virtual cursor is not installed.');
                }
                window.__helixMoveCursor(x, y);
                if (clicked) {
                    if (typeof window.__helixClickCursor !== 'function') {
                        throw new Error('The browser click indicator is not installed.');
                    }
                    window.__helixClickCursor(x, y);
                }
            }""",
            {"x": x, "y": y, "clicked": clicked},
        )

    async def move_mouse(self, x: int, y: int) -> None:
        page = self._require_page()
        await self.validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y)
        await page.mouse.move(x, y, steps=8)

    async def click_at(self, x: int, y: int, button: str = "left") -> None:
        page = self._require_page()
        await self.validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y, clicked=True)
        await page.mouse.click(x, y, button=button)

    async def double_click_at(self, x: int, y: int) -> None:
        page = self._require_page()
        await self.validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y, clicked=True)
        await page.mouse.dblclick(x, y)

    async def drag(self, x: int, y: int, end_x: int, end_y: int) -> None:
        page = self._require_page()
        await self.validate_mouse_coordinates(x, y)
        await self.validate_mouse_coordinates(end_x, end_y)
        await self._show_virtual_cursor(x, y)
        await page.mouse.move(x, y, steps=8)
        await page.mouse.down()
        try:
            await self._show_virtual_cursor(end_x, end_y)
            await page.mouse.move(end_x, end_y, steps=12)
        finally:
            await page.mouse.up()

    async def scroll_at(self, x: int, y: int, direction: str, amount: int) -> None:
        page = self._require_page()
        await self.validate_mouse_coordinates(x, y)
        await self._show_virtual_cursor(x, y)
        await page.mouse.move(x, y, steps=8)
        delta_x = amount if direction == "right" else -amount if direction == "left" else 0
        delta_y = amount if direction == "down" else -amount if direction == "up" else 0
        await page.mouse.wheel(delta_x, delta_y)

    async def click_text(self, text: str):
        page = self._require_page()
        logger.info("Clicking text: %s", text)
        locator = page.get_by_text(text).first
        await self._show_virtual_cursor_for_locator(locator)
        await locator.click()

    async def type_text(self, selector: str, text: str) -> str:
        page = self._require_page()
        logger.info("Typing into %s", selector)
        locator = self.locator_for_selector(selector, prefer_css=True)
        await self._show_virtual_cursor_for_locator(locator)
        await locator.click()
        element_type = await locator.evaluate(
            "(element) => element.tagName.toLowerCase()"
        )
        if element_type == "select":
            selection = await locator.evaluate(
                """(element, requested) => {
                    const matches = Array.from(element.options)
                        .map((option, index) => ({ option, index }))
                        .filter(({ option }) => (
                            !option.disabled && !option.parentElement?.hasAttribute('disabled')
                        ))
                        .filter(({ option }) => (
                            option.value === requested
                            || option.label === requested
                            || option.textContent?.trim() === requested
                        ));
                    return {
                        multiple: element.multiple,
                        match_count: matches.length,
                        index: matches[0]?.index ?? null,
                        value: matches[0]?.option.value ?? null,
                    };
                }""",
                text,
            )
            if isinstance(selection, dict) and selection.get("multiple") is True:
                raise ValueError("Multi-select dropdowns are not supported.")
            if not isinstance(selection, dict) or selection.get("match_count") != 1:
                raise ValueError(
                    "The dropdown value must match exactly one enabled option."
                )
            selected_index = selection.get("index")
            selected_value = selection.get("value")
            if (
                not isinstance(selected_index, int)
                or isinstance(selected_index, bool)
                or not isinstance(selected_value, str)
            ):
                raise RuntimeError("The selected dropdown option has no valid value.")
            await locator.select_option(index=selected_index)
            actual_index = await locator.evaluate(
                "(element) => element.selectedIndex"
            )
            actual_value = await locator.input_value()
            if actual_index != selected_index or actual_value != selected_value:
                raise RuntimeError(
                    "The dropdown did not retain the requested option."
                )
            return "select"

        await locator.fill(text)
        actual_value = await locator.evaluate(
            """(element) => (
                'value' in element
                    ? element.value
                    : element.isContentEditable
                        ? element.innerText
                        : null
            )"""
        )
        if actual_value != text:
            raise RuntimeError("The selected control did not retain the requested text.")
        return "text"

    async def scroll(self, direction: str, amount: int):
        page = self._require_page()
        viewport = page.viewport_size
        if viewport is None:
            viewport = await page.evaluate(
                "() => ({ width: window.innerWidth, height: window.innerHeight })"
            )
        x = viewport["width"] // 2
        y = viewport["height"] // 2
        await self._show_virtual_cursor(x, y)
        await page.mouse.move(x, y, steps=8)
        delta_x = amount if direction == "right" else -amount if direction == "left" else 0
        delta_y = amount if direction == "down" else -amount if direction == "up" else 0
        await page.mouse.wheel(delta_x, delta_y)

    async def press_key(self, key: str):
        await self._require_page().keyboard.press(key)
