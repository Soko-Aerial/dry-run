#!/usr/bin/env python3
"""Local MAVLink telemetry and mission-download bridge; no flight-control API."""
import argparse
from concurrent.futures import Future, TimeoutError as FutureTimeout
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import select
from queue import Queue, Empty
from threading import Lock, Thread
import time

from pymavlink import mavutil

STALE_SECONDS = 5
MISSION_TIMEOUT = 20
STREAM_INTERVAL = 0.5


class Bridge:
    def __init__(self, connection):
        self.link = mavutil.mavlink_connection(connection, source_system=255,
                                              source_component=190, dialect='ardupilotmega')
        self.lock = Lock()
        self.jobs = Queue(maxsize=1)
        self.mission_lock = Lock()
        self.target = None
        self.last_heartbeat = 0
        self.last_sent = 0
        self.last_configured = 0
        self.state = dict(vehicle=None, position=None, home=None, attitude=None,
                          battery=None, gps=None, statusText=None)
        self.updated = {}

    def snapshot(self):
        with self.lock:
            now = time.monotonic()
            age = now - self.last_heartbeat if self.last_heartbeat else None
            connected = age is not None and age < STALE_SECONDS
            result = deepcopy(self.state)
            result.update(connected=connected, heartbeatAge=age)
            for key in ('position', 'attitude', 'battery', 'gps'):
                if not connected or now - self.updated.get(key, 0) >= STALE_SECONDS:
                    result[key] = None
            if not connected:
                result['home'] = None
            return result

    def update(self, msg):
        kind = msg.get_type()
        now = time.monotonic()
        if kind == 'HEARTBEAT':
            # Select an autopilot, never a GCS, camera, or companion heartbeat.
            if msg.autopilot == mavutil.mavlink.MAV_AUTOPILOT_INVALID:
                return
            source = (msg.get_srcSystem(), msg.get_srcComponent())
            if self.target is not None and source != self.target:
                return
            self.target = source
            with self.lock:
                if now - self.last_heartbeat >= STALE_SECONDS:
                    self.state = dict(vehicle=None, position=None, home=None, attitude=None,
                                      battery=None, gps=None, statusText=None)
                    self.updated.clear()
                    self.last_configured = 0
                self.last_heartbeat = now
                self.state['vehicle'] = dict(systemId=source[0], componentId=source[1],
                    autopilot=msg.autopilot, type=msg.type, mode=mavutil.mode_string_v10(msg),
                    armed=bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED))
            return
        if self.target != (msg.get_srcSystem(), msg.get_srcComponent()):
            return
        key, value = None, None
        if kind == 'GLOBAL_POSITION_INT' and (msg.lat != 0 or msg.lon != 0):
            key = 'position'
            value = dict(lat=msg.lat / 1e7, lon=msg.lon / 1e7, altAmsl=msg.alt / 1000,
                         relativeAlt=msg.relative_alt / 1000,
                         heading=None if msg.hdg == 65535 else msg.hdg / 100,
                         groundSpeed=math.hypot(msg.vx, msg.vy) / 100)
        elif kind == 'HOME_POSITION' and (msg.latitude != 0 or msg.longitude != 0):
            key = 'home'
            value = dict(lat=msg.latitude / 1e7, lon=msg.longitude / 1e7, alt=msg.altitude / 1000)
        elif kind == 'ATTITUDE':
            key = 'attitude'
            value = dict(roll=math.degrees(msg.roll), pitch=math.degrees(msg.pitch),
                         yaw=math.degrees(msg.yaw) % 360)
        elif kind == 'SYS_STATUS':
            key = 'battery'
            value = dict(voltage=None if msg.voltage_battery == 65535 else msg.voltage_battery / 1000,
                         remaining=None if msg.battery_remaining < 0 else msg.battery_remaining)
        elif kind == 'GPS_RAW_INT':
            key = 'gps'
            value = dict(fix=msg.fix_type, satellites=None if msg.satellites_visible == 255 else msg.satellites_visible)
        elif kind == 'STATUSTEXT':
            key, value = 'statusText', msg.text
        if key:
            with self.lock:
                self.state[key] = value
                self.updated[key] = now

    def receive(self):
        now = time.monotonic()
        if self.target and now - self.last_sent >= 1:
            self.link.mav.heartbeat_send(mavutil.mavlink.MAV_TYPE_GCS,
                mavutil.mavlink.MAV_AUTOPILOT_INVALID, 0, 0, 0)
            self.last_sent = now
        if self.target and now - self.last_heartbeat < STALE_SECONDS and now - self.last_configured >= 10:
            system, component = self.target
            self.link.mav.request_data_stream_send(system, component,
                mavutil.mavlink.MAV_DATA_STREAM_ALL, 4, 1)
            self.link.mav.command_long_send(system, component,
                mavutil.mavlink.MAV_CMD_REQUEST_MESSAGE, 0,
                mavutil.mavlink.MAVLINK_MSG_ID_HOME_POSITION, 0, 0, 0, 0, 0, 0)
            self.last_configured = now
        msg = self.link.recv_match(blocking=True, timeout=0.1)
        if msg:
            self.update(msg)
        return msg

    def exchange(self, send, accept, deadline):
        # MAVLink mission transfers retry requests when replies are lost.
        for _ in range(3):
            send()
            until = min(deadline, time.monotonic() + 1.5)
            while time.monotonic() < until:
                msg = self.receive()
                if not msg or (msg.get_srcSystem(), msg.get_srcComponent()) != self.target:
                    continue
                if getattr(msg, 'mission_type', 0) != 0:
                    continue
                if getattr(msg, 'target_system', 255) not in (0, 255):
                    continue
                if getattr(msg, 'target_component', 190) not in (0, 190):
                    continue
                if msg.get_type() == 'MISSION_ACK' and msg.type != mavutil.mavlink.MAV_MISSION_ACCEPTED:
                    raise RuntimeError(f'Autopilot rejected mission download (result {msg.type}).')
                if accept(msg):
                    return msg
            if time.monotonic() >= deadline:
                break
        raise TimeoutError('Mission download timed out. Check the MAVLink connection and retry.')

    def download(self):
        state = self.snapshot()
        if not state['connected']:
            raise RuntimeError('No recent autopilot heartbeat.')
        if state['vehicle']['autopilot'] != mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA:
            raise RuntimeError('Mission download currently supports ArduPilot vehicles.')
        system, component = self.target
        deadline = time.monotonic() + MISSION_TIMEOUT
        count = self.exchange(lambda: self.link.mav.mission_request_list_send(system, component),
                              lambda msg: msg.get_type() == 'MISSION_COUNT', deadline).count
        if count > 512:
            raise RuntimeError('This version supports missions with at most 512 items.')
        items = []
        for seq in range(count):
            msg = self.exchange(lambda: self.link.mav.mission_request_int_send(system, component, seq),
                lambda msg: msg.get_type() == 'MISSION_ITEM_INT' and msg.seq == seq, deadline)
            if not math.isfinite(msg.z):
                raise RuntimeError(f'Mission item {seq} contains an invalid altitude.')
            items.append(dict(seq=msg.seq, frame=msg.frame, command=msg.command,
                              x=msg.x, y=msg.y, z=msg.z,
                              params=[msg.param1, msg.param2, msg.param3, msg.param4]))
        self.link.mav.mission_ack_send(system, component, mavutil.mavlink.MAV_MISSION_ACCEPTED)
        # JSON has no NaN. Unspecified command parameters are represented as null.
        for item in items:
            item['params'] = [p if math.isfinite(p) else None for p in item['params']]
        return dict(items=items, home=self.snapshot()['home'], autopilot=state['vehicle']['autopilot'])

    def run(self):
        while True:
            try:
                job = self.jobs.get_nowait()
            except Empty:
                self.receive()
                continue
            try:
                job.set_result(self.download())
            except Exception as error:
                job.set_exception(error)
            finally:
                self.mission_lock.release()


