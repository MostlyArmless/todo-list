"""Receipt scanning service using Claude Vision."""

import base64
import logging
from dataclasses import dataclass

import anthropic

from src.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class ParsedReceiptItem:
    """An item parsed from a receipt."""

    name: str
    quantity: str | None = None


class ReceiptService:
    """Service for parsing receipts using Claude Vision."""

    def __init__(self) -> None:
        """Initialize the receipt service."""
        settings = get_settings()
        self.api_key = settings.anthropic_api_key
        self._configured = bool(self.api_key)

    @property
    def is_configured(self) -> bool:
        """Check if the Anthropic API is configured."""
        return self._configured

    async def parse_receipt_image(
        self, image_data: bytes, media_type: str
    ) -> list[ParsedReceiptItem]:
        """Parse a receipt image using Claude Vision.

        Args:
            image_data: Raw bytes of the image
            media_type: MIME type (e.g., "image/jpeg", "image/png")

        Returns:
            List of parsed items from the receipt
        """
        if not self.is_configured:
            raise ValueError("Anthropic API not configured")

        # Encode image to base64
        image_base64 = base64.standard_b64encode(image_data).decode("utf-8")

        client = anthropic.Anthropic(api_key=self.api_key)

        prompt = """Analyze this receipt image and extract all purchased items.

For each item, provide:
1. The item name (cleaned up and normalized - e.g., "ORGANIC MILK 1GAL" -> "Milk")
2. The quantity if visible (e.g., "2" or "1.5 lb")

Return ONLY a JSON array of objects with "name" and "quantity" fields.
Do not include:
- Tax lines
- Total lines
- Store information
- Payment information
- Discounts or coupons

Focus on grocery/food items. Normalize names to be human-readable (capitalize properly, remove SKU codes, expand abbreviations).

Example output:
[
  {"name": "Milk", "quantity": "1"},
  {"name": "Chicken Breast", "quantity": "2 lb"},
  {"name": "Bananas", "quantity": "1 bunch"},
  {"name": "Olive Oil", "quantity": null}
]

Return ONLY the JSON array, no other text."""

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_base64,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
        )

        # Parse the response
        response_text = message.content[0].text.strip()

        # Try to extract JSON from the response
        import json

        try:
            # Handle case where response might have markdown code blocks
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                json_lines = []
                in_json = False
                for line in lines:
                    if line.startswith("```") and not in_json:
                        in_json = True
                        continue
                    elif line.startswith("```") and in_json:
                        break
                    elif in_json:
                        json_lines.append(line)
                response_text = "\n".join(json_lines)

            items_data = json.loads(response_text)

            return [
                ParsedReceiptItem(
                    name=item.get("name", "Unknown"),
                    quantity=item.get("quantity"),
                )
                for item in items_data
                if item.get("name")
            ]

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response as JSON: {e}")
            logger.error(f"Response was: {response_text}")
            raise ValueError(f"Failed to parse receipt: {e}") from e
