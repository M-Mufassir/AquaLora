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

# Common aquaculture profiles used as safe starting points for this academic
# prototype. These are not final species-calibrated values, but they allow
# different pond types to drift by species rather than forcing a single global
# threshold for every slave node.
# Values were chosen to reflect common Sri Lankan farm species and a practical
# "starter threshold" range for monitoring dashboards before a site-specific
# calibration is performed.
POND_PROFILES = {
    'tilapia': {
        'temperature': (26.0, 30.0, 20.0, 34.0),
        'turbidity': (0.0, 25.0, 0.0, 45.0),
        'tds': (100.0, 300.0, 50.0, 400.0),
        'ph': (6.5, 8.5, 5.5, 9.5),
    },
    'prawn': {
        'temperature': (28.0, 32.0, 24.0, 35.0),
        'turbidity': (0.0, 15.0, 0.0, 25.0),
        'tds': (150.0, 250.0, 100.0, 350.0),
        'ph': (7.0, 8.5, 6.5, 9.0),
    },
    'catfish': {
        'temperature': (24.0, 30.0, 18.0, 34.0),
        'turbidity': (0.0, 30.0, 0.0, 45.0),
        'tds': (80.0, 250.0, 40.0, 350.0),
        'ph': (6.5, 8.0, 5.5, 9.0),
    },
    'tuna': {
        'temperature': (20.0, 25.0, 16.0, 30.0),
        'turbidity': (0.0, 10.0, 0.0, 20.0),
        'tds': (120.0, 250.0, 80.0, 300.0),
        'ph': (7.5, 8.5, 6.8, 9.0),
    },
    'salmon': {
        'temperature': (12.0, 18.0, 8.0, 22.0),
        'turbidity': (0.0, 15.0, 0.0, 25.0),
        'tds': (80.0, 200.0, 40.0, 250.0),
        'ph': (6.5, 8.0, 6.0, 8.5),
    },
}


def _normalize_profile(profile: dict) -> dict:
    normalized = {}
    for key in ('temperature', 'turbidity', 'tds', 'ph'):
        bounds = profile.get(key) if isinstance(profile, dict) else None
        if not isinstance(bounds, dict):
            continue
        try:
            ideal_min = float(bounds.get('min', 0.0))
            ideal_max = float(bounds.get('max', 0.0))
        except (TypeError, ValueError):
            continue
        if ideal_max < ideal_min:
            ideal_min, ideal_max = ideal_max, ideal_min
        spread = max(1.0, (ideal_max - ideal_min) * 0.5)
        normalized[key] = (ideal_min, ideal_max, ideal_min - spread, ideal_max + spread)
    return normalized


def _resolve_profile(reading: dict) -> dict:
    pond_type = str(reading.get('pond_type', 'tilapia')).lower()
    custom_profile = reading.get('custom_profile')
    if pond_type == 'custom' and isinstance(custom_profile, dict):
        normalized = _normalize_profile(custom_profile)
        if normalized:
            return normalized
    if isinstance(custom_profile, dict) and pond_type != 'custom':
        normalized = _normalize_profile(custom_profile)
        if normalized and any(key in normalized for key in ('temperature', 'turbidity', 'tds', 'ph')):
            return normalized
    profile = POND_PROFILES.get(pond_type, POND_PROFILES['tilapia'])
    return {
        key: (ideal_min, ideal_max, acc_min, acc_max)
        for key, (ideal_min, ideal_max, acc_min, acc_max) in {
            k: (v[0], v[1], v[2], v[3]) for k, v in profile.items()
        }.items()
    }

# Placeholder weighting for the 4th pH sensor until the decision-support team
# finalizes the production coefficients. The total must remain 1.0.
DEFAULT_WEIGHTS = {'temperature': 0.35, 'turbidity': 0.25, 'tds': 0.2, 'ph': 0.2}

STATUS_THRESHOLDS = (70, 40)  # >=70 Normal, >=40 Warning, else Critical

RECOMMENDATIONS = {
    'temperature': 'Temperature outside ideal range — check for equipment shading or heater/aerator faults.',
    'turbidity': 'High turbidity — check for recent rainfall, sediment disturbance, or overfeeding.',
    'tds': 'TDS outside ideal range — check for possible contamination or evaporation concentrating salts.',
    'ph': 'pH outside the ideal range — check water chemistry, dosing, and aeration stability.'
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
    profile = _resolve_profile(reading)
    weights = DEFAULT_WEIGHTS
    subscores = {
        key: score_parameter(float(reading.get(key, 0.0)), *profile[key]) for key in weights if key in profile
    }
    if not subscores:
        return {'score': 0.0, 'status': 'Critical', 'parameter': None, 'recommendation': None}
    fhi = sum(weights[key] * subscores[key] for key in subscores)

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
