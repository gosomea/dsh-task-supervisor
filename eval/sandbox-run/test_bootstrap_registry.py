import unittest

from execution import bind_registry


class Runtime:
    def __init__(self):
        self.commands = []

    def exec(self, box, command, *, timeout_s):
        self.commands.append(command)
        return 0, '', ''


class RegistryBootstrapTests(unittest.TestCase):
    def test_old_spec_has_no_new_mapping(self):
        runtime = Runtime(); bind_registry(runtime, None, {})
        self.assertEqual(runtime.commands, [])

    def test_only_literal_frozen_registry_mapping_is_written(self):
        runtime = Runtime()
        bind_registry(runtime, None, {'bootstrapRegistryIpv4': ['192.0.2.1']})
        self.assertEqual(len(runtime.commands), 1)
        self.assertIn('192.0.2.1 registry.npmjs.org', runtime.commands[0])
        self.assertTrue(runtime.commands[0].endswith('>> /etc/hosts'))
        with self.assertRaises(ValueError):
            bind_registry(runtime, None, {'bootstrapRegistryIpv4': ['192.0.2.1; execute']})
        self.assertEqual(len(runtime.commands), 1)


if __name__ == '__main__':
    unittest.main()
