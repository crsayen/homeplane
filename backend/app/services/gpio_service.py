import asyncio
import logging

logger = logging.getLogger(__name__)

try:
    import RPi.GPIO as GPIO

    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    _GPIO_AVAILABLE = True
except (ImportError, RuntimeError):
    GPIO = None
    _GPIO_AVAILABLE = False
    logger.warning("RPi.GPIO not available; GPIO operations will be simulated")

VALID_BCM_PINS = frozenset(range(2, 28))


class GPIOService:
    def __init__(self) -> None:
        self._configured_pins: set[int] = set()
        self._pending_tasks: dict[int, asyncio.Task] = {}
        self._mock_states: dict[int, bool] = {}

    def _setup_output(self, pin: int) -> None:
        if pin not in self._configured_pins:
            if _GPIO_AVAILABLE:
                GPIO.setup(pin, GPIO.OUT)
            self._configured_pins.add(pin)

    def set_pin(self, pin: int, state: bool) -> None:
        self._setup_output(pin)
        if _GPIO_AVAILABLE:
            GPIO.output(pin, GPIO.HIGH if state else GPIO.LOW)
        else:
            self._mock_states[pin] = state
            logger.info("Mock GPIO: pin %d -> %s", pin, "HIGH" if state else "LOW")

    def read_pin(self, pin: int) -> bool:
        self._setup_output(pin)
        if _GPIO_AVAILABLE:
            return bool(GPIO.input(pin))
        return self._mock_states.get(pin, False)

    async def set_pin_timed(self, pin: int, state: bool, duration_ms: float) -> None:
        if pin in self._pending_tasks:
            self._pending_tasks[pin].cancel()
            await asyncio.gather(self._pending_tasks.pop(pin), return_exceptions=True)

        self.set_pin(pin, state)

        async def revert() -> None:
            try:
                await asyncio.sleep(duration_ms / 1000)
                self.set_pin(pin, not state)
            except asyncio.CancelledError:
                pass
            finally:
                self._pending_tasks.pop(pin, None)

        self._pending_tasks[pin] = asyncio.create_task(revert())

    def cleanup(self) -> None:
        for task in self._pending_tasks.values():
            task.cancel()
        self._pending_tasks.clear()
        if _GPIO_AVAILABLE:
            GPIO.cleanup()
