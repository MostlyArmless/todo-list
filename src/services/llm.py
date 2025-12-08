"""LLM service for Ollama integration."""

import json
import logging
from typing import Any

import httpx

from src.config import get_settings

logger = logging.getLogger(__name__)


class LLMService:
    """Service for interacting with Ollama LLM."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.base_url = self.settings.ollama_base_url
        self.model = self.settings.llm_model
        self.timeout = 120.0  # 2 minutes for LLM responses

    async def generate(
        self,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.3,
        max_tokens: int = 2048,
    ) -> str:
        """Generate a response from the LLM."""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["message"]["content"]

    async def generate_json(
        self,
        prompt: str,
        system_prompt: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        """Generate structured JSON response from the LLM."""
        try:
            result = await self.generate(
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=temperature,
            )
            # Clean up response - remove markdown code blocks if present
            result = result.strip()
            if result.startswith("```json"):
                result = result[7:]
            if result.startswith("```"):
                result = result[3:]
            if result.endswith("```"):
                result = result[:-3]
            result = result.strip()

            return json.loads(result)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse LLM response as JSON: {e}")
            logger.warning(f"Raw response: {result if 'result' in locals() else 'N/A'}")
            raise
        except httpx.HTTPError as e:
            logger.error(f"HTTP error calling Ollama: {e}")
            raise

    async def health_check(self) -> bool:
        """Check if Ollama is available and the model is loaded."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                models = [m["name"] for m in data.get("models", [])]
                return self.model in models or any(self.model in m for m in models)
        except httpx.HTTPError:
            return False


def get_llm_service() -> LLMService:
    """Get an LLM service instance."""
    return LLMService()
