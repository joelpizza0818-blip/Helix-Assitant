from .observer import BrowserObservation


class BrowserStateValidator:
    @staticmethod
    def compare(
        before: BrowserObservation, after: BrowserObservation
    ) -> dict[str, object]:
        changed_fields = [
            field
            for field in ("url", "title", "visible_text", "interactive_controls")
            if getattr(before, field) != getattr(after, field)
        ]
        return {
            "changed": bool(changed_fields),
            "changed_fields": changed_fields,
            "before": {"url": before.url, "title": before.title},
            "after": {"url": after.url, "title": after.title},
        }
