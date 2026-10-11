import json
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock

from route_preflight import run


class RoutePlatformTests(unittest.TestCase):
    def test_frozen_amd64_route_probe_does_not_use_server_platform_default(self):
        runtime = Mock()
        runtime.create.side_effect = RuntimeError('controlled pre-delivery refusal')
        with TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'plugin.tgz').write_bytes(b'current immutable package')
            with self.assertRaisesRegex(RuntimeError, 'controlled pre-delivery refusal'):
                run(runtime, image='frozen-image', tarball=root / 'plugin.tgz', daily_patch='',
                    credential=b'', out=root / 'route', host_gateway='host')
            self.assertEqual(runtime.create.call_args.kwargs['platform'], 'linux/amd64')
            self.assertEqual(json.loads((root / 'route/intent.json').read_text())['platform'], 'linux/amd64')
            self.assertEqual(json.loads((root / 'route/intent.json').read_text())['tarballSha256'],
                hashlib.sha256((root / 'plugin.tgz').read_bytes()).hexdigest())
            runtime.write.assert_not_called()
            self.assertFalse((root / 'route/session.json').exists())


if __name__ == '__main__':
    unittest.main()
