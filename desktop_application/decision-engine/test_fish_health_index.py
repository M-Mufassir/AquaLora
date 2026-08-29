import unittest

from fish_health_index import score_reading


class FishHealthIndexPhTests(unittest.TestCase):
    def test_score_reading_accepts_ph_input(self):
        reading = {
            'temperature': 27.0,
            'turbidity': 12.0,
            'tds': 180.0,
            'ph': 7.2,
        }

        result = score_reading(reading)

        self.assertIn('score', result)
        self.assertIn('status', result)
        self.assertIsInstance(result['score'], float)

    def test_bad_ph_should_reduce_score_even_if_other_values_are_ideal(self):
        ideal_reading = {
            'temperature': 27.0,
            'turbidity': 10.0,
            'tds': 150.0,
            'ph': 7.0,
        }
        bad_ph_reading = {
            'temperature': 27.0,
            'turbidity': 10.0,
            'tds': 150.0,
            'ph': 2.5,
        }

        ideal_result = score_reading(ideal_reading)
        bad_result = score_reading(bad_ph_reading)

        self.assertGreaterEqual(ideal_result['score'], 70.0)
        self.assertLess(bad_result['score'], ideal_result['score'])

    def test_species_profile_changes_thresholds(self):
        reading = {
            'temperature': 31.0,
            'turbidity': 20.0,
            'tds': 200.0,
            'ph': 7.2,
            'pond_type': 'prawn'
        }
        tilapia_result = score_reading({**reading, 'pond_type': 'tilapia'})
        prawn_result = score_reading({**reading, 'pond_type': 'prawn'})

        self.assertIsInstance(tilapia_result['score'], float)
        self.assertIsInstance(prawn_result['score'], float)
        self.assertNotEqual(tilapia_result['score'], prawn_result['score'])

    def test_custom_profile_overrides_species_thresholds(self):
        reading = {
            'temperature': 29.0,
            'turbidity': 18.0,
            'tds': 200.0,
            'ph': 7.4,
            'pond_type': 'custom',
            'custom_profile': {
                'temperature': {'min': 26.0, 'max': 30.0},
                'turbidity': {'min': 0.0, 'max': 20.0},
                'tds': {'min': 120.0, 'max': 250.0},
                'ph': {'min': 6.8, 'max': 8.2}
            }
        }

        result = score_reading(reading)

        self.assertIn('score', result)
        self.assertIsInstance(result['score'], float)
        self.assertGreaterEqual(result['score'], 0.0)


if __name__ == '__main__':
    unittest.main()
