import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from bridge import Bridge, STALE_SECONDS


def message(kind, system=1, component=1, **fields):
    return SimpleNamespace(get_type=lambda: kind, get_srcSystem=lambda: system,
                           get_srcComponent=lambda: component, **fields)


def heartbeat(system=1, autopilot=3):
    return message('HEARTBEAT', system=system, autopilot=autopilot,
                   type=2, base_mode=0, custom_mode=0)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        with patch('bridge.mavutil.mavlink_connection'):
            self.bridge = Bridge('udpin:127.0.0.1:14550')

    def test_foreign_heartbeats_and_stale_position(self):
        b = self.bridge
        b.update(heartbeat(autopilot=8))  # MAV_AUTOPILOT_INVALID
        self.assertIsNone(b.target)
        b.update(heartbeat())
        b.update(message('GLOBAL_POSITION_INT', lat=-353632610, lon=1491652300,
                         alt=584000, relative_alt=100000, hdg=65535, vx=300, vy=400))
        state = b.snapshot()
        self.assertTrue(state['connected'])
        self.assertEqual(state['position']['altAmsl'], 584)
        self.assertEqual(state['position']['groundSpeed'], 5)
        self.assertIsNone(state['position']['heading'])
        b.update(heartbeat(system=2))
        self.assertEqual(b.target, (1, 1))
        b.updated['position'] = time.monotonic() - STALE_SECONDS - 1
        self.assertIsNone(b.snapshot()['position'])
        b.last_heartbeat = time.monotonic() - STALE_SECONDS - 1
        self.assertFalse(b.snapshot()['connected'])
        b.update(heartbeat())
        self.assertIsNone(b.snapshot()['position'], 'reconnection clears cached values')

    def test_retry_lost_count_and_ignore_other_vehicle(self):
        b = self.bridge
        b.update(heartbeat())
        sent = []
        replies = iter([None, message('MISSION_COUNT', system=2, count=99),
                        message('MISSION_COUNT', count=2)])
        with patch.object(b, 'receive', side_effect=lambda: next(replies, None)), \
             patch('bridge.time.monotonic', side_effect=[0, 0, 0.5, 2, 2, 2, 2.5, 3]):
            result = b.exchange(lambda: sent.append(True),
                                lambda m: m.get_type() == 'MISSION_COUNT', deadline=20)
        self.assertEqual(result.count, 2)
        self.assertEqual(len(sent), 2, 'lost reply should trigger another request')

    def test_rejected_download(self):
        b = self.bridge
        b.update(heartbeat())
        with patch.object(b, 'receive', return_value=message('MISSION_ACK', type=14)):
            with self.assertRaisesRegex(RuntimeError, 'rejected'):
                b.exchange(lambda: None, lambda _: False, time.monotonic() + 5)

    def test_no_heartbeat_download_fails(self):
        with self.assertRaisesRegex(RuntimeError, 'heartbeat'):
            self.bridge.download()


if __name__ == '__main__':
    unittest.main()
