import unittest
from unittest import mock

from backend.tools import desktop_ui


class TestDesktopUiHelpers(unittest.TestCase):
    def test_dedupe_elements_collapses_high_iou_same_label(self):
        elements = [
            {
                "label": "Save",
                "bbox": {"left": 10, "top": 10, "width": 100, "height": 40},
            },
            {
                "label": "Save",
                "bbox": {"left": 11, "top": 10, "width": 100, "height": 40},
            },
            {
                "label": "Cancel",
                "bbox": {"left": 140, "top": 10, "width": 100, "height": 40},
            },
        ]
        out = desktop_ui._dedupe_elements(elements, iou_threshold=0.9)
        self.assertEqual(2, len(out))
        labels = sorted(e["label"] for e in out)
        self.assertEqual(["Cancel", "Save"], labels)

    def test_cap_payload_sets_truncated_when_limit_hit(self):
        payload = {
            "elements": [
                {"label": "Button A", "bbox": {"left": 0, "top": 0, "width": 50, "height": 20}},
                {"label": "Button B", "bbox": {"left": 60, "top": 0, "width": 50, "height": 20}},
                {"label": "Button C", "bbox": {"left": 120, "top": 0, "width": 50, "height": 20}},
            ]
        }
        with mock.patch("backend.tools.desktop_ui.MAX_TOOL_RESULT_JSON_CHARS", 120):
            out = desktop_ui._cap_payload_size(payload)
        self.assertTrue(out["truncated"])
        self.assertLessEqual(len(out["elements"]), 2)


if __name__ == "__main__":
    unittest.main()
