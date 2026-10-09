import json
from pathlib import Path
import tempfile
import unittest

from summarize import CONDITIONS, summarize


class SummaryTests(unittest.TestCase):
    def test_full_denominator_infra_unknown_tokens_and_task_pairing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            positions = [{'id': f'{task}-{condition}-{repeat}', 'taskId': f'task-{task}',
                'condition': condition, 'repeat': repeat} for task in range(4)
                for condition in CONDITIONS for repeat in (1, 2)]
            for position in positions:
                run = root / position['id']; run.mkdir()
                infra = position['id'] == '0-goal-1'
                result = {**position, 'strictSuccess': not infra, 'reward': None if infra else 1,
                    'terminal': {'firstStopReason': 'infrastructure-fault' if infra else 'controller-complete',
                                 'infrastructureFault': infra}, 'gradingFault': None,
                    'announcedCompleteOfficialFailed': False,
                    'metrics': {'allSessionTokens': None if infra else {}, 'tokensReported': {'outputTokens': 2}}}
                (run / 'result.json').write_text(json.dumps(result))
            value = summarize({'seed': 'fixed', 'positions': positions}, root)
            goal = value['conditions']['goal']
            self.assertEqual((value['planned'], value['sealed']), (24, 24))
            self.assertEqual(goal['strictSuccessRateFullDenominator'], 7 / 8)
            self.assertEqual(goal['rewardUnknown'], 1)
            self.assertIsNone(goal['allSessionTokens'])
            self.assertEqual(goal['tokensReportedLowerBound']['outputTokens'], 16)
            self.assertIsNone(goal['metrics']['checkWaitMs'])
            self.assertIsNone(goal['metrics']['requestCount'])
            self.assertEqual(value['comparisons']['goal']['pairedTaskCount'], 4)
            self.assertIsNone(value['falseAcceptanceRate'])
            (root / positions[0]['id'] / 'result.json').unlink()
            (root / positions[0]['id'] / 'started.json').write_text('{}')
            value = summarize({'seed': 'fixed', 'positions': positions}, root)
            self.assertFalse(value['complete'])
            self.assertEqual(value['conditions']['goal']['startedNotSealed'], 1)
            self.assertIsNone(value['comparisons']['goal']['taskClusterBootstrap95Percent'])


if __name__ == '__main__': unittest.main()
