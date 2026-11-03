"""Tests for typed public transport contracts."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "transport_contracts",
    ROOT / "custom_components/blueprint_studio/backend/transport_contracts.py",
)
contracts = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = contracts
SPEC.loader.exec_module(contracts)


class TransportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.post_fixture = json.loads(
            (ROOT / "tests/fixtures/backend_post_contract.json").read_text()
        )
        cls.get_fixture = json.loads(
            (ROOT / "tests/fixtures/backend_get_contract.json").read_text()
        )

    def test_every_documented_action_has_a_schema(self):
        documented = {item["action"] for item in self.get_fixture["actions"]}
        documented.update(self.post_fixture["actions"])
        documented.update(self.post_fixture["sftp_actions"])
        self.assertEqual(documented, set(contracts.ACTION_SCHEMAS))

    def test_get_fixtures_validate_without_changing_query_strings(self):
        for item in self.get_fixture["actions"]:
            request = {"action": item["action"], **item["query"]}
            result = contracts.validate_action(item["action"], request, transport="get")
            if "show_hidden" in item["query"]:
                self.assertEqual(item["query"]["show_hidden"], result["show_hidden"])

    def test_post_and_sftp_fixtures_validate(self):
        overrides = self.post_fixture["request_overrides"]
        for action in self.post_fixture["actions"]:
            contracts.validate_action(
                action,
                {"action": action, **overrides.get(action, {})},
                transport="post",
            )

        connection = self.post_fixture["sftp_connection"]
        overrides = self.post_fixture["sftp_request_overrides"]
        for action in self.post_fixture["sftp_actions"]:
            contracts.validate_action(
                action,
                {
                    "action": action,
                    "connection": connection,
                    **overrides.get(action, {}),
                },
                transport="sftp",
            )

    def test_required_and_typed_fields_are_rejected_consistently(self):
        invalid = (
            ("write_file", {"content": "x"}, "post"),
            ("delete_multi", {"paths": "not-a-list"}, "post"),
            ("create_file", {"path": "x", "overwrite": "sometimes"}, "post"),
            (
                "sftp_read",
                {
                    "path": "/x",
                    "connection": {"host": "h", "username": "u", "port": 70000},
                },
                "sftp",
            ),
            ("git_checkout_branch", {"branch": "bad..branch"}, "post"),
            ("ai_get_models", {"ai_type": "unknown"}, "post"),
        )
        for action, request, transport in invalid:
            with (
                self.subTest(action=action),
                self.assertRaises(contracts.ValidationError),
            ):
                contracts.validate_action(action, request, transport=transport)

    def test_empty_editor_content_is_present_not_missing(self):
        for action, request, transport in (
            ("check_syntax", {"content": "", "file_path": "empty.yaml"}, "post"),
            ("write_file", {"path": "empty.yaml", "content": ""}, "post"),
            (
                "sftp_write",
                {
                    "path": "/empty.yaml",
                    "content": "",
                    "connection": {"host": "h", "username": "u"},
                },
                "sftp",
            ),
        ):
            with self.subTest(action=action):
                result = contracts.validate_action(action, request, transport=transport)
                self.assertEqual(result["content"], "")

        with self.assertRaisesRegex(contracts.ValidationError, "content"):
            contracts.validate_action(
                "check_syntax", {"file_path": "missing.yaml"}, transport="post"
            )

    def test_repository_creation_uses_handler_compatible_fields(self):
        for action in ("github_create_repo", "gitea_create_repo"):
            with self.subTest(action=action):
                result = contracts.validate_action(
                    action,
                    {"repo_name": "fixture", "is_private": False},
                    transport="post",
                )
                self.assertEqual(result["repo_name"], "fixture")
                self.assertIs(result["is_private"], False)

                with self.assertRaisesRegex(
                    contracts.ValidationError, "Missing required field: repo_name"
                ):
                    contracts.validate_action(
                        action, {"name": "fixture"}, transport="post"
                    )

    def test_gitea_credentials_do_not_require_an_unused_url(self):
        result = contracts.validate_action(
            "gitea_set_credentials",
            {"username": "fixture", "token": "secret", "remember_me": True},
            transport="post",
        )
        self.assertEqual(result["username"], "fixture")
        self.assertEqual(result["token"], "secret")

        for missing_field in ("username", "token"):
            request = {"username": "fixture", "token": "secret"}
            del request[missing_field]
            with (
                self.subTest(missing_field=missing_field),
                self.assertRaisesRegex(
                    contracts.ValidationError,
                    f"Missing required field: {missing_field}",
                ),
            ):
                contracts.validate_action(
                    "gitea_set_credentials", request, transport="post"
                )

    def test_blueprint_instance_display_names_allow_spaces_but_reject_control_input(
        self,
    ):
        request = {
            "content": "blueprint:\n  name: Fixture\n  domain: automation\n  input: {}\n",
            "input_values": {},
            "name": "Kitchen Motion Light",
        }
        result = contracts.validate_action(
            "instantiate_blueprint", request, transport="post"
        )
        self.assertEqual(result["name"], "Kitchen Motion Light")

        for invalid_name in ("   ", "Kitchen\nLight", "Kitchen\x00Light"):
            with self.subTest(invalid_name=repr(invalid_name)):
                with self.assertRaisesRegex(contracts.ValidationError, "display name"):
                    contracts.validate_action(
                        "instantiate_blueprint",
                        {**request, "name": invalid_name},
                        transport="post",
                    )

    def test_ai_proposal_selection_and_empty_revision_are_typed(self):
        selected = contracts.validate_action(
            "ai_apply_proposal",
            {"proposal_id": "fixture", "selected_paths": ["one.yaml"]},
            transport="post",
        )
        revised = contracts.validate_action(
            "ai_revise_proposal",
            {"proposal_id": "fixture", "path": "one.yaml", "new_content": ""},
            transport="post",
        )
        self.assertEqual(selected["selected_paths"], ["one.yaml"])
        self.assertEqual(revised["new_content"], "")
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_action(
                "ai_apply_proposal",
                {"proposal_id": "fixture", "selected_paths": []},
                transport="post",
            )
        for action, field in (
            ("ai_cancel", "request_id"),
            ("ai_undo_proposal", "undo_id"),
        ):
            with self.assertRaises(contracts.ValidationError):
                contracts.validate_action(action, {field: 3}, transport="post")

    def test_terminal_control_messages_are_typed(self):
        contracts.validate_terminal_message({"type": "resize", "rows": 24, "cols": 80})
        contracts.validate_terminal_message({"type": "input", "data": "pwd\n"})
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_terminal_message(
                {"type": "resize", "rows": 0, "cols": 80}
            )
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_terminal_message({"type": "input", "data": 3})

    def test_stream_and_upload_metadata_contracts(self):
        contracts.validate_stream(
            "serve_file", {"action": "serve_file", "path": "a.yaml"}
        )
        contracts.validate_upload_metadata("a.yaml", False, False, "merge", None)
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_stream("serve_file", {"action": "serve_file"})
        with self.assertRaises(contracts.ValidationError):
            contracts.validate_upload_metadata("a.yaml", False, False, "invalid", None)


class TerminalOriginValidationTests(unittest.TestCase):
    def setUp(self):
        class MockConfig:
            def __init__(self, external_url=None, internal_url=None):
                self.external_url = external_url
                self.internal_url = internal_url

        class MockHass:
            def __init__(self, external_url=None, internal_url=None):
                self.config = MockConfig(external_url, internal_url)

        self.mock_hass = MockHass(
            external_url="https://ha.example.com",
            internal_url="http://192.168.1.100:8123",
        )
        self.mock_hass_empty = MockHass()

    def test_exact_scheme_and_host_match(self):
        self.assertTrue(
            contracts.validate_terminal_origin(
                "http://homeassistant.local:8123",
                request_scheme="http",
                request_host="homeassistant.local:8123",
                headers={"Host": "homeassistant.local:8123"},
                hass=self.mock_hass,
            )
        )

    def test_https_reverse_proxy_with_configured_external_url(self):
        # Reproduces issue #105: HA reached via plain HTTP behind TLS-terminating proxy
        self.assertTrue(
            contracts.validate_terminal_origin(
                "https://ha.example.com",
                request_scheme="http",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com", "X-Forwarded-Proto": "https"},
                hass=self.mock_hass,
            )
        )

    def test_https_reverse_proxy_direct_to_port_with_external_url(self):
        # Direct connection to HA port 8123 with https Origin matching external_url
        self.assertTrue(
            contracts.validate_terminal_origin(
                "https://ha.example.com",
                request_scheme="http",
                request_host="192.168.1.100:8123",
                headers={"Host": "192.168.1.100:8123"},
                hass=self.mock_hass,
            )
        )

    def test_internal_url_match(self):
        self.assertTrue(
            contracts.validate_terminal_origin(
                "http://192.168.1.100:8123",
                request_scheme="http",
                request_host="192.168.1.100:8123",
                headers={"Host": "192.168.1.100:8123"},
                hass=self.mock_hass,
            )
        )

    def test_reverse_proxy_forwarded_host_without_configured_url(self):
        # Even when external_url is not configured in HA, X-Forwarded-Host matches
        self.assertTrue(
            contracts.validate_terminal_origin(
                "https://ha.example.com",
                request_scheme="http",
                request_host="192.168.1.100:8123",
                headers={
                    "Host": "192.168.1.100:8123",
                    "X-Forwarded-Host": "ha.example.com",
                    "X-Forwarded-Proto": "https",
                },
                hass=self.mock_hass_empty,
            )
        )

    def test_reverse_proxy_with_custom_forwarded_port(self):
        self.assertTrue(
            contracts.validate_terminal_origin(
                "https://ha.example.com:8443",
                request_scheme="http",
                request_host="192.168.1.100:8123",
                headers={
                    "Host": "192.168.1.100:8123",
                    "X-Forwarded-Host": "ha.example.com",
                    "X-Forwarded-Port": "8443",
                },
                hass=self.mock_hass_empty,
            )
        )

    def test_standard_default_ports_normalized(self):
        # Explicit :443 port in Origin
        self.assertTrue(
            contracts.validate_terminal_origin(
                "https://ha.example.com:443",
                request_scheme="http",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass_empty,
            )
        )

    def test_reject_untrusted_cross_origin(self):
        self.assertFalse(
            contracts.validate_terminal_origin(
                "https://evil.com",
                request_scheme="https",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass,
            )
        )

    def test_reject_subdomain_spoof(self):
        self.assertFalse(
            contracts.validate_terminal_origin(
                "https://ha.example.com.evil.com",
                request_scheme="https",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass,
            )
        )

    def test_reject_empty_null_or_missing_origin(self):
        self.assertFalse(
            contracts.validate_terminal_origin(
                None,
                request_scheme="https",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass,
            )
        )
        self.assertFalse(
            contracts.validate_terminal_origin(
                "null",
                request_scheme="https",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass,
            )
        )
        self.assertFalse(
            contracts.validate_terminal_origin(
                "",
                request_scheme="https",
                request_host="ha.example.com",
                headers={"Host": "ha.example.com"},
                hass=self.mock_hass,
            )
        )

    def test_reject_invalid_schemes(self):
        for scheme in (
            "javascript:",
            "file://",
            "ftp://ha.example.com",
            "data:text/html",
        ):
            self.assertFalse(
                contracts.validate_terminal_origin(
                    scheme,
                    request_scheme="https",
                    request_host="ha.example.com",
                    headers={"Host": "ha.example.com"},
                    hass=self.mock_hass,
                )
            )


if __name__ == "__main__":
    unittest.main()
