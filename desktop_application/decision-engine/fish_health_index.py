"""AquaLoRa Fish Health Index — decision engine (Member 4's subsystem).

Protocol: reads one line of JSON from stdin per reading
({"temperature": .., "turbidity": .., "tds": ..}), writes one line of JSON
to stdout in response ({"score": .., "status": .., "recommendation": ..}).
stdlib only, no dependencies to install.

Placeholder implementation — the weighting (0.5/0.3/0.2) matches the
proposal, but the ideal/acceptable ranges below are generic freshwater
aquaculture defaults, NOT calibrated for a specific species. Member 4 owns
tuning IDEAL_RANGES and the status thresholds against real literature/data;
the dashboard integration (spawning this process, the stdin/stdout
protocol, alert storage, UI) does not need to change when that happens.
"""
import json
import sys

WEIGHTS = {'temperature': 0.5, 'turbidity': 0.3, 'tds': 0.2}

# (ideal_min, ideal_max, acceptable_min, acceptable_max) — 100 inside ideal,
# linearly down to 40 at the acceptable edge, down to 0 beyond it.
IDEAL_RANGES = {
    'temperature': (26.0, 30.0, 20.0, 34.0),
    'turbidity': (0.0, 25.0, 0.0, 45.0),
    'tds': (100.0, 300.0, 50.0, 400.0)
}

STATUS_THRESHOLDS = (70, 40)  # >=70 Normal, >=40 Warning, else Critical

RECOMMENDATIONS = {
    'temperature': 'Temperature outside ideal range — check for equipment shading or heater/aerator faults.',
    'turbidity': 'High turbidity — check for recent rainfall, sediment disturbance, or overfeeding.',
    'tds': 'TDS outside ideal range — check for possible contamination or evaporation concentrating salts.'
}


def score_parameter(value: float, ideal_min: float, ideal_max: float, acc_min: float, acc_max: float) -> float:
    if ideal_min <= value <= ideal_max:
        return 100.0
    if value < ideal_min:
        if value <= acc_min:
            return 0.0
        return 40.0 + 60.0 * (value - acc_min) / (ideal_min - acc_min)
    if value >= acc_max:
        return 0.0
    return 40.0 + 60.0 * (acc_max - value) / (acc_max - ideal_max)


def score_reading(reading: dict) -> dict:
    subscores = {
        key: score_parameter(float(reading[key]), *IDEAL_RANGES[key]) for key in WEIGHTS
    }
    fhi = sum(WEIGHTS[key] * subscores[key] for key in WEIGHTS)

    if fhi >= STATUS_THRESHOLDS[0]:
        status = 'Normal'
    elif fhi >= STATUS_THRESHOLDS[1]:
        status = 'Warning'
    else:
        status = 'Critical'

    parameter = None
    recommendation = None
    if status != 'Normal':
        parameter = min(subscores, key=lambda k: subscores[k])
        recommendation = RECOMMENDATIONS[parameter]

    return {
        'score': round(fhi, 1),
        'status': status,
        'parameter': parameter,
        'recommendation': recommendation
    }


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reading = json.loads(line)
            result = score_reading(reading)
        except (ValueError, KeyError) as exc:
            result = {'error': str(exc)}
        sys.stdout.write(json.dumps(result) + '\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
