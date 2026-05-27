// Each export is a structurally-broken pool used to assert validatePool rejects it.
const base = {
  id: 'X-q1',
  moduleId: 'X',
  difficulty: 'easy',
  dimension: 'topic',
  stem: 's',
  options: ['a', 'b', 'c', 'd'],
  correctIndex: 0,
  distractorMisconception: { '1': 'm1', '2': 'm2', '3': 'm3' },
  explanation: 'e',
};

export const threeOptions = {
  moduleId: 'X',
  questions: [{ ...base, options: ['a', 'b', 'c'] }],
};
export const correctOutOfRange = {
  moduleId: 'X',
  questions: [{ ...base, correctIndex: 4 }],
};
export const correctNegative = {
  moduleId: 'X',
  questions: [{ ...base, correctIndex: -1 }],
};
export const correctNotInteger = {
  moduleId: 'X',
  questions: [{ ...base, correctIndex: 1.5 }],
};
export const badDifficulty = {
  moduleId: 'X',
  questions: [{ ...base, difficulty: 'trivial' }],
};
export const badDimension = {
  moduleId: 'X',
  questions: [{ ...base, dimension: 'vibes' }],
};
// distractor keys must be EXACTLY the wrong-option indices (here correctIndex=0 → keys must be {1,2,3})
export const distractorKeyOnCorrect = {
  moduleId: 'X',
  questions: [{ ...base, distractorMisconception: { '0': 'm0', '1': 'm1', '2': 'm2', '3': 'm3' } }],
};
export const distractorKeyMissing = {
  moduleId: 'X',
  questions: [{ ...base, distractorMisconception: { '1': 'm1', '2': 'm2' } }],
};
export const distractorKeyOutOfRange = {
  moduleId: 'X',
  questions: [{ ...base, distractorMisconception: { '1': 'm1', '2': 'm2', '5': 'm5' } }],
};
export const emptyOptionsArray = {
  moduleId: 'X',
  questions: [{ ...base, options: [] }],
};
export const missingStem = {
  moduleId: 'X',
  questions: [{ ...base, stem: undefined }],
};
export const missingExplanation = {
  moduleId: 'X',
  questions: [{ ...base, explanation: undefined }],
};
export const notAnArray = { moduleId: 'X', questions: {} };
export const missingModuleId = { questions: [{ ...base }] };
