"""Long bounded preparation RPCs retain normal query limits and never retry."""
import io
import unittest
from control_rpc import WebRpc


class Opener:
    def __init__(self, error=None):
        self.timeouts = []
        self.error = error

    def open(self, request, *, timeout):
        self.timeouts.append(timeout)
        if self.error:
            raise self.error
        return io.BytesIO(b'{"result":{"ok":true,"value":{"accepted":true}}}')


class RpcPreparationTests(unittest.TestCase):
    def rpc(self, error=None):
        rpc = WebRpc.__new__(WebRpc)
        rpc.base_url = 'http://127.0.0.1:12345'
        rpc.command_timeout = 660
        rpc.opener = Opener(error)
        return rpc

    def test_only_commands_receive_preparation_budget(self):
        rpc = self.rpc()
        rpc.command('session-test', '/task new original requirement')
        rpc.call('session/list')
        self.assertEqual(rpc.opener.timeouts, [660, 30])

    def test_timeout_does_not_redeliver_command(self):
        rpc = self.rpc(TimeoutError('uncertain command'))
        with self.assertRaises(TimeoutError):
            rpc.command('session-test', '/task new original requirement')
        self.assertEqual(rpc.opener.timeouts, [660])

    def test_invalid_budget_rejected_before_authentication(self):
        for value in (0, 3601, '660', float('nan')):
            with self.assertRaises(ValueError):
                WebRpc(None, 'http://127.0.0.1:12345', command_timeout=value)


if __name__ == '__main__':
    unittest.main()
