"""Isolated PICSimLab QEMU adapter. No project code is evaluated by the host.

ABI: https://github.com/lcgamboa/picsimlab/blob/master/src/sim_backend/qemu.h
The separately installed engine is GPL-2.0-or-later; see docs/SIMULATION.md.
"""
import ctypes as C
from collections import deque
import json
import os
import queue
import sys
import threading
import time

engine, flash, efuse = sys.argv[1:4]
# 7-bit addresses of modelled I2C devices; the models themselves run in the host process.
i2c_addresses = {int(a) for a in (sys.argv[4] if len(sys.argv) > 4 else '').split(',') if a}
engine = os.path.abspath(engine)
if os.name == 'nt':
    dll_dirs = [os.add_dll_directory(engine), os.add_dll_directory(os.path.dirname(os.path.dirname(engine)))]
lib = C.CDLL(os.path.join(engine, 'libqemu-xtensa.dll' if os.name == 'nt' else 'libqemu-xtensa.so'))
def fn(name, result, *args):
    f = getattr(lib, name)
    f.restype, f.argtypes = result, list(args)
    return f
clock = fn('qemu_clock_get_ns', C.c_int64, C.c_int)
lock = fn('bql_lock_impl', None, C.c_char_p, C.c_int)
unlock = fn('bql_unlock', None)
stop = fn('qmp_stop', None, C.c_void_p)
cont = fn('qmp_cont', None, C.c_void_p)
set_pin = fn('qemu_picsimlab_set_pin', None, C.c_int, C.c_int)
receive = fn('qemu_picsimlab_uart_receive', None, C.c_int, C.c_void_p, C.c_int)
internals = fn('qemu_picsimlab_get_internals', C.c_void_p, C.c_int)
serial_input = deque()
speed = 1
stepping = False
step_id = None
paused = False
ready = threading.Event()

def emit(kind, **data):
    print('OCSIM ' + json.dumps(dict(kind=kind, timeNs=int(clock(1)), **data)), flush=True)

WRITE = C.CFUNCTYPE(None, C.c_int, C.c_int)
I2C = C.CFUNCTYPE(C.c_int, C.c_uint8, C.c_uint8, C.c_uint16)
SPI = C.CFUNCTYPE(C.c_uint8, C.c_uint8, C.c_uint16)
UART = C.CFUNCTYPE(None, C.c_uint8, C.c_uint8)
RMT = C.CFUNCTYPE(None, C.c_uint8, C.c_uint32, C.c_uint32)
class Callbacks(C.Structure):
    _fields_ = [('write', WRITE), ('direction', WRITE), ('i2c', I2C), ('spi', SPI),
                ('uart', UART), ('pinmap', C.POINTER(C.c_short)), ('rmt', RMT)]

pinmap = (C.c_short * 41)(40, *range(40))
# PICSimLab forwards each I2C bus event as (bus id, address, code | data << 8). QEMU codes:
# 0 start receive, 1/2 start send, 3 finish, 4 master NACK, 5 write byte, 6 read byte.
# Address phases are answered here; writes stream to the host; reads block the vCPU (holding
# the BQL) until the host model replies, so virtual time does not advance meanwhile.
i2c_replies = queue.Queue()
i2c_request = 0
def i2c_event(bus, addr, event):
    global i2c_request
    code = event & 0xff
    if addr not in i2c_addresses:
        return 1 if code <= 2 else 0xff
    if code <= 2:
        emit('i2c', op='start', addr=addr, write=code != 0)
    elif code == 3:
        emit('i2c', op='stop', addr=addr)
    elif code == 5:
        emit('i2c', op='write', addr=addr, byte=event >> 8)
    elif code == 6:
        i2c_request += 1
        emit('i2c', op='read', addr=addr, id=i2c_request)
        deadline = time.monotonic() + 2
        while True:
            try:
                reply = i2c_replies.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                emit('i2c', op='timeout', addr=addr, id=i2c_request)
                return 0xff
            if reply.get('id') == i2c_request:
                return int(reply.get('value', 0xff)) & 0xff
    return 0
i2c_cb = I2C(i2c_event)
callbacks = Callbacks(
    WRITE(lambda pin, value: emit('gpio', gpio=pin-1, value=value) if 1 <= pin <= 40 else None),
    WRITE(lambda pin, value: emit('direction', gpio=pin-1, output=bool(value)) if 1 <= pin <= 40 else None),
    i2c_cb, SPI(lambda *_: 0xff),
    UART(lambda uart, value: emit('uart', uart=uart, byte=value)), pinmap,
    RMT(lambda *_: None))
fn('qemu_picsimlab_register_callbacks', None, C.c_void_p)(C.byref(callbacks))
args = ['opencircuit-esp32', '-M', 'esp32-picsimlab', '-L', os.path.join(engine, 'fw'),
        '-drive', 'file=' + os.path.abspath(flash) + ',if=mtd,format=raw',
        '-drive', 'file=' + os.path.abspath(efuse) + ',if=none,format=raw,id=efuse',
        '-global', 'driver=nvram.esp32.efuse,property=drive,value=efuse',
        '-display', 'none', '-serial', 'null', '-monitor', 'none', '-nic', 'none',
        '-icount', 'shift=8,align=off,sleep=off']
argv = (C.c_char_p * (len(args)+1))(*[s.encode() for s in args], None)
fn('qemu_init', None, C.c_int, C.POINTER(C.c_char_p), C.c_void_p)(len(args), argv, None)