class Handler(BaseHTTPRequestHandler):
    def stream_telemetry(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-store, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        # Bound slow-client writes; don't retain queues of old telemetry.
        self.connection.settimeout(3)
        try:
            self.wfile.write(b'retry: 2000\n\n')
            while True:
                started = time.monotonic()
                body = json.dumps(self.server.bridge.snapshot(), allow_nan=False).encode()
                self.wfile.write(b'data: ' + body + b'\n\n')
                self.wfile.flush()
                # Wake immediately on client disconnect, otherwise send the next snapshot.
                # Regular snapshots also expire stale fields when no MAVLink packets arrive.
                if select.select([self.connection], [], [],
                                 max(0, STREAM_INTERVAL - (time.monotonic() - started)))[0]:
                    break
        except OSError:
            pass
        finally:
            self.close_connection = True

    def respond(self, status, payload):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def local_request(self):
        # The Next.js server proxies requests; direct cross-origin browser access is unnecessary.
        if self.headers.get('Origin') or self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
            self.respond(403, dict(error='Use the app to access the local MAVLink bridge.'))
            return False
        return True

    def do_GET(self):
        if not self.local_request():
            return
        if self.path == '/telemetry':
            self.stream_telemetry()
        else:
            self.respond(404, dict(error='Not found'))

    def do_POST(self):
        if not self.local_request():
            return
        if self.path != '/mission':
            return self.respond(404, dict(error='Not found'))
        bridge = self.server.bridge
        if not bridge.mission_lock.acquire(blocking=False):
            return self.respond(409, dict(error='A mission download is already in progress.'))
        job = Future()
        bridge.jobs.put_nowait(job)
        try:
            self.respond(200, job.result(timeout=MISSION_TIMEOUT + 2))
        except (TimeoutError, FutureTimeout) as error:
            self.respond(504, dict(error=str(error) or 'Mission download timed out.'))
        except RuntimeError as error:
            self.respond(502, dict(error=str(error)))
        except Exception:
            self.respond(500, dict(error='Mission download failed. See the bridge terminal.'))

    def log_message(self, *_args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connection', default='udpin:127.0.0.1:14550')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    bridge = Bridge(args.connection)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.bridge = bridge
    Thread(target=bridge.run, daemon=True).start()
    print(f'MAVLink bridge: http://127.0.0.1:{args.port} <- {args.connection}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        bridge.link.close()


if __name__ == '__main__':
    main()
