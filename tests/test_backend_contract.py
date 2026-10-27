import ast
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
API_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "api.py"
GET_FIXTURE_PATH = ROOT / "tests" / "fixtures" / "backend_get_contract.json"
POST_FIXTURE_PATH = ROOT / "tests" / "fixtures" / "backend_post_contract.json"
SFTP_API_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "api_sftp.py"
TERMINAL_API_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "api_terminal.py"
WEBSOCKET_API_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "websocket.py"
TRANSPORT_FIXTURE_PATH = ROOT / "tests" / "fixtures" / "backend_transport_contract.json"
INTEGRATION_PATH = ROOT / "custom_components" / "blueprint_studio" / "__init__.py"
SERVICE_WORKER_PATH = (
    ROOT / "custom_components" / "blueprint_studio" / "www" / "service-worker.js"
)


def _dispatcher_actions(method_name: str, mapping_name: str) -> set[str]:
    tree = ast.parse(API_PATH.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
            continue
        if node.name != method_name:
            continue
        for child in ast.walk(node):
            if not isinstance(child, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == mapping_name for target in child.targets):
                continue
            if not isinstance(child.value, ast.Dict):
                break
            return {
                key.value
                for key in child.value.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
    raise AssertionError(f"Could not find {mapping_name} in {method_name}()")


class BackendGetContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(GET_FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_fixture_covers_every_get_dispatcher_action(self):
        fixture_actions = {item["action"] for item in self.fixture["actions"]}
        self.assertEqual(_dispatcher_actions("get", "get_handlers"), fixture_actions)

    def test_each_action_has_a_complete_request_and_response_shape(self):
        self.assertEqual("GET", self.fixture["method"])
        self.assertEqual("/api/blueprint_studio", self.fixture["route"])
        for item in self.fixture["actions"]:
            self.assertIsInstance(item["query"], dict, item["action"])
            self.assertEqual(200, item["success"]["status"], item["action"])
            self.assertIn(item["success"]["body_type"], {"array", "object"})

    def test_common_authentication_and_dispatch_errors_are_recorded(self):
        errors = self.fixture["common_errors"]
        self.assertEqual(400, errors["missing_action"]["status"])
        self.assertEqual(400, errors["unknown_action"]["status"])
        self.assertEqual(401, errors["unauthenticated"]["status"])
        self.assertEqual(403, errors["non_admin"]["status"])


class BackendPostContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(POST_FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_fixture_covers_every_post_dispatcher_action(self):
        self.assertEqual(
            _dispatcher_actions("post", "post_handlers"),
            set(self.fixture["actions"]),
        )

    def test_fixture_covers_every_sftp_dispatcher_action(self):
        tree = ast.parse(SFTP_API_PATH.read_text(encoding="utf-8"))
        source_actions = set()
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == "SFTP_ACTIONS" for target in node.targets):
                continue
            call = node.value
            if isinstance(call, ast.Call) and call.args and isinstance(call.args[0], (ast.Set, ast.List, ast.Tuple)):
                source_actions = {
                    item.value for item in call.args[0].elts if isinstance(item, ast.Constant)
                }
        self.assertEqual(source_actions, set(self.fixture["sftp_actions"]))

    def test_every_action_resolves_to_a_representative_request(self):
        overrides = self.fixture["request_overrides"]
        for action in self.fixture["actions"]:
            request = {"action": action, **overrides.get(action, {})}
            self.assertEqual(action, request["action"])

        connection = self.fixture["sftp_connection"]
        sftp_overrides = self.fixture["sftp_request_overrides"]
        for action in self.fixture["sftp_actions"]:
            request = {
                "action": action,
                "connection": connection,
                **sftp_overrides.get(action, {}),
            }
            self.assertEqual(action, request["action"])
            self.assertTrue(request["connection"]["host"])


class BackendTransportContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = json.loads(TRANSPORT_FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.api_source = API_PATH.read_text(encoding="utf-8")

    def test_stream_actions_and_upload_fields_match_source(self):
        for action in self.fixture["stream"]["actions"]:
            self.assertIn(f'action == "{action}"', self.api_source)

        for field in self.fixture["upload"]["fields"]:
            self.assertIn(f'part.name == "{field}"', self.api_source)

        self.assertIsNone(self.fixture["upload"]["size_limit"])

    def test_terminal_protocol_matches_source(self):
        source = TERMINAL_API_PATH.read_text(encoding="utf-8")
        terminal = self.fixture["terminal"]
        for prefix in terminal["legacy_prefixes"]:
            self.assertIn(prefix, source)
        for message_type in ("input", "resize"):
            self.assertIn(f"data.get('type') == '{message_type}'", source)
        self.assertEqual({"type", "rows", "cols"}, set(terminal["resize_fixture"]))
        self.assertEqual({"type", "data"}, set(terminal["input_fixture"]))

    def test_home_assistant_websocket_commands_and_events_match_source(self):
        source = WEBSOCKET_API_PATH.read_text(encoding="utf-8")
        for subscription in self.fixture["home_assistant_websocket"]:
            self.assertIn(subscription["type"], source)
            self.assertIn(subscription["event"], source)


class PwaCacheContractTests(unittest.TestCase):
    def test_pwa_is_network_only_and_removes_legacy_caches(self):
        worker = SERVICE_WORKER_PATH.read_text(encoding="utf-8")
        integration = INTEGRATION_PATH.read_text(encoding="utf-8")

        self.assertIn("fetch(event.request, { cache: 'no-store' })", worker)
        self.assertIn("cacheName.startsWith(CACHE_PREFIX)", worker)
        self.assertIn("caches.delete(cacheName)", worker)
        self.assertNotIn("caches.open", worker)
        self.assertNotIn("caches.match", worker)
        self.assertIn('"Cache-Control": "no-store, max-age=0"', integration)
        self.assertIn("async def get(self, request: web.Request, path: str)", integration)


class DeviceRegistryContractTests(unittest.TestCase):
    def test_device_registry_devices_mapping_values_not_called(self):
        backend_dir = ROOT / "custom_components" / "blueprint_studio" / "backend"
        for py_path in backend_dir.glob("*.py"):
            tree = ast.parse(py_path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and node.attr == "values":
                    if isinstance(node.value, ast.Attribute) and node.value.attr == "devices":
                        self.fail(
                            f"Deprecated `.devices.values()` found in {py_path.name} at line {node.lineno}"
                        )


class HomeAssistantDeprecationContractTests(unittest.TestCase):
    def test_hass_loop_not_accessed_in_backend(self):
        backend_dir = ROOT / "custom_components" / "blueprint_studio" / "backend"
        for py_path in backend_dir.glob("*.py"):
            tree = ast.parse(py_path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute) and node.attr == "loop":
                    if isinstance(node.value, ast.Attribute) and node.value.attr == "hass":
                        self.fail(
                            f"Deprecated `hass.loop` access found in {py_path.name} at line {node.lineno}"
                        )
                    if isinstance(node.value, ast.Name) and node.value.id == "hass":
                        self.fail(
                            f"Deprecated `hass.loop` access found in {py_path.name} at line {node.lineno}"
                        )

    def test_git_credentials_not_stored_in_hass_data(self):
        git_mgr_path = ROOT / "custom_components" / "blueprint_studio" / "backend" / "git_manager.py"
        source = git_mgr_path.read_text(encoding="utf-8")
        self.assertNotIn('self.hass.data[DOMAIN]["git_credentials"]', source)
        self.assertNotIn('hass.data[DOMAIN]["git_credentials"]', source)


if __name__ == "__main__":
    unittest.main()
