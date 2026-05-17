"AI management for Blueprint Studio — thin orchestrator."
from __future__ import annotations

import logging
import re
import json
import time
from typing import Any
import aiohttp

from aiohttp import web
from homeassistant.core import HomeAssistant

from .util import json_response, json_message
from .ai_constants import DOMAIN_ACTIONS
from .ai_validators import check_syntax as _check_syntax, check_yaml, check_jinja
from .ai_nlp import (
    detect_domain, extract_area, find_best_entities,
    extract_conditions, extract_values, detect_additional_actions,
    detect_trigger_type, extract_automation_name, find_multi_domain_entities,
)
from .ai_generators import (
    build_data_block, build_conditions_yaml, build_target_yaml,
    generate_multi_intent_automation, generate_single_intent_automation,
    generate_multi_domain_automation, build_sun_trigger_yaml,
    get_scene_defaults, get_scene_icon, get_scene_description,
    get_script_description,
)

_LOGGER = logging.getLogger(__name__)


class AIManager:
    """Class to handle AI operations with advanced natural language understanding."""

    def __init__(self, hass: HomeAssistant | None, data: dict) -> None:
        """Initialize AI manager."""
        self.hass = hass
        self.data = data

    def check_syntax(self, content: str, file_path: str = "") -> web.Response:
        """Universal syntax checker — delegates to ai_validators."""
        return _check_syntax(content, file_path)

    def check_yaml(self, content: str, strict_mode: bool = True) -> web.Response:
        """Check YAML syntax — delegates to ai_validators."""
        return check_yaml(content, strict_mode)

    def check_jinja(self, content: str) -> web.Response:
        """Check Jinja2 syntax — delegates to ai_validators."""
        return check_jinja(content)

    def check_json(self, content: str) -> web.Response:
        """Check JSON syntax — delegates to ai_validators."""
        from .ai_validators import check_json
        return check_json(content)

    def check_python(self, content: str) -> web.Response:
        """Check Python syntax — delegates to ai_validators."""
        from .ai_validators import check_python
        return check_python(content)

    def check_javascript(self, content: str) -> web.Response:
        """Check JavaScript syntax — delegates to ai_validators."""
        from .ai_validators import check_javascript
        return check_javascript(content)

    def _build_openai_compatible_url(self, base_url: str | None, default_base: str) -> str:
        """Normalize a base URL or endpoint into an OpenAI-compatible chat completions URL."""
        raw_url = (base_url or default_base or "").strip().rstrip("/")
        if not raw_url:
            return ""

        lower_url = raw_url.lower()
        if lower_url.endswith("/v1/chat/completions") or lower_url.endswith("/chat/completions"):
            return raw_url
        if lower_url.endswith("/v1"):
            return f"{raw_url}/chat/completions"
        return f"{raw_url}/v1/chat/completions"

    def _build_openai_models_url(self, base_url: str | None, default_base: str) -> str:
        """Normalize a base URL or endpoint into an OpenAI-compatible models URL."""
        raw_url = (base_url or default_base or "").strip().rstrip("/")
        if not raw_url:
            return ""

        lower_url = raw_url.lower()
        if lower_url.endswith("/v1/models") or lower_url.endswith("/models"):
            return raw_url
        if lower_url.endswith("/v1/chat/completions"):
            return raw_url[:-len("/chat/completions")] + "/models"
        if lower_url.endswith("/chat/completions"):
            return raw_url[: -len("/chat/completions")] + "/models"
        if lower_url.endswith("/v1"):
            return f"{raw_url}/models"
        return f"{raw_url}/v1/models"

    def _build_ollama_url(self, base_url: str | None) -> str:
        """Normalize an Ollama base URL into its chat endpoint."""
        raw_url = (base_url or "http://localhost:11434").strip().rstrip("/")
        if not raw_url:
            return ""

        if raw_url.lower().endswith("/api/chat"):
            return raw_url
        return f"{raw_url}/api/chat"

    def _build_ollama_models_url(self, base_url: str | None) -> str:
        """Normalize an Ollama base URL into its model tags endpoint."""
        raw_url = (base_url or "http://localhost:11434").strip().rstrip("/")
        if not raw_url:
            return ""

        lower_url = raw_url.lower()
        if lower_url.endswith("/api/tags"):
            return raw_url
        if lower_url.endswith("/api/chat"):
            return raw_url[: -len("/api/chat")] + "/api/tags"
        return f"{raw_url}/api/tags"

    def _extract_text_content(self, payload: Any) -> str:
        """Extract plain text from the common provider response shapes."""
        if isinstance(payload, str):
            return payload

        if isinstance(payload, list):
            parts: list[str] = []
            for item in payload:
                text = self._extract_text_content(item)
                if text:
                    parts.append(text)
            return "\n".join(parts).strip()

        if isinstance(payload, dict):
            payload_type = payload.get("type")
            if payload_type in {"text", "output_text"} and isinstance(payload.get("text"), str):
                return payload["text"]

            for key in ("text", "content"):
                text = self._extract_text_content(payload.get(key))
                if text:
                    return text

        return ""

    async def _post_json_request(
        self,
        provider_label: str,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        parse_fn,
    ) -> web.Response:
        """Execute an HTTP JSON request and normalize success/error handling."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                async with session.post(url, headers=headers, json=payload) as response:
                    response_text = await response.text()
                    try:
                        response_data: Any = json.loads(response_text) if response_text else {}
                    except json.JSONDecodeError:
                        response_data = {}

                    if response.status != 200:
                        error_detail = ""
                        if isinstance(response_data, dict):
                            if isinstance(response_data.get("error"), dict):
                                error_detail = response_data["error"].get("message", "")
                            elif response_data.get("error"):
                                error_detail = str(response_data.get("error"))
                            elif response_data.get("message"):
                                error_detail = str(response_data.get("message"))
                        if not error_detail and response_text:
                            error_detail = response_text[:300]

                        message = f"{provider_label} Error: {response.status}"
                        if error_detail:
                            message = f"{message} - {error_detail}"
                        return json_message(message, status_code=response.status)

                    parsed = parse_fn(response_data)
                    if not parsed:
                        raise ValueError(f"{provider_label} returned an empty response")

                    return json_response({"success": True, "response": parsed})
        except Exception as err:
            _LOGGER.error("%s API error: %s", provider_label, err)
            return json_message(f"API error: {str(err)}", status_code=500)

    async def _get_json_payload(
        self,
        provider_label: str,
        url: str,
        headers: dict[str, str],
    ) -> tuple[Any | None, web.Response | None]:
        """Execute an HTTP GET request and return decoded JSON or an error response."""
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                async with session.get(url, headers=headers) as response:
                    response_text = await response.text()
                    try:
                        response_data: Any = json.loads(response_text) if response_text else {}
                    except json.JSONDecodeError:
                        response_data = {}

                    if response.status != 200:
                        error_detail = ""
                        if isinstance(response_data, dict):
                            if isinstance(response_data.get("error"), dict):
                                error_detail = response_data["error"].get("message", "")
                            elif response_data.get("error"):
                                error_detail = str(response_data.get("error"))
                            elif response_data.get("message"):
                                error_detail = str(response_data.get("message"))
                        if not error_detail and response_text:
                            error_detail = response_text[:300]

                        message = f"{provider_label} Error: {response.status}"
                        if error_detail:
                            message = f"{message} - {error_detail}"
                        return None, json_message(message, status_code=response.status)

                    return response_data, None
        except Exception as err:
            _LOGGER.error("%s API error: %s", provider_label, err)
            return None, json_message(f"API error: {str(err)}", status_code=500)

    def _merge_settings(self, settings_override: dict[str, Any] | None = None) -> dict[str, Any]:
        """Merge runtime settings override on top of persisted settings."""
        settings = dict(self.data.get("settings", {}))
        if isinstance(settings_override, dict):
            alias_map = {
                "local_ai_provider": "localAiProvider",
                "ollama_url": "ollamaUrl",
                "ollama_model": "ollamaModel",
                "lm_studio_url": "lmStudioUrl",
                "lm_studio_model": "lmStudioModel",
                "custom_ai_url": "customAiUrl",
                "custom_ai_model": "customAiModel",
                "custom_ai_api_key": "customAiApiKey",
                "cloud_provider": "cloudProvider",
                "openai_base_url": "openaiBaseUrl",
                "openai_api_key": "openaiApiKey",
                "gemini_api_key": "geminiApiKey",
                "claude_api_key": "claudeApiKey",
                "current_model": "aiModel",
            }
            merged_override = {k: v for k, v in settings_override.items() if v is not None}
            for key, value in list(merged_override.items()):
                alias = alias_map.get(key)
                if alias and alias not in merged_override:
                    merged_override[alias] = value
            settings.update(merged_override)
        return settings

    def _resolve_ai_selection(
        self,
        settings: dict[str, Any],
        ai_type: str | None = None,
        cloud_provider: str | None = None,
        ai_model: str | None = None,
    ) -> tuple[str, str | None, str | None]:
        """Resolve AI mode/provider/model using request values first, then stored settings."""
        resolved_ai_type = ai_type or settings.get("aiType")
        resolved_cloud_provider = cloud_provider
        resolved_model = ai_model

        if not resolved_ai_type:
            old_provider = settings.get("aiProvider", "local")
            if old_provider == "local":
                resolved_ai_type = "rule-based"
            elif old_provider in ["gemini", "openai", "claude"]:
                resolved_ai_type = "cloud"
                if not resolved_cloud_provider:
                    resolved_cloud_provider = old_provider
            else:
                resolved_ai_type = "rule-based"

        if resolved_ai_type == "cloud":
            if not resolved_cloud_provider:
                resolved_cloud_provider = settings.get("cloudProvider") or settings.get("aiProvider", "gemini")
            if not resolved_model:
                resolved_model = settings.get("aiModel")

        return resolved_ai_type, resolved_cloud_provider, resolved_model

    def _normalize_model_entries(self, raw_models: list[dict[str, Any] | str], configured_model: str | None = None) -> tuple[list[dict[str, Any]], bool]:
        """Normalize remote model data and preserve a configured custom model when absent."""
        models: list[dict[str, Any]] = []
        seen: set[str] = set()

        for item in raw_models:
            if isinstance(item, dict):
                model_id = str(item.get("id") or item.get("name") or "").strip()
                label = str(item.get("label") or model_id).strip()
                model_entry = dict(item)
            else:
                model_id = str(item).strip()
                label = model_id
                model_entry = {}

            if not model_id or model_id in seen:
                continue

            seen.add(model_id)
            model_entry["id"] = model_id
            model_entry["label"] = label or model_id
            models.append(model_entry)

        configured = (configured_model or "").strip()
        configured_available = configured in seen if configured else False

        if configured and not configured_available:
            models.insert(0, {
                "id": configured,
                "label": configured,
                "is_custom": True,
                "is_configured": True,
            })
        elif configured:
            for model in models:
                if model["id"] == configured:
                    model["is_configured"] = True
                    break

        return models, configured_available

    def _parse_openai_models(self, response_data: Any) -> list[dict[str, Any]]:
        """Parse OpenAI-compatible /v1/models responses."""
        if not isinstance(response_data, dict):
            return []

        models: list[dict[str, Any]] = []
        for item in response_data.get("data", []):
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            models.append({
                "id": model_id,
                "label": model_id,
                "owned_by": item.get("owned_by"),
            })
        return models

    def _parse_anthropic_models(self, response_data: Any) -> list[dict[str, Any]]:
        """Parse Anthropic /v1/models responses."""
        if not isinstance(response_data, dict):
            return []

        models: list[dict[str, Any]] = []
        for item in response_data.get("data", []):
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            models.append({
                "id": model_id,
                "label": item.get("display_name") or model_id,
            })
        return models

    def _parse_ollama_models(self, response_data: Any) -> list[dict[str, Any]]:
        """Parse Ollama /api/tags responses."""
        if not isinstance(response_data, dict):
            return []

        models: list[dict[str, Any]] = []
        for item in response_data.get("models", []):
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("model") or item.get("name") or "").strip()
            if not model_id:
                continue
            models.append({
                "id": model_id,
                "label": model_id,
                "size": item.get("size"),
                "digest": item.get("digest"),
            })
        return models

    async def get_models(
        self,
        ai_type: str | None = None,
        cloud_provider: str | None = None,
        ai_model: str | None = None,
        settings_override: dict[str, Any] | None = None,
    ) -> web.Response:
        """Return available models for the current AI provider configuration."""
        settings = self._merge_settings(settings_override)
        resolved_ai_type, resolved_cloud_provider, resolved_model = self._resolve_ai_selection(
            settings, ai_type, cloud_provider, ai_model
        )

        provider = None
        endpoint = None
        source = "builtin"
        raw_models: list[dict[str, Any] | str] = []

        if resolved_ai_type == "local-ai":
            provider = settings.get("localAiProvider", "ollama")

            if provider == "ollama":
                endpoint = self._build_ollama_models_url(settings.get("ollamaUrl"))
                payload, error_response = await self._get_json_payload("Ollama", endpoint, {})
                if error_response:
                    return error_response
                raw_models = self._parse_ollama_models(payload)
                resolved_model = settings.get("ollamaModel") or resolved_model
                source = "remote"
            elif provider == "lm-studio":
                endpoint = self._build_openai_models_url(settings.get("lmStudioUrl"), "http://localhost:1234")
                payload, error_response = await self._get_json_payload(
                    "LM Studio",
                    endpoint,
                    {"Content-Type": "application/json"},
                )
                if error_response:
                    return error_response
                raw_models = self._parse_openai_models(payload)
                resolved_model = settings.get("lmStudioModel") or resolved_model
                source = "remote"
            elif provider == "custom":
                custom_url = settings.get("customAiUrl")
                if not custom_url:
                    return json_message("Custom AI endpoint URL is required", status_code=400)
                endpoint = self._build_openai_models_url(custom_url, custom_url)
                headers = {"Content-Type": "application/json"}
                custom_api_key = settings.get("customAiApiKey") or settings.get("openaiApiKey")
                if custom_api_key:
                    headers["Authorization"] = f"Bearer {custom_api_key}"
                payload, error_response = await self._get_json_payload("Custom AI", endpoint, headers)
                if error_response:
                    return error_response
                raw_models = self._parse_openai_models(payload)
                resolved_model = settings.get("customAiModel") or resolved_model
                source = "remote"
            else:
                return json_message(f"Unknown local AI provider: {provider}", status_code=400)
        elif resolved_ai_type == "cloud":
            provider = resolved_cloud_provider or settings.get("cloudProvider") or "gemini"

            if provider == "openai":
                key = settings.get("openaiApiKey")
                if not key:
                    return json_message("No API key for openai", status_code=400)
                endpoint = self._build_openai_models_url(settings.get("openaiBaseUrl"), "https://api.openai.com")
                payload, error_response = await self._get_json_payload(
                    "OpenAI",
                    endpoint,
                    {"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                )
                if error_response:
                    return error_response
                raw_models = self._parse_openai_models(payload)
                source = "remote"
            elif provider == "gemini":
                raw_models = [
                    "gemini-3-pro-preview",
                    "gemini-3-flash-preview",
                    "gemini-2.5-pro",
                    "gemini-2.5-flash",
                    "gemini-2.5-flash-lite",
                ]
            elif provider == "claude":
                key = settings.get("claudeApiKey")
                if not key:
                    return json_message("No API key for Claude", status_code=400)
                payload, error_response = await self._get_json_payload(
                    "Claude",
                    "https://api.anthropic.com/v1/models",
                    {
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                )
                if error_response:
                    return error_response
                raw_models = self._parse_anthropic_models(payload)
                source = "remote"
            else:
                return json_message(f"Unknown provider: {provider}", status_code=400)
        else:
            return json_response({
                "success": True,
                "ai_type": resolved_ai_type,
                "provider": "rule-based",
                "models": [],
                "selected_model": resolved_model or "",
                "configured_model": resolved_model or "",
                "configured_model_available": False,
                "supports_custom_model": False,
                "source": "builtin",
            })

        models, configured_available = self._normalize_model_entries(raw_models, resolved_model)

        supports_custom_model = provider in {"openai", "ollama", "lm-studio", "custom"}

        return json_response({
            "success": True,
            "ai_type": resolved_ai_type,
            "provider": provider,
            "models": models,
            "selected_model": resolved_model or "",
            "configured_model": resolved_model or "",
            "configured_model_available": configured_available,
            "supports_custom_model": supports_custom_model,
            "source": source,
            "endpoint": endpoint,
        })

    def _build_ai_prompt(self, query: str, file_content: str | None) -> tuple[str, str]:
        """Build the common system prompt and user message for external AI providers."""
        system = """You are the Blueprint Studio AI Copilot, a Senior Home Assistant Configuration Expert.