TICK = C.CFUNCTYPE(None, C.c_void_p)
class Timer(C.Structure):
    _fields_ = [('expire', C.c_int64), ('timer_list', C.c_void_p), ('cb', TICK),
                ('opaque', C.c_void_p), ('next', C.c_void_p), ('attributes', C.c_int), ('scale', C.c_int)]
timer = Timer()
timer_mod = fn('timer_mod_ns', None, C.c_void_p, C.c_int64)
# The engine models LEDC (hardware PWM) but reports no GPIO activity for it, so tone() and
# ledcWrite would be invisible. Its internals expose the state, read here without touching the
# firmware: GPIO_OUT_SEL (40 pad routing values), LEDC_CHANNEL_CONF (16 CONF0 registers),
# LEDC_TIMER_FREQ (Hz; high-speed timers 0-3, then low-speed 4-7) and LEDC_CHANNEL_DUTY (16
# floats, percent). Pad routing value 71 is the first high-speed LEDC output, 79-86 low-speed.
LEDC_SIGNAL_FIRST, LEDC_SIGNAL_LAST = 71, 86
pwm_last = {}
def internal_array(cfg, ctype, count):
    pointer = internals(cfg)
    return list(C.cast(pointer, C.POINTER(ctype * count)).contents) if pointer else None
def poll_pwm():
    routing = internal_array(2, C.c_uint32, 40)
    conf = internal_array(4, C.c_uint32, 16)
    freq = internal_array(5, C.c_uint32, 8)
    duty = internal_array(6, C.c_float, 16)
    if not (routing and conf and freq and duty):
        return
    for gpio in range(40):
        signal = routing[gpio] & 0x1ff
        hz = 0
        if LEDC_SIGNAL_FIRST <= signal <= LEDC_SIGNAL_LAST:
            channel = signal - LEDC_SIGNAL_FIRST
            timer = (conf[channel] & 3) + (4 if channel >= 8 else 0)
            # CONF0 bit 2 enables the output; 0% or 100% duty is a constant level, not a tone.
            if conf[channel] & 4 and 0 < duty[channel] < 100:
                hz = freq[timer]
        if pwm_last.get(gpio, 0) != hz:
            pwm_last[gpio] = hz
            emit('pwm', gpio=gpio, frequency=hz)
def tick(_):
    global stepping, paused, step_id
    emit('clock')
    poll_pwm()
    if serial_input:
        # The engine's receive call drops data exceeding its 128-byte FIFO.
        # Feed at most 8 bytes each 10 ms, leaving time for the guest UART task.
        baud_ptr = internals(7)  # QEMU_INTERNAL_UART0_BAUD
        baud = C.cast(baud_ptr, C.POINTER(C.c_uint32)).contents.value if baud_ptr else 115200
        count = min(len(serial_input), 8, max(1, baud // 1000))
        payload = bytes(serial_input.popleft() for _ in range(count))
        buffer = C.create_string_buffer(payload)
        receive(0, buffer, len(payload))
    timer_mod(C.byref(timer), clock(1) + 10_000_000)
    if stepping:
        stepping, paused = False, True
        stop(None)
        emit('paused', paused=True)
        if step_id is not None:
            emit('ack', id=step_id)
            step_id = None
    else:
        time.sleep(.01 / speed)
tick_cb = TICK(tick)
fn('timer_init_full', None, C.c_void_p, C.c_void_p, C.c_int, C.c_int, C.c_int, TICK, C.c_void_p)(C.byref(timer), None, 1, 1, 0, tick_cb, None)
timer_mod(C.byref(timer), clock(1) + 10_000_000)

def controls():
    global speed, stepping, paused, step_id
    ready.wait()
    for line in sys.stdin:
        command = None
        try:
            command = json.loads(line)
            if command.get('kind') == 'i2c-reply':
                # Must not take the BQL: the waiting vCPU thread holds it.
                i2c_replies.put(command)
                continue
            lock(b'opencircuit', 1)
            try:
                kind = command['kind']
                if kind == 'pause':
                    stop(None)
                    paused = True
                    emit('paused', paused=True)
                elif kind in ('resume', 'step'):
                    stepping = kind == 'step'
                    step_id = command.get('id') if stepping else None
                    paused = False
                    cont(None)
                    emit('paused', paused=False)
                elif kind == 'speed' and command['value'] in (1, 2, 10, 100):
                    speed = command['value']
                elif kind == 'input' and 0 <= command['gpio'] <= 39:
                    set_pin(command['gpio']+1, int(bool(command['value'])))
                elif kind == 'serial':
                    payload = command['text'].encode('utf8')
                    if not 0 < len(payload) <= 4096:
                        raise ValueError('UART input exceeds 4096 bytes')
                    if len(serial_input) + len(payload) > 4096:
                        raise ValueError('UART input queue is full; retry after it drains')
                    serial_input.extend(payload)
                if 'id' in command and kind != 'step':
                    emit('ack', id=command['id'])
            finally:
                unlock()
        except Exception as error:
            if isinstance(command, dict) and 'id' in command:
                emit('ack', id=command['id'], error=str(error))
            print(str(error), file=sys.stderr, flush=True)
threading.Thread(target=controls, daemon=True).start()
ready.set()
emit('ready')
fn('qemu_main_loop', None)()
