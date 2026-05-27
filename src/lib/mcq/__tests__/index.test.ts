import { describe, it, expect } from 'vitest';
import * as mcq from '../index';

describe('mcq barrel', () => {
  it('re-exports the full engine public API', () => {
    for (const name of [
      'FileMCQRepository', 'validatePool',
      'emptyMatrix', 'updateMatrix', 'accuracyByDimension', 'profileFromMatrix', 'statusFor',
      'detectInconsistency',
      'localize', 'routeRemediation',
      'selectAssessment',
      'gradeAnswer', 'feedbackFor',
      'applyDiagnosisToState', 'buildRemediationAssessment', 'clearDiagnosisIfResolved', 'masteryBlockedByWeakDimension',
      'revealForDrill', 'revealForStressTest', 'applyStressSelfMark',
    ]) {
      expect(typeof (mcq as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