CRITICAL RULES (2024+ Best Practices):
1. Use modern plural keys: triggers:, conditions:, actions:
2. Use modern syntax: - trigger: platform, - action: domain.service
3. Every automation MUST have id: 'XXXXXXXXXXXXX' (13-digit timestamp)
4. Include metadata: {} in all actions
5. Use conditions: [] if no conditions
6. Use mode: single or restart
7. NEVER use legacy service: key - always use action:

Example modern automation:
```yaml
- id: '1738012345678'
  alias: Kitchen Light Control
  triggers:
  - trigger: time
    at: '19:00:00'
  conditions: []
  actions:
  - action: light.turn_on
    metadata: {}
    target:
      entity_id: light.kitchen
    data:
      brightness_pct: 80
  mode: single
```"""
        context = f"Current file:\n```yaml\n{file_content}\n```\n" if file_content else ""
        prompt = f"{context}\nUser request: {query}"
        return system, prompt

    async def _call_cloud_api(self, provider: str, settings: dict, system: str, prompt: str, ai_model: str | None) -> web.Response:
        """Consolidated cloud API handler for supported hosted providers."""
        try:
            key = settings.get(f"{provider}ApiKey")
            if not key:
                return json_message(f"No API key for {provider}", status_code=400)

            if provider == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{ai_model or 'gemini-3-flash-preview'}:generateContent?key={key}"
                payload = {"contents": [{"parts": [{"text": f"{system}\n\n{prompt}"}]}]}
                headers = {}
                parse_fn = lambda r: r["candidates"][0]["content"]["parts"][0]["text"]
            elif provider == "openai":
                url = self._build_openai_compatible_url(settings.get("openaiBaseUrl"), "https://api.openai.com")
                payload = {
                    "model": ai_model or "gpt-5.2",
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                }
                headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
                parse_fn = lambda r: self._extract_text_content(r["choices"][0]["message"]["content"])
            elif provider == "claude":
                url = "https://api.anthropic.com/v1/messages"
                payload = {"model": ai_model or "claude-3-5-sonnet-20241022", "max_tokens": 4096, "system": system, "messages": [{"role": "user", "content": prompt}]}
                headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
                parse_fn = lambda r: self._extract_text_content(r["content"])
            else:
                return json_message(f"Unknown provider: {provider}", status_code=400)

            return await self._post_json_request(provider.title(), url, headers, payload, parse_fn)
        except Exception as e:
            _LOGGER.error("Cloud API error: %s", e)
            return json_message(f"API error: {str(e)}", status_code=500)

    async def _call_local_ai(self, settings: dict, system: str, prompt: str, ai_model: str | None) -> web.Response:
        """Handle local AI providers configured through the settings panel."""
        provider = settings.get("localAiProvider", "ollama")

        if provider == "ollama":
            model = settings.get("ollamaModel") or ai_model or "codellama:7b"
            url = self._build_ollama_url(settings.get("ollamaUrl"))
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
            }
            headers = {"Content-Type": "application/json"}
            parse_fn = lambda r: self._extract_text_content((r.get("message") or {}).get("content"))
            return await self._post_json_request("Ollama", url, headers, payload, parse_fn)

        if provider == "lm-studio":
            model = settings.get("lmStudioModel") or ai_model
            url = self._build_openai_compatible_url(settings.get("lmStudioUrl"), "http://localhost:1234")
            payload = {
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            }
            if model:
                payload["model"] = model
            headers = {"Content-Type": "application/json"}
            parse_fn = lambda r: self._extract_text_content(r["choices"][0]["message"]["content"])
            return await self._post_json_request("LM Studio", url, headers, payload, parse_fn)

        if provider == "custom":
            custom_url = settings.get("customAiUrl")
            if not custom_url:
                return json_message("Custom AI endpoint URL is required", status_code=400)

            model = settings.get("customAiModel") or ai_model
            url = self._build_openai_compatible_url(custom_url, custom_url)
            payload = {
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            }
            if model:
                payload["model"] = model
            headers = {"Content-Type": "application/json"}
            custom_api_key = settings.get("customAiApiKey") or settings.get("openaiApiKey")
            if custom_api_key:
                headers["Authorization"] = f"Bearer {custom_api_key}"
            parse_fn = lambda r: self._extract_text_content(r["choices"][0]["message"]["content"])
            return await self._post_json_request("Custom AI", url, headers, payload, parse_fn)

        return json_message(f"Unknown local AI provider: {provider}", status_code=400)

    async def _call_hass_agent(
        self, query: str, current_file: str | None,
        file_content: str | None, agent_entity_id: str | None,
    ) -> web.Response:
        """Route query through a Home Assistant conversation agent."""
        try:
            from .claw_hook import try_claw_query
            resp = await try_claw_query(
                self.hass, query, current_file, file_content,
                agent_entity_id=agent_entity_id,
            )
            if resp is not None:
                return resp
            return json_message("Home Assistant conversation agent not available", status_code=400)
        except Exception as err:
            _LOGGER.error("hass agent call failed: %s", err)
            return json_message(f"HA agent error: {err}", status_code=500)

    async def query(self, query: str | None, current_file: str | None, file_content: str | None,
                   ai_type: str | None = None, cloud_provider: str | None = None,
                   ai_model: str | None = None) -> web.Response:
        """Process AI query with advanced natural language understanding."""
        try:
            if not query:
                return json_message("Query is empty", status_code=400)

            query_lower = query.lower()
            settings = self._merge_settings()
            ai_type, cloud_provider, ai_model = self._resolve_ai_selection(
                settings, ai_type, cloud_provider, ai_model
            )

            # Home Assistant conversation agent
            if ai_type == "hass-agent" and self.hass:
                return await self._call_hass_agent(
                    query, current_file, file_content,
                    settings.get("hassAgentId") or None,
                )

            # Cloud AI providers
            if ai_type == "cloud" and cloud_provider in ["gemini", "openai", "claude"]:
                system, prompt = self._build_ai_prompt(query, file_content)
                return await self._call_cloud_api(cloud_provider, settings, system, prompt, ai_model)

            if ai_type == "local-ai":
                system, prompt = self._build_ai_prompt(query, file_content)
                return await self._call_local_ai(settings, system, prompt, ai_model)

            # ===== ADVANCED LOCAL LOGIC ENGINE =====

            # 1. Intent Detection: Analysis/Fix
            if any(word in query_lower for word in ["check", "fix", "analyze", "validate", "error", "debug", "lint"]):
                if not file_content:
                    return json_response({"success": False, "response": "Please open a file to check for errors."})

                is_jinja = "jinja" in query_lower or (current_file and current_file.endswith((".jinja", ".jinja2", ".j2")))

                if is_jinja:
                    check_result = check_jinja(file_content)
                    result_data = check_result._body if hasattr(check_result, '_body') else "{}"
                    try:
                        res = json.loads(result_data)
                        if res.get("valid"):
                            return json_response({"success": True, "response": f"✅ **Jinja Analysis Passed**\n\n{res.get('message')}\n\n**Tip:** {res.get('tip')}"})
                        else:
                            errors = "\n".join([f"- Line {e['line']}: {e['message']} (Fix: `{e['solution']}`)" for e in res.get('errors', [])])
                            return json_response({"success": True, "response": f"❌ **Found {res.get('error_count')} Jinja Errors**\n\n{errors}"})
                    except Exception:
                        return check_result

                else:
                    check_result = check_yaml(file_content)
                    result_data = check_result._body if hasattr(check_result, '_body') else "{}"
                    try:
                        res = json.loads(result_data)
                        if res.get("valid"):
                            msg = f"✅ **YAML Analysis Passed**\n\n{res.get('message')}"
                            if res.get("warnings"):
                                warnings = "\n".join([f"- Line {w['line']}: {w['message']}" for w in res.get('warnings', [])])
                                msg += f"\n\n**Warnings:**\n{warnings}"
                            return json_response({"success": True, "response": msg})
                        else:
                            errors = "\n".join([f"- Line {e['line']}: {e['message']} (Fix: `{e['solution']}`)" for e in res.get('errors', [])])
                            return json_response({"success": True, "response": f"❌ **Found {res.get('error_count')} YAML Errors**\n\n{errors}"})
                    except Exception:
                        return check_result

            # 2. Intent Detection: Generation (Automation/Script/Scene)
            config_type = "automation"
            if "scene" in query_lower:
                config_type = "scene"
            elif "script" in query_lower:
                config_type = "script"

            domain = detect_domain(query)
            entities = find_best_entities(self.hass, query, domain, limit=5)
            values = extract_values(query, domain)
            conditions = extract_conditions(self.hass, query)
            trigger_info = detect_trigger_type(self.hass, query)
            name = extract_automation_name(self.hass, query)

            is_list = current_file and any(f in current_file for f in ["automations.yaml", "scripts.yaml", "scenes.yaml"])
            ind = "" if is_list else "  "
            hdr = f"{config_type}:\n  " if not is_list else ""
            uid = str(int(time.time() * 1000))

            actions = DOMAIN_ACTIONS.get(domain, {"on": "turn_on", "off": "turn_off"})

            # ===== SCENE GENERATION =====
            if config_type == "scene":
                scene_type = None
                if any(word in query_lower for word in ["morning", "wake", "breakfast"]):
                    scene_type = "morning"
                elif any(word in query_lower for word in ["evening", "night", "bedtime", "sleep"]):
                    scene_type = "evening"
                elif any(word in query_lower for word in ["movie", "cinema", "tv", "watch"]):
                    scene_type = "movie"
                elif any(word in query_lower for word in ["reading", "read", "study"]):
                    scene_type = "reading"
                elif any(word in query_lower for word in ["romantic", "dinner", "date"]):
                    scene_type = "romantic"
                elif any(word in query_lower for word in ["party", "celebration"]):
                    scene_type = "party"
                elif any(word in query_lower for word in ["relax", "chill"]):
                    scene_type = "relax"

                entity_states = {}
                scene_defaults = get_scene_defaults(scene_type)

                for ent in entities[:10]:
                    ent_domain = ent.split('.')[0]

                    if ent_domain == "light":
                        state_config = ["state: on"]

                        if "brightness_pct" in values:
                            state_config.append(f"brightness_pct: {values['brightness_pct']}")
                        elif scene_type and "brightness" in scene_defaults:
                            state_config.append(f"brightness_pct: {scene_defaults['brightness']}")

                        if "rgb_color" in values:
                            state_config.append(f"rgb_color: {values['rgb_color']}")
                        elif scene_type and "color" in scene_defaults:
                            state_config.append(f"rgb_color: {scene_defaults['color']}")

                        if "kelvin" in values:
                            state_config.append(f"kelvin: {values['kelvin']}")
                        elif scene_type and "kelvin" in scene_defaults:
                            state_config.append(f"kelvin: {scene_defaults['kelvin']}")

                        if "transition" in query_lower:
                            transition_match = re.search(r"transition\s*(?:of|for)?\s*(\d+)", query_lower)
                            if transition_match:
                                state_config.append(f"transition: {transition_match.group(1)}")
                            else:
                                state_config.append("transition: 2")
                        elif scene_type:
                            state_config.append("transition: 1")

                        entity_states[ent] = "\n" + "\n".join([f"{ind}    {cfg}" for cfg in state_config])

                    elif ent_domain == "climate":
                        state_config = []
                        if "temperature" in values:
                            state_config.append(f"temperature: {values['temperature']}")
                        if "hvac_mode" in values:
                            state_config.append(f"hvac_mode: {values['hvac_mode']}")

                        if state_config:
                            entity_states[ent] = "\n" + "\n".join([f"{ind}    {cfg}" for cfg in state_config])
                        else:
                            entity_states[ent] = "heat"

                    elif ent_domain == "cover":
                        if "position" in values:
                            entity_states[ent] = f"\n{ind}    state: open\n{ind}    position: {values['position']}"
                        else:
                            entity_states[ent] = "open" if "open" in query_lower else "closed"

                    elif ent_domain == "media_player":
                        if "volume_level" in values:
                            entity_states[ent] = f"\n{ind}    state: on\n{ind}    volume_level: {values['volume_level']}"
                        else:
                            entity_states[ent] = "on"

                    else:
                        entity_states[ent] = "on" if "on" in query_lower or "activate" in query_lower else "off"

                scene_name = name.lower().replace(' ', '_')
                entities_yaml = "\n".join([f"{ind}    {ent}:{' ' + state if isinstance(state, str) else state}" for ent, state in entity_states.items()])

                icon = get_scene_icon(scene_type, query_lower)
                description = get_scene_description(scene_type, name)

                code = f"""{hdr}{scene_name}:
{ind}  name: {name}
{ind}  icon: {icon}
{ind}  entities:
{entities_yaml}"""

                return json_response({"success": True, "response": f"Generated Scene:\n\n```yaml\n{code}\n```\n\n💡 **Tip:** Activate with `scene.turn_on` or via UI"})

            # ===== SCRIPT GENERATION =====
            if config_type == "script":
                multi_step = any(word in query_lower for word in ["then", "after", "sequence", "followed by", "next", "and then"])

                script_name = name.lower().replace(' ', '_')

                sequence_steps = []

                action_name = actions.get("on" if "on" in query_lower or "turn on" in query_lower else "off", "turn_on")
                data_block = build_data_block(values, domain, ind)
                target_yaml = build_target_yaml(entities, ind)

                if len(entities) > 1 and any(word in query_lower for word in ["all", "every"]):
                    for ent in entities[:5]:
                        sequence_steps.append(f"""{ind}  - action: {domain}.{action_name}
{ind}    metadata: {{}}
{ind}    target:
{ind}      entity_id: {ent}{data_block}""")
                else:
                    sequence_steps.append(f"""{ind}  - action: {domain}.{action_name}
{ind}    metadata: {{}}
{ind}    {target_yaml}{data_block}""")

                additional_actions = detect_additional_actions(query_lower)
                for add_action in additional_actions:
                    if add_action["type"] == "delay":
                        duration_parts = add_action['duration'].split(':')
                        hours, minutes, seconds = int(duration_parts[0]), int(duration_parts[1]), int(duration_parts[2])
                        sequence_steps.append(f"""{ind}  - delay:
{ind}      hours: {hours}
{ind}      minutes: {minutes}
{ind}      seconds: {seconds}""")
                    elif add_action["type"] == "notify":
                        sequence_steps.append(f"""{ind}  - action: notify.notify
{ind}    metadata: {{}}
{ind}    data:
{ind}      message: "{add_action['message']}" """)

                if multi_step and any(phrase in query_lower for phrase in ["then off", "then turn off", "then close"]):
                    off_action = actions.get("off", "turn_off")
                    sequence_steps.append(f"""{ind}  - action: {domain}.{off_action}
{ind}    metadata: {{}}
{ind}    {target_yaml}
{ind}    data: {{}}""")

                sequence_yaml = "\n".join(sequence_steps)

                mode = "single"
                if any(word in query_lower for word in ["parallel", "simultaneously", "at once"]):
                    mode = "parallel"
                elif any(word in query_lower for word in ["restart", "interrupt"]):
                    mode = "restart"
                elif any(word in query_lower for word in ["queue", "queued"]):
                    mode = "queued"

                fields_yaml = ""
                if any(word in query_lower for word in ["variable", "input", "parameter"]):
                    fields_yaml = f"""
{ind}  fields:
{ind}    brightness:
{ind}      description: Brightness level
{ind}      example: 80"""

                code = f"""{hdr}{script_name}:
{ind}  alias: {name}
{ind}  description: {get_script_description(query_lower)}
{ind}  mode: {mode}{fields_yaml}
{ind}  sequence:
{sequence_yaml}"""

                return json_response({"success": True, "response": f"Generated Script:\n\n```yaml\n{code}\n```\n\n💡 **Tip:** Call with `script.{script_name}` or via UI"})

            # ===== AUTOMATION GENERATION =====
            multi_intent = ("on" in query_lower and "off" in query_lower) or ("open" in query_lower and "close" in query_lower)

            # Check for multi-domain query first
            domain_intents = find_multi_domain_entities(self.hass, query)

            if domain_intents:
                code = generate_multi_domain_automation(
                    uid, name, domain_intents, trigger_info, conditions, ind, hdr
                )
                domains_str = " and ".join(i["domain"] for i in domain_intents)
                response_msg = (
                    f"Generated Multi-Domain Automation:\n\n```yaml\n{code}\n```\n\n"
                    f"💡 Controls **{domains_str}** — adjust entity IDs as needed."
                )
            elif trigger_info["type"] == "sun":
                code = generate_single_intent_automation(
                    uid, name, domain, actions, entities, trigger_info, values, conditions, ind, hdr, query_lower,
                    detect_additional_actions
                )
                event = trigger_info.get("event", "sunset")
                offset = trigger_info.get("offset", "+00:00:00")
                offset_note = f" with offset `{offset}`" if offset not in ("+00:00:00", "-00:00:00") else ""
                response_msg = (
                    f"Generated Modern Automation:\n\n```yaml\n{code}\n```\n\n"
                    f"☀️ Triggered at **{event}**{offset_note}."
                )
            elif trigger_info["type"] == "time_pattern":
                code = generate_single_intent_automation(
                    uid, name, domain, actions, entities, trigger_info, values, conditions, ind, hdr, query_lower,
                    detect_additional_actions
                )
                pattern_key = next((k for k in ("hours", "minutes", "seconds") if k in trigger_info), "minutes")
                pattern_val = trigger_info.get(pattern_key, "/5")
                response_msg = (
                    f"Generated Modern Automation:\n\n```yaml\n{code}\n```\n\n"
                    f"🔄 Repeating trigger: every `{pattern_val}` {pattern_key}."
                )
            elif trigger_info["type"] == "zone":
                code = generate_single_intent_automation(
                    uid, name, domain, actions, entities, trigger_info, values, conditions, ind, hdr, query_lower,
                    detect_additional_actions
                )
                event = trigger_info.get("event", "enter")
                zone = trigger_info.get("zone", "zone.home")
                response_msg = (
                    f"Generated Modern Automation:\n\n```yaml\n{code}\n```\n\n"
                    f"📍 Triggered when person **{event}s** `{zone}`."
                )
            elif multi_intent and trigger_info["type"] == "time" and len(trigger_info.get("times", [])) >= 2:
                code = generate_multi_intent_automation(
                    uid, name, domain, actions, entities, trigger_info["times"], values, conditions, ind, hdr
                )
                response_msg = f"Generated Modern Automation:\n\n```yaml\n{code}\n```"
            else:
                code = generate_single_intent_automation(
                    uid, name, domain, actions, entities, trigger_info, values, conditions, ind, hdr, query_lower,
                    detect_additional_actions
                )
                response_msg = f"Generated Modern Automation:\n\n```yaml\n{code}\n```"

            return json_response({"success": True, "response": response_msg})

        except Exception as e:
            _LOGGER.error(f"AI Error: {e}", exc_info=True)
            return json_message(str(e), status_code=500)
