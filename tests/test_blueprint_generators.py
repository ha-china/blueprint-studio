import importlib.util
import pathlib
import unittest

import yaml


ROOT = pathlib.Path(__file__).resolve().parents[1]
GENERATORS_PATH = ROOT / "custom_components" / "blueprint_studio" / "backend" / "ai_generators.py"


def load_generators():
    spec = importlib.util.spec_from_file_location("ai_generators", GENERATORS_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BlueprintGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.generators = load_generators()

    def test_convert_automation_extracts_quoted_and_list_entities(self):
        content = """alias: Test automation
triggers:
  - trigger: state
    entity_id: [binary_sensor.front_door, binary_sensor.back_door]
conditions:
  - condition: state
    entity_id: "input_boolean.away_mode"
    state: "on"
actions:
  - action: light.turn_on
    target:
      entity_id:
        - light.kitchen
        - light.hall
mode: single
"""

        result = self.generators.convert_automation_to_blueprint(content, "Test Blueprint")

        self.assertIn("binary_sensor_entity_1", result)
        self.assertIn("binary_sensor_entity_2", result)
        self.assertIn("input_boolean_entity", result)
        self.assertIn("light_entity_1", result)
        self.assertIn("light_entity_2", result)
        self.assertNotIn("binary_sensor.front_door", result)
        self.assertNotIn("light.kitchen", result)
        self.assertIn("entity_id: !input input_boolean_entity", result)

        class Loader(yaml.SafeLoader):
            pass

        Loader.add_constructor("!input", lambda loader, node: loader.construct_scalar(node))
        yaml.load(result, Loader=Loader)

    def test_instantiate_blueprint_keeps_target_selector_as_target_object(self):
        blueprint = """blueprint:
  name: Target Test
  domain: automation
  input:
    target_device:
      name: Target
      selector:
        target: {}
triggers: []
actions:
  - action: light.turn_on
    target: !input target_device
"""

        result = self.generators.instantiate_blueprint(
            blueprint,
            {
                "target_device": {
                    "entity_id": ["light.kitchen", "light.hall"],
                    "area_id": "living_room",
                }
            },
            "Target Test",
        )

        self.assertIn(
            "target: {area_id: living_room, entity_id: [light.kitchen, light.hall]}",
            result,
        )

    def test_convert_automation_uses_2026_app_selector_for_addon_slug(self):
        content = """alias: Restart add-on
triggers: []
actions:
  - action: hassio.addon_restart
    data:
      addon: core_ssh
mode: single
"""

        result = self.generators.convert_automation_to_blueprint(content, "Restart Add-on")

        self.assertIn("addon: !input addon_id", result)
        self.assertIn("selector:\n        app: {}", result)
        self.assertNotIn("selector:\n        addon: {}", result)


if __name__ == "__main__":
    unittest.main()
