import { editionReducer, initialEditionState } from '../editionState';
import type { EditionResolutionResult } from '../../api/editions';


const unavailable: EditionResolutionResult = {
  status: 'unavailable',
  reason: 'No reviewed open edition is available for this work yet.',
  physicalEdition: null,
  digitalEdition: null,
  source: null,
  rights: null,
  provenance: null,
};


test('edition resolution state covers progress, result, error, retry, and reset', () => {
  const searching = editionReducer(initialEditionState, { type: 'started' });
  expect(searching.status).toBe('searching');

  const resolved = editionReducer(searching, { type: 'succeeded', result: unavailable });
  expect(resolved.status).toBe('resolved');
  expect(resolved.result?.status).toBe('unavailable');

  const failed = editionReducer(searching, { type: 'failed', message: 'Source unavailable' });
  expect(failed).toEqual({ status: 'error', result: null, message: 'Source unavailable' });
  expect(editionReducer(failed, { type: 'reset' })).toEqual(initialEditionState);
});
